import type { RelayedStatus } from "./events";
import type {
  AgentOutcome,
  BuilderStatusDetail,
  CommitPushResult,
  DeployResult,
  MergeMainResult,
  PrepareContinueResult,
  RevertMainResult,
  StepInput,
  StepName,
  TerminalStatus,
  VerifyResult,
} from "./protocol";
import type { Checkpoint, Pending, PendingMessage } from "./state";
import type { Line } from "./event-relay";

const MAX_FIX_ROUNDS = 3;
/** Nothing is fetched for a reply mid-run; main is fetched once per continuation, at its start. */
const NO_SYNC = "Main was not fetched again for this reply.";

/** Where a run goes after a phase: on to the next, parked on a question, or over. */
export type Next = "continue" | "park" | "end";

/** What a phase may do besides deciding the next one; the builder object provides it. */
export interface PhaseContext {
  step<T = unknown>(name: StepName, input?: StepInput): Promise<T>;
  agentTurn(): Promise<AgentOutcome>;
  /** The user messages that arrived meanwhile, after `first`, taken; null when there is nothing. */
  takePending(first?: PendingMessage): Promise<Pending | null>;
  /** A builder message for the chat. */
  say(text: string): Promise<void>;
  status(status: RelayedStatus): Promise<void>;
  line(line: Line): void;
  /** What the run is up to, as its status line. */
  progress(phase: string, message?: string): void;
  /** Restores the production database to `at` (ms), keeping the router's tables as they are. */
  restoreDatabase(at: number): Promise<void>;
  /** The run is over with this status; nothing runs after it. */
  finish(status: TerminalStatus, detail?: BuilderStatusDetail): Promise<void>;
}

/**
 * One phase of a run: the turn it takes, what it tells the session, and
 * where the run goes next. A build or a continue goes prepare, install,
 * agent (as many turns as the agent needs; a question parks the run), verify
 * with up to three fix turns, commit-push, deploy-preview. A merge goes
 * merge-main, install, deploy-production, cleanup. An abandon goes
 * prepare-cleanup, cleanup. A revert goes revert-main, install,
 * restore-database, deploy-revert.
 */
export async function runPhase(at: Checkpoint, ctx: PhaseContext): Promise<Next> {
  const { run } = at;
  switch (at.phase) {
    case "prepare": {
      switch (run.mode) {
        case "build":
          await ctx.step("prepare-build");
          at.phase = "install";
          return "continue";
        case "continue": {
          const result = await ctx.step<PrepareContinueResult>("prepare-continue");
          at.sync = result.sync;
          at.phase = "install";
          return "continue";
        }
        case "merge": {
          const result = await ctx.step<MergeMainResult>("merge-main");
          at.mergedHead = result.headCommit;
          at.phase = "install";
          return "continue";
        }
        case "abandon":
          await ctx.step("prepare-cleanup");
          at.phase = "cleanup";
          return "continue";
        case "revert": {
          const result = await ctx.step<RevertMainResult>("revert-main");
          at.mergedHead = result.headCommit;
          at.phase = "install";
          return "continue";
        }
      }
      break;
    }
    case "install": {
      await ctx.step("install");
      if (run.mode === "merge") {
        at.phase = "deploy-production";
        return "continue";
      }
      if (run.mode === "revert") {
        at.phase = "restore-database";
        return "continue";
      }
      if (run.mode === "build") {
        const { message, files } = (await ctx.takePending({
          text: "",
          files: run.files ?? [],
        }))!;
        at.prompt = { kind: "build", extra: message, ...(files ? { files } : {}) };
      } else {
        const first =
          run.mode === "continue"
            ? { text: run.message, files: run.files ?? [] }
            : undefined;
        const pending = (await ctx.takePending(first)) ?? { message: "" };
        at.prompt = { kind: "continue", ...pending, sync: at.sync ?? "" };
      }
      at.phase = "agent";
      return "continue";
    }
    case "agent": {
      const outcome = await ctx.agentTurn();
      if (outcome.status === "blocked") {
        await ctx.say(outcome.message || "The builder could not complete this change.");
        await ctx.finish("failed", { error: "blocked" });
        return "end";
      }
      if (outcome.status === "question") {
        await ctx.say(outcome.message || "The builder has a question.");
        const answer = await ctx.takePending();
        if (answer) {
          // The answer arrived while the agent was still asking.
          at.prompt = { kind: "continue", ...answer, sync: NO_SYNC };
          return "continue";
        }
        await ctx.status("waiting");
        ctx.progress("waiting", "waiting for your answer");
        return "park";
      }
      at.outcome = at.outcome
        ? {
            ...outcome,
            summary: at.outcome.summary || outcome.summary,
            reasoning: at.outcome.reasoning || outcome.reasoning,
          }
        : outcome;
      at.phase = "verify";
      return "continue";
    }
    case "verify": {
      const { failure } = await ctx.step<VerifyResult>("verify");
      if (!failure) {
        at.phase = "commit-push";
        return "continue";
      }
      if (at.fixRound >= MAX_FIX_ROUNDS) {
        await ctx.say(
          `Verification still fails after ${MAX_FIX_ROUNDS} fix attempts (${failure.label}).\n\n\`\`\`\n${failure.output}\n\`\`\``,
        );
        await ctx.finish("failed", { error: `${failure.label} failed` });
        return "end";
      }
      at.fixRound += 1;
      ctx.line({
        text: `${failure.label} failed; asking the agent to fix it (round ${at.fixRound}/${MAX_FIX_ROUNDS})`,
        kind: "step",
      });
      at.prompt = { kind: "fix", command: failure.label, output: failure.output };
      at.phase = "agent";
      return "continue";
    }
    case "commit-push": {
      const outcome = at.outcome!;
      await ctx.step<CommitPushResult>("commit-push", {
        summary: outcome.summary,
        reasoning: outcome.reasoning,
        request: run.mode === "continue" ? run.message : run.request,
      });
      await ctx.status("deploying");
      at.phase = "deploy-preview";
      return "continue";
    }
    case "deploy-preview": {
      const result = await ctx.step<DeployResult>("deploy-preview");
      // The Preview URL is not for people: the session posts the branch link once
      // the deploy is recorded. Only the agent's own words go here.
      await ctx.say(at.outcome?.message.trim() || "The change is ready.");
      await ctx.finish("deployed", result);
      return "end";
    }
    case "deploy-production":
      await ctx.step("deploy-production");
      at.phase = "cleanup";
      return "continue";
    case "restore-database": {
      if (run.mode !== "revert") throw new Error("only a revert restores the database");
      const to = new Date(run.revert.restoreTo).toISOString();
      ctx.line({ text: `restoring the production database to ${to}`, kind: "step" });
      // Right before the deploy: the code that runs meanwhile is the newer one.
      await ctx.restoreDatabase(run.revert.restoreTo);
      await ctx.say(
        `The production database is back to ${to}; users, sign-ins, build sessions, branches and settings were kept as they are. Deploying the reverted version.`,
      );
      at.phase = "deploy-revert";
      return "continue";
    }
    case "deploy-revert":
      await ctx.step("deploy-production");
      await ctx.say(
        `Reverted: main is at ${at.mergedHead?.slice(0, 12) ?? "the earlier version"} and production is deployed from it.`,
      );
      await ctx.finish("reverted");
      return "end";
    case "cleanup":
      await ctx.step("cleanup");
      if (run.mode === "merge") {
        await ctx.say("Merged into main and deployed.");
        await ctx.finish("merged", { headCommit: at.mergedHead ?? undefined });
      } else {
        await ctx.say("Branch abandoned.");
        await ctx.finish("abandoned");
      }
      return "end";
  }
  throw new Error(`unknown phase ${String(at.phase)}`);
}

/** A reply to a parked run, as the next agent turn's prompt. */
export function replyPrompt(pending: Pending): Checkpoint["prompt"] {
  return { kind: "continue", ...pending, sync: NO_SYNC };
}

/** The run's status line per phase, for people. */
export const PHASE_TEXT: Record<string, string> = {
  prepare: "preparing the workspace",
  install: "installing",
  agent: "the coding agent is working",
  verify: "verifying",
  "commit-push": "committing and pushing",
  "deploy-preview": "deploying the Preview",
  "deploy-production": "deploying production",
  "restore-database": "restoring the production database",
  "deploy-revert": "deploying production",
  cleanup: "cleaning up",
};

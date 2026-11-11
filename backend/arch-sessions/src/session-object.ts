import { Think, type TurnConfig, type TurnContext } from "@cloudflare/think";
import type {
  AgentToolLifecycleResult,
  AgentToolRunInfo,
  Connection,
  ConnectionContext,
} from "agents";
import { tool, type LanguageModel, type ToolSet, type UIMessage } from "ai";
import { z } from "zod";
import {
  archiveBranch,
  branchForSession,
  createBranch,
  markDeployed,
} from "@backend/arch-branches/service";
import { BuilderRunHandle } from "@backend/arch-builder/run-handle";
import { sessionStatusFor, type RelayedStatus } from "@backend/arch-builder/events";
import { buildRun, continueRun } from "@backend/arch-builder/runs";
import type {
  BuilderFile,
  BuilderRun,
  BuilderStatusDetail,
} from "@backend/arch-builder/protocol";
import { plannerSystemPrompt, plannerToolsFor } from "@backend/arch-planner/prompts";
import { repositoryTools } from "@backend/arch-planner/tools";
import { mainHead } from "@backend/arch-repository/service";
import { getBuilderModel } from "@backend/arch-settings/service";
import { gatewayModel } from "@backend/commons/gateway-model";
import { logger } from "@backend/commons/logger";
import {
  MAIN_BRANCH,
  ROLES,
  type Principal,
  type Role,
} from "@backend/commons/principal";
import {
  BUILDER_SAYS,
  type BuildMessageMetadata,
  type BuildPhase,
} from "@shared/contract/arch/sessions";
import { DEFAULT_BUILDER_MODEL } from "@shared/contract/arch/settings";
import {
  BUILD_FAILED_MESSAGE,
  BUILD_INTERRUPTED_MESSAGE,
  DEPLOYED_MESSAGE,
} from "./messages";
import {
  markSessionArchived,
  setSessionStatus,
  setSessionTitle,
  SOCKET_HEADERS,
  touchSession,
} from "./service";

const log = logger("arch-sessions/session-object");

/** Synced to every connected client as it changes. */
export interface SessionState {
  phase: BuildPhase;
  /** Who last connected; the member a build is started for. */
  principal: Principal | null;
}

const TITLE_LENGTH = 80;
/**
 * How long a builder run may live before the session gives it up: a build
 * parked on a question waits for the member, for days if need be.
 */
const RUN_BUDGET_MS = 7 * 24 * 60 * 60_000;
/** The run's record in the session's storage, between turns. */
const KEYS = {
  plan: "plan",
  branchName: "branchName",
  branchId: "branchId",
  request: "request",
  title: "title",
  deployedOnce: "deployedOnce",
} as const;

/**
 * One build session: the chat with the planner, and the builder runs it
 * dispatches. An agent on Think, named by the session id: the planner is its
 * model, with tools to read the repository, record a plan, start the build
 * and pass the member's words to the builder. Each build, merge or abandon
 * is a run of the builder as the session's sub-agent, so the chat shows the
 * run beside the planner's reply as it happens and again after a reload. The
 * builder reports back by RPC: its messages join the conversation as said to
 * the planner, and its status moves the session along its phases.
 */
export class BuildSessionObject extends Think<Cloudflare.Env, SessionState> {
  initialState: SessionState = { phase: "planning", principal: null };

  /**
   * An attachment is read by the turn it came with and the next one, then
   * moved out of the transcript so no later turn pays for it again.
   */
  override mediaEviction = { keepRecentMessages: 2 };
  override truncationStep = 2;

  // ── Connections ───────────────────────────────────────────────────────────

  /** The upgrade request the router forwarded, with the identity in headers. */
  override async onConnect(
    connection: Connection,
    ctx: ConnectionContext,
  ): Promise<void> {
    const principal = readPrincipal(ctx.request.headers);
    if (!principal) {
      connection.close(1008, "Missing identity");
      return;
    }
    this.setState({ ...this.state, principal });
    log.info("socket accepted", { sessionId: this.name, userId: principal.userId });
    await super.onConnect(connection, ctx);
  }

  /** Only runs this session dispatched can be reached through it. */
  override async onBeforeSubAgent(
    _request: Request,
    child: { className: string; name: string },
  ): Promise<Response | undefined> {
    if (!this.hasAgentToolRun(child.className, child.name)) {
      return new Response("Not found", { status: 404 });
    }
    return undefined;
  }

  // ── The planner ───────────────────────────────────────────────────────────

  /** The default until the first turn, which reads the household's choice. */
  override getModel(): string {
    return `anthropic/${DEFAULT_BUILDER_MODEL}`;
  }

  /** The planner's model goes through the household's gateway, logged as the planner's. */
  override resolveModel(model: string | LanguageModel = this.getModel()): LanguageModel {
    if (typeof model !== "string") return super.resolveModel(model);
    const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token } = this.env;
    if (!accountId || !token) {
      throw new Error(
        "The planner has no account token for the gateway: set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID",
      );
    }
    const resolved = gatewayModel(model, { accountId, token }, this.modelMetadata());
    if (!resolved) throw new Error(`The planner runs Anthropic models, not "${model}"`);
    return resolved;
  }

  /** What the gateway's log says about a request: the planner runs before a branch exists, so it is tagged with main. */
  private modelMetadata(): Record<string, string> {
    return {
      agent: "planner",
      host: hostOf(this.env.APP_ORIGIN),
      branch: MAIN_BRANCH,
      sessionId: this.name,
    };
  }

  override getSystemPrompt(): string {
    return plannerSystemPrompt(this.state.phase);
  }

  override getTools(): ToolSet {
    return { ...repositoryTools(), ...this.sessionTools() };
  }

  /** Each turn: the household's chosen model, the phase's tools, and the session's record kept fresh. */
  override async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    if (!ctx.continuation) await this.noteUserMessage();
    const model = await getBuilderModel().catch(() => DEFAULT_BUILDER_MODEL);
    return {
      model: `anthropic/${model}`,
      system: this.getSystemPrompt(),
      activeTools: plannerToolsFor(this.state.phase),
    };
  }

  /** The session row follows the member's messages; the first one names the session. */
  private async noteUserMessage(): Promise<void> {
    const last = this.lastMemberMessage();
    if (!last) return;
    await touchSession(this.name).catch((err: unknown) =>
      log.warn("touch failed", { err, sessionId: this.name }),
    );
    if (await this.ctx.storage.get<string>(KEYS.title)) return;
    const text = textOf(last).replace(/\s+/g, " ").trim();
    const title = (text || fileNamesOf(last).join(", ") || "Untitled change").slice(
      0,
      TITLE_LENGTH,
    );
    await this.ctx.storage.put(KEYS.title, title);
    await this.ctx.storage.put(KEYS.request, text || title);
    await setSessionTitle(this.name, title);
  }

  /** The tools that move the session along; which ones a turn may call depends on its phase. */
  private sessionTools(): ToolSet {
    return {
      propose_plan: tool({
        description:
          "Records the plan for the coding agent and the change's short name, which becomes the branch name. Call it before showing the member a plan.",
        inputSchema: z.object({
          name: z
            .string()
            .describe("Two plain words naming the change, lowercase, no punctuation"),
          plan: z
            .string()
            .describe("The plan, markdown, as the coding agent will read it"),
        }),
        execute: async ({ name, plan }) => {
          await this.ctx.storage.put(KEYS.plan, plan);
          await this.ctx.storage.put(KEYS.branchName, name.trim());
          return "The plan is recorded. Show it to the member and ask them to confirm it.";
        },
      }),
      start_build: tool({
        description:
          "Hands the recorded plan to the builder, which starts on a new branch. Call it only once the member has agreed to the plan.",
        inputSchema: z.object({}),
        execute: async (_input, { toolCallId }) => {
          const plan = await this.ctx.storage.get<string>(KEYS.plan);
          if (!plan)
            return "No plan is recorded yet: propose one first and have the member confirm it.";
          await this.startBuild(plan, toolCallId);
          return "The build has started. Tell the member in one short sentence.";
        },
      }),
      tell_builder: tool({
        description:
          "Passes the member's latest message to the builder, unchanged, with any picture or file they attached. For answers to the builder's questions, further changes to the branch, and problems with what was deployed.",
        inputSchema: z.object({
          message: z.string().describe("The member's words, in full"),
        }),
        execute: async ({ message }, { toolCallId }) => {
          await this.tellBuilder(message, toolCallId);
          return "Delivered to the builder. Tell the member in one short sentence that the builder has it.";
        },
      }),
    };
  }

  // ── Builds ────────────────────────────────────────────────────────────────

  private async startBuild(plan: string, toolCallId: string): Promise<void> {
    const who = this.state.principal;
    if (!who) throw new Error("No member is connected to start the build for");
    const title = (await this.ctx.storage.get<string>(KEYS.title)) ?? "Untitled change";
    const request = (await this.ctx.storage.get<string>(KEYS.request)) ?? title;
    const branch = await createBranch(who, {
      buildSessionId: this.name,
      name: (await this.ctx.storage.get<string>(KEYS.branchName)) ?? title,
      baseCommit: await mainHead(),
    });
    await this.ctx.storage.put(KEYS.branchId, branch.id);
    this.setPhase("building");
    await setSessionStatus(this.name, "building");
    // Whatever the member attached while the plan was made goes with it.
    const files = this.memberMessages().flatMap(filesOf);
    const run = await buildRun({ sessionId: this.name, branch, request, plan, files });
    await this.runBuilder(run, toolCallId);
    log.info("build started", { sessionId: this.name, branchId: branch.id });
  }

  /** The member's words, and the files of their latest message, to the builder; a new run when it is idle. */
  private async tellBuilder(message: string, toolCallId: string): Promise<void> {
    const files = filesOf(this.lastMemberMessage());
    const outcome = await this.env.BUILDERS.getByName(this.name).continueWith(
      message,
      files,
    );
    log.info("message for the builder", { sessionId: this.name, outcome });
    if (outcome !== "idle") {
      if (this.state.phase !== "building") {
        this.setPhase("building");
        await setSessionStatus(this.name, "building");
      }
      return;
    }
    const request = (await this.ctx.storage.get<string>(KEYS.request)) ?? message;
    const run = await continueRun({ sessionId: this.name, request, message, files });
    this.setPhase("building");
    await setSessionStatus(this.name, "building");
    await this.runBuilder(run, toolCallId);
  }

  /** A merge or an abandon from the branch menu, as a run of its own. */
  async startRun(run: BuilderRun): Promise<void> {
    log.info("run received", { sessionId: this.name, mode: run.mode });
    await this.runBuilder(run);
  }

  /**
   * Runs the builder as this session's sub-agent, in the background:
   * the run's lines reach the chat as they come, and `onBuildFinished` is
   * called once the run is over, even if this object was evicted meanwhile.
   * A run on a parked build waits for the member, so it is given days, not
   * hours, and is never given up for being quiet.
   */
  private async runBuilder(run: BuilderRun, parentToolCallId?: string): Promise<void> {
    const started = await this.runAgentTool(BuilderRunHandle, {
      input: { sessionId: this.name, run },
      // The run carries credentials: the record and the clients see only this.
      inputPreview: { mode: run.mode, branch: run.branch.name },
      display: { name: "Builder", mode: run.mode },
      parentToolCallId,
      detached: {
        onFinish: "onBuildFinished",
        maxBudgetMs: RUN_BUDGET_MS,
        noProgressBudgetMs: 0,
      },
    });
    if (started.status === "error") throw new Error("The builder run could not start");
  }

  /** A run ended without the builder reporting its outcome: the session says so. */
  async onBuildFinished(
    run: AgentToolRunInfo,
    result: AgentToolLifecycleResult,
  ): Promise<void> {
    log.info("builder run finished", {
      sessionId: this.name,
      runId: run.runId,
      status: result.status,
    });
    if (result.status === "completed" || result.status === "aborted") return;
    if (this.state.phase !== "building" && this.state.phase !== "waiting") return;
    this.setPhase("failed");
    await setSessionStatus(this.name, "failed");
    await this.post(
      BUILD_INTERRUPTED_MESSAGE.replace("{reason}", result.error ?? result.status),
    );
  }

  // ── RPC from the BuilderObject ────────────────────────────────────────────

  /** A builder message for the chat: said to the planner, shown as the builder's. */
  async relay(text: string): Promise<void> {
    const metadata: BuildMessageMetadata = { author: "builder" };
    await this.addMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        metadata,
        parts: [{ type: "text", text: `${BUILDER_SAYS}${text}` }],
      },
    ]);
    void touchSession(this.name).catch((err: unknown) =>
      log.warn("touch failed", { err, sessionId: this.name }),
    );
  }

  /** The builder's progress; the session row and the branch row follow it. */
  async builderStatus(
    status: RelayedStatus,
    detail?: BuilderStatusDetail,
  ): Promise<void> {
    const sessionId = this.name;
    log.info("builder status", { sessionId, status });
    if (this.state.phase === "closed") {
      // Archived meanwhile: a late builder report must not reopen the session.
      log.info("builder status ignored: session closed", { sessionId, status });
      return;
    }
    switch (status) {
      case "building":
      case "deploying":
      case "waiting":
        this.setPhase(status === "waiting" ? "waiting" : "building");
        await setSessionStatus(sessionId, sessionStatusFor(status));
        return;
      case "deployed":
        await this.onDeployed(detail);
        return;
      case "failed":
        this.setPhase("failed");
        await setSessionStatus(sessionId, "failed");
        await this.post(
          BUILD_FAILED_MESSAGE.replace("{error}", detail?.error ?? "unknown error"),
        );
        return;
      case "timed_out":
        // The builder explained itself in the chat; the next message resumes the run.
        this.setPhase("timed_out");
        await setSessionStatus(sessionId, "timed_out");
        return;
      case "merged":
      case "abandoned": {
        const branchId = await this.branchId();
        if (branchId) await archiveBranch(branchId, status);
        this.setPhase("closed");
        await setSessionStatus(sessionId, status);
        await markSessionArchived(sessionId);
        await this.post(
          status === "merged"
            ? "The branch was merged into production and archived."
            : "The branch was abandoned and archived.",
        );
        return;
      }
    }
  }

  private async onDeployed(detail?: BuilderStatusDetail): Promise<void> {
    const sessionId = this.name;
    const branchId = await this.branchId();
    if (!branchId || !detail?.previewUrl) {
      log.error("deploy reported without branch or preview url", { sessionId, branchId });
      await this.builderStatus("failed", {
        error: "the builder reported a deploy without a Preview URL",
      });
      return;
    }
    await markDeployed(branchId, {
      previewUrl: detail.previewUrl,
      databaseId: detail.databaseId ?? "",
      headCommit: detail.headCommit ?? "",
      baseCommit: detail.baseCommit,
    });
    this.setPhase("deployed");
    await setSessionStatus(sessionId, "deployed");
    // The branch link is explained once; later deploys speak through the builder's own message.
    if (await this.ctx.storage.get<boolean>(KEYS.deployedOnce)) return;
    await this.ctx.storage.put(KEYS.deployedOnce, true);
    const url = `${this.env.APP_ORIGIN}/?branch=${encodeURIComponent(branchId)}`;
    await this.post(DEPLOYED_MESSAGE.replace("{url}", url));
  }

  // ── Archiving ─────────────────────────────────────────────────────────────

  /** Archived by hand: the chat stays readable and answers nothing but the closed notice. */
  async archive(): Promise<void> {
    this.setPhase("closed");
  }

  /** Cleared: the conversation, the runs and every alarm are gone; open connections are closed. */
  async clear(): Promise<void> {
    for (const connection of this.getConnections()) {
      try {
        connection.close(1000, "cleared");
      } catch {
        // Already gone.
      }
    }
    await this.clearAgentToolRuns();
    log.info("session cleared", { sessionId: this.name });
    await this.destroy();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** A message of the session's own, in the planner's voice. */
  private async post(text: string): Promise<void> {
    await this.addMessages([
      { id: crypto.randomUUID(), role: "assistant", parts: [{ type: "text", text }] },
    ]);
    void touchSession(this.name).catch((err: unknown) =>
      log.warn("touch failed", { err, sessionId: this.name }),
    );
  }

  /** The member's messages, in order: the builder's relays sit on the same side but are not theirs. */
  private memberMessages(): UIMessage[] {
    return this.messages.filter(
      (message) =>
        message.role === "user" &&
        (message.metadata as BuildMessageMetadata | undefined)?.author !== "builder",
    );
  }

  private lastMemberMessage(): UIMessage | undefined {
    return this.memberMessages().at(-1);
  }

  private async branchId(): Promise<string | null> {
    const stored = await this.ctx.storage.get<string>(KEYS.branchId);
    if (stored) return stored;
    const branch = await branchForSession(this.name);
    if (branch) await this.ctx.storage.put(KEYS.branchId, branch.id);
    return branch?.id ?? null;
  }

  private setPhase(phase: BuildPhase): void {
    this.setState({ ...this.state, phase });
  }
}

function readPrincipal(headers: Headers): Principal | null {
  const userId = headers.get(SOCKET_HEADERS.userId);
  const role = headers.get(SOCKET_HEADERS.userRole);
  if (!userId || !role || !(ROLES as readonly string[]).includes(role)) return null;
  return {
    userId,
    name: headers.get(SOCKET_HEADERS.userName) ?? "",
    email: headers.get(SOCKET_HEADERS.userEmail) ?? "",
    role: role as Role,
  };
}

function textOf(message: UIMessage): string {
  return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function fileNamesOf(message: UIMessage): string[] {
  return message.parts.flatMap((part) =>
    part.type === "file" ? [part.filename ?? part.mediaType] : [],
  );
}

/** The files of a message as the builder takes them: name, type and bytes. */
function filesOf(message: UIMessage | undefined): BuilderFile[] {
  if (!message) return [];
  return message.parts.flatMap((part) => {
    if (part.type !== "file") return [];
    const data = base64Of(part.url);
    if (!data) return [];
    return [{ name: part.filename ?? part.mediaType, mediaType: part.mediaType, data }];
  });
}

/** The base64 payload of a data URL, or null for any other URL. */
function base64Of(url: string): string | null {
  const match = /^data:[^;,]*;base64,(.*)$/s.exec(url);
  return match?.[1] ?? null;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

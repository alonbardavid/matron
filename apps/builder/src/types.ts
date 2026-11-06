/**
 * What the Worker's BuilderObject and this image agree on. Mirrors
 * `backend/arch-builder/src/protocol.ts` on the Worker side.
 *
 * The object drives the container through the Agents SDK container harness:
 * every unit of work is one harness turn, whose prompt is a JSON
 * {@link TurnRequest}. The daemon in this image (`daemon.ts`) runs a step
 * turn as `node /app/dist/cli.js <step>` and an agent turn as the coding
 * agent's CLI in the checkout.
 */

export type JobMode = "build" | "continue" | "merge" | "abandon" | "revert";

export type BuilderJob = {
  mode: JobMode;
  sessionId: string;
  branch: {
    id: string;
    name: string;
    previewName: string;
    databaseName: string;
    baseCommit: string;
  };
  repository: { remote: string; token: string };
  cloudflare: {
    accountId: string;
    apiToken: string;
    workerName: string;
    productionDatabaseName: string;
    appOrigin: string;
    aiGateway: string;
  };
  signingKey: string;
  request: string;
  plan?: string;
  message?: string;
  /** A revert's target: main goes back to `commit`'s tree. */
  revert?: { commit: string; restoreTo: number; alsoReverted: string[] };
  builderImage?: string;
};

/** The step commands: `node /app/dist/cli.js <step>`. */
export type StepName =
  | "prepare-build"
  | "prepare-continue"
  | "prepare-cleanup"
  | "install"
  | "verify"
  | "commit-push"
  | "deploy-preview"
  | "merge-main"
  | "deploy-production"
  | "cleanup"
  | "revert-main";

/** How the agent's prompt for one turn is built; the templates live in /app/prompts. */
export type AgentPrompt =
  | { kind: "build"; extra: string }
  | { kind: "continue"; message: string; sync: string }
  | { kind: "fix"; command: string; output: string };

/** What a step reads besides the job, when it needs more. */
export type StepInput = { summary: string; reasoning: string; request: string };

/** A harness turn's prompt: a step to run, or a turn of the coding agent. */
export type TurnRequest =
  | { kind: "step"; step: StepName; job: BuilderJob; input?: StepInput }
  | { kind: "agent"; prompt: AgentPrompt; job: BuilderJob; model: string };

/** One line of a step's output; anything that is not JSON is a log line. */
export type StepLine =
  | { type: "progress"; text: string }
  | { type: "log"; text: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string; output?: string };

/** What the coding agent returns at the end of a turn (the structured output). */
export type AgentOutcome = {
  status: "done" | "question" | "blocked";
  summary: string;
  reasoning: string;
  message: string;
};

export type PrepareContinueResult = { sync: string };
export type VerifyResult = { failure: { label: string; output: string } | null };
export type CommitPushResult = { committed: boolean };
export type MergeMainResult = { headCommit: string };
export type RevertMainResult = { headCommit: string; committed: boolean };

export type DeployResult = {
  previewUrl: string;
  databaseId: string;
  headCommit: string;
  baseCommit: string;
};

/** Raised for failures that should reach the user as a readable builder message. */
export class JobError extends Error {
  constructor(
    message: string,
    readonly output?: string,
  ) {
    super(message);
    this.name = "JobError";
  }
}

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

export type RunMode = "build" | "continue" | "merge" | "abandon";

export type BuilderRun = {
  mode: RunMode;
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
  request: string;
  plan?: string;
  message?: string;
  files?: BuilderFile[];
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
  | "cleanup";

/** A file the user attached to a message for the agent: written to the attachments folder, named in the prompt. */
export interface BuilderFile {
  name: string;
  mediaType: string;
  /** The bytes, base64. */
  data: string;
}

/** How the agent's prompt for one turn is built; the templates live in /app/prompts. */
export type AgentPrompt =
  | { kind: "build"; extra: string; files?: BuilderFile[] }
  | { kind: "continue"; message: string; sync: string; files?: BuilderFile[] }
  | { kind: "fix"; command: string; output: string };

/** Mirrors BRACKET_KINDS in `shared/contract/src/arch/review.ts`. */
export const BRACKET_KINDS = [
  "flow",
  "schema",
  "refactor",
  "move",
  "tests",
  "config",
  "docs",
  "other",
] as const;

/**
 * The agent's review of the whole branch, stored in the commit's
 * `Matron-Review` trailer; mirrors `reviewTrailerSchema` on the Worker side.
 */
export type ReviewTrailer = {
  summary: string;
  brackets: {
    title: string;
    kind: (typeof BRACKET_KINDS)[number];
    description: string;
    ranges: { path: string; start: number; end: number; note: string }[];
  }[];
};

/** What a step reads besides the run, when it needs more. */
export type StepInput = {
  summary: string;
  reasoning: string;
  request: string;
  review?: ReviewTrailer;
};

/** A harness turn's prompt: a step to run, or a turn of the coding agent. */
export type TurnRequest =
  | { kind: "step"; step: StepName; run: BuilderRun; input?: StepInput }
  | { kind: "agent"; prompt: AgentPrompt; run: BuilderRun; model: string };

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
  review?: ReviewTrailer;
};

export type PrepareContinueResult = { sync: string };
export type VerifyResult = { failure: { label: string; output: string } | null };
export type CommitPushResult = { committed: boolean };
export type MergeMainResult = { headCommit: string };

export type DeployResult = {
  previewUrl: string;
  databaseId: string;
  headCommit: string;
  baseCommit: string;
};

/** Raised for failures that should reach the user as a readable builder message. */
export class BuilderError extends Error {
  constructor(
    message: string,
    readonly output?: string,
  ) {
    super(message);
    this.name = "BuilderError";
  }
}

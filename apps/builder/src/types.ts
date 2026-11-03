/**
 * The HTTP protocol between the Worker's BuilderObject and this container.
 * Mirrors `backend/arch-builder/src/protocol.ts` on the Worker side.
 */

export type JobMode = "build" | "continue" | "merge" | "abandon";

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
  builderImage?: string;
};

export type BuilderStatus =
  | "idle"
  | "building"
  | "waiting"
  | "deploying"
  | "deployed"
  | "merging"
  | "merged"
  | "abandoning"
  | "abandoned"
  | "failed";

export type StatusDetail = {
  previewUrl?: string;
  databaseId?: string;
  headCommit?: string;
  /** The commit of main the branch now contains; the merge check compares it with main's head. */
  baseCommit?: string;
  error?: string;
};

export type BuilderEventBody =
  | { type: "message"; text: string }
  | { type: "status"; status: BuilderStatus; detail?: StatusDetail }
  // A step the user may watch in the chat ("cloning", "running pnpm build").
  | { type: "progress"; text: string }
  // Raw command output; operators only.
  | { type: "log"; text: string };

export type BuilderEvent = { seq: number; ts: number } & BuilderEventBody;

/** What the Worker sends down the socket. */
export type SocketFrame = { type: "message"; text: string };

/** What the coding agent returns at the end of a turn (the --json-schema). */
export type AgentOutcome = {
  status: "done" | "question" | "blocked";
  summary: string;
  reasoning: string;
  message: string;
};

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

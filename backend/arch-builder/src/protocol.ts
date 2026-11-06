/**
 * The protocol between the BuilderObject (a Durable Object in the Worker) and
 * the builder image (apps/builder). This file is the contract both sides are
 * written against; it has no runtime dependencies so the image can mirror it
 * as plain types (apps/builder/src/types.ts).
 *
 * Transport
 * ---------
 * The object drives the container through the Agents SDK container harness.
 * Every unit of work is one harness turn whose prompt is a JSON
 * {@link TurnRequest}: a `step` runs `node /app/dist/cli.js <step>` in the
 * container with the request on its stdin, an `agent` turn runs the coding
 * agent in the checkout. The daemon in the image (`apps/builder/src/daemon.ts`)
 * reports a step's lines as events and its last line as the turn's outcome;
 * the harness keeps the operation durable, reattaches after an eviction and
 * snapshots the workspace when the container idles. The container never
 * calls the Worker.
 *
 * Steps
 * -----
 * A step prints {@link StepLine}s, one JSON object per line: `progress` is a
 * step the user watches in the chat ("cloning", "running pnpm build"), `log`
 * is command output for operators, and the last line is `result` with the
 * step's data or `error` with a readable message (exit code 1). Anything
 * that is not JSON is treated as a log line.
 *
 *   prepare-build      clone `repository.remote`, cut `branch.name` from `branch.baseCommit`
 *   prepare-continue   reuse the restored checkout (or clone the branch), fetch main → {@link PrepareContinueResult}
 *   prepare-cleanup    make sure the repository's dependencies exist for a cleanup
 *   install            pnpm install, skipped when the lockfile is already installed
 *   verify             type-check, build, tests → {@link VerifyResult}
 *   commit-push        commit the working tree with the input's message and push the branch → {@link CommitPushResult}
 *   deploy-preview     build, clone the production D1 into `branch.databaseName` if needed, migrate it, deploy the Preview → {@link DeployResult}
 *   merge-main         fast-forward main onto the branch and push it (fails when main diverged) → {@link MergeMainResult}
 *   deploy-production  build, migrate the production D1, deploy production
 *   cleanup            delete the Preview, the branch D1, the remote branch and the branch's R2 prefix
 *
 * The object sequences them: a build or a continue runs prepare, install,
 * agent turns until the agent is done (a question parks the run as `waiting`
 * until the user replies), verify with up to three fix turns, commit-push,
 * deploy-preview; a merge runs merge-main, install, deploy-production,
 * cleanup; an abandon runs prepare-cleanup, cleanup.
 *
 * Status rules
 * ------------
 * The object reports to the session (RPC on the session's object), and the
 * session's agent-tool run of the builder follows: the builder's lines stream as
 * the run's chunks, and the run ends with the work.
 *   building → (waiting ↔ building)* → deploying → deployed | failed
 *   merging → merged | failed
 *   abandoning → abandoned | failed
 * A run parked as `waiting` runs nothing; the harness snapshots and stops
 * the container after its idle timeout (five minutes) and restores it for
 * the next turn.
 */

export type RunMode = "build" | "continue" | "merge" | "abandon";

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
  | "failed"
  | "timed_out";

/** The branch a run works on; names come from the branch row. */
export interface BuilderBranch {
  id: string;
  /** Git branch name, the slug the planner named, e.g. "shopping-list". */
  name: string;
  /** Preview (Worker) name; the Preview URL derives from it. */
  previewName: string;
  /** The branch's own D1 database name. */
  databaseName: string;
  /** Main's head when the branch was cut. */
  baseCommit: string;
}

export interface BuilderRepository {
  /** HTTPS git remote of the Artifacts repository. */
  remote: string;
  /** A short-lived write token; use it as the password with any user name. */
  token: string;
}

export interface BuilderCloudflare {
  accountId: string;
  apiToken: string;
  /** The production Worker name; Previews are deployed under it. */
  workerName: string;
  productionDatabaseName: string;
  /** The production URL, for links in messages. */
  appOrigin: string;
  /** AI Gateway id; the agent's model calls go through it with `apiToken`. */
  aiGateway: string;
}

interface RunBase {
  sessionId: string;
  branch: BuilderBranch;
  repository: BuilderRepository;
  cloudflare: BuilderCloudflare;
  /** The production SIGNING_KEY; set as a secret on every Preview. */
  signingKey: string;
  /** The production SECRETS_KEY; set on every Preview, whose database copy holds values it sealed. */
  secretsKey: string;
  /** The user's original request, for the commit message. */
  request: string;
  /** The image reference used for production's container, repeated on deploys. */
  builderImage?: string;
}

export interface BuildRun extends RunBase {
  mode: "build";
  /** The plan the user agreed to. */
  plan: string;
  /** Pictures or files the user attached while the plan was made; the agent reads them. */
  files?: BuilderFile[];
}

export interface ContinueRun extends RunBase {
  mode: "continue";
  /** What the user said after the container had stopped. */
  message: string;
  /** What came with it: pictures or files the agent is to read. */
  files?: BuilderFile[];
}

export interface MergeRun extends RunBase {
  mode: "merge";
}

export interface AbandonRun extends RunBase {
  mode: "abandon";
}

export type BuilderRun = BuildRun | ContinueRun | MergeRun | AbandonRun;

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

/**
 * A file the user attached to a message for the agent: the daemon writes it
 * to the container's attachments folder, outside the checkout, and names it in the prompt.
 */
export interface BuilderFile {
  name: string;
  mediaType: string;
  /** The bytes, base64. */
  data: string;
}

/** How the agent's prompt for one turn is built; the templates live in the image. */
export type AgentPrompt =
  | { kind: "build"; extra: string; files?: BuilderFile[] }
  | { kind: "continue"; message: string; sync: string; files?: BuilderFile[] }
  | { kind: "fix"; command: string; output: string };

/** What a step reads besides the run, when it needs more. */
export interface StepInput {
  summary: string;
  reasoning: string;
  request: string;
}

/** A harness turn's prompt: a step to run, or a turn of the coding agent. */
export type TurnRequest =
  | { kind: "step"; step: StepName; run: BuilderRun; input?: StepInput }
  | { kind: "agent"; prompt: AgentPrompt; run: BuilderRun; model: string };

export type StepLine =
  | { type: "progress"; text: string }
  | { type: "log"; text: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string; output?: string };

/** What the coding agent returns at the end of a turn. */
export interface AgentOutcome {
  status: "done" | "question" | "blocked";
  summary: string;
  reasoning: string;
  message: string;
}

export interface PrepareContinueResult {
  sync: string;
}
export interface VerifyResult {
  failure: { label: string; output: string } | null;
}
export interface CommitPushResult {
  committed: boolean;
}
export interface MergeMainResult {
  headCommit: string;
}
export interface DeployResult {
  previewUrl: string;
  databaseId: string;
  headCommit: string;
  /** The commit of main the branch contains after this deploy; the merge check compares it with main's head. */
  baseCommit: string;
}

/** What a status report may carry; only `deployed`, `merged` and `failed` use it. */
export interface BuilderStatusDetail {
  previewUrl?: string;
  databaseId?: string;
  headCommit?: string;
  baseCommit?: string;
  error?: string;
}

/** Statuses after which there is nothing more to do for a run. */
export type TerminalStatus = "deployed" | "failed" | "merged" | "abandoned";
export const TERMINAL_STATUSES: ReadonlySet<BuilderStatus> = new Set<TerminalStatus>([
  "deployed",
  "failed",
  "merged",
  "abandoned",
]);

/**
 * The protocol between the BuilderObject (a Durable Object in the Worker) and
 * the builder container (apps/builder). This file is the contract both sides
 * are written against; it has no runtime dependencies so the container can
 * import it as plain types.
 *
 * Transport
 * ---------
 * The container listens on TCP port {@link BUILDER_PORT} (8080). The Durable
 * Object reaches it through `ctx.container.getTcpPort(8080)`, so the host part
 * of the URL is meaningless; only the path and method matter. The container
 * never calls the production URL and never opens a connection to the Worker:
 * the Durable Object opens one WebSocket into the container and both sides
 * talk on it for as long as the container runs.
 *
 * Endpoints
 * ---------
 * `GET /health`
 *   200 `{ ok: true }` as soon as the server accepts requests. The Durable
 *   Object retries this after `start()` (fresh or from a snapshot) until it
 *   answers, then posts the job.
 *
 * `POST /jobs`  body: {@link BuilderJob}  → 202 (or 409 if a job is running)
 *   Starts the job in the background. The job carries every credential the
 *   container needs; nothing is read from the environment except what the
 *   Durable Object also put there (CLOUDFLARE_API_TOKEN & co.). The container
 *   must keep running after the job finishes so the Durable Object can read
 *   the last events and take a snapshot.
 *
 *   mode "build":    clone `repository.remote`, create `branch.name` from
 *                    `branch.baseCommit`, run the coding agent with `plan`,
 *                    then test, commit (summary + `request` + reasoning), push,
 *                    clone the production D1 into `branch.databaseName`, apply
 *                    the branch's migrations to it, deploy the Preview named
 *                    `branch.previewName` with `builderImage` as the container
 *                    reference and `signingKey` as a Preview secret,
 *                    and emit `deployed` with the preview URL, the D1 id and
 *                    the head commit.
 *   mode "continue": the user sent `message` after the container stopped. The
 *                    container is usually restored from a snapshot and still
 *                    has its workspace; when the workspace is missing (first
 *                    start without a snapshot) it clones `branch.name` first.
 *                    It feeds `message` to the agent and ends the same way as
 *                    "build": redeploy, then `deployed`.
 *   mode "merge":    fast-forward main onto `branch.name` (fail with
 *                    `failed` if main has diverged), push main, apply the
 *                    branch's pending migrations to `cloudflare.productionDatabaseName`,
 *                    deploy production (`cloudflare.workerName`), delete the
 *                    branch's D1, the Preview and the objects under the
 *                    branch's R2 prefix, delete the branch, then emit `merged`.
 *   mode "abandon":  the cleanup half of merge only, then `abandoned`.
 *
 * `GET /ws?after=<seq>`  WebSocket upgrade
 *   The connection. The container first replays every event with `seq`
 *   greater than `after`, in order, then pushes each new {@link BuilderEvent}
 *   as one JSON text frame. `seq` starts at 1 and never repeats inside one
 *   container life; a container restored from a snapshot must continue from
 *   the stored counter, never restart at 1, or the Durable Object will miss
 *   events (it keeps the last seq it saw across restores). The Durable Object
 *   reconnects with its last seq whenever the connection drops.
 *
 *   Frames from the Durable Object are {@link BuilderSocketFrame}: a user
 *   reply while a job is running or `waiting`. The container buffers it until
 *   the agent asks for direction, or hands it over immediately when the agent
 *   is waiting. After `waiting` it must emit `building` once it resumes work.
 *
 * Status rules
 * ------------
 * A status event is the only way the container changes what the user sees:
 *   idle → building → (waiting ↔ building)* → deploying → deployed | failed
 *   idle → merging → merged | failed
 *   idle → abandoning → abandoned | failed
 * `waiting`, `deployed`, `failed`, `merged` and `abandoned` make the Durable
 * Object snapshot (build/continue modes) and stop the container, after a grace
 * period of five minutes for `waiting`. The container must therefore emit
 * them only once its filesystem is quiescent: files flushed, no background
 * process writing. Every `message` event is relayed to the chat verbatim as
 * markdown from the builder; `progress` events are the steps the user watches
 * in the chat ("cloning", "running pnpm build"); `log` events are for operators only.
 */

/** The TCP port the container serves on. */
export const BUILDER_PORT = 8080;

export type BuilderMode = "build" | "continue" | "merge" | "abandon";

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

/** The branch a job works on; names come from the branch row. */
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

interface BuilderJobBase {
  sessionId: string;
  branch: BuilderBranch;
  repository: BuilderRepository;
  cloudflare: BuilderCloudflare;
  /** The production SIGNING_KEY; set as a secret on every Preview. */
  signingKey: string;
  /** The user's original request, for the commit message. */
  request: string;
  /** The image reference used for production's container, repeated on deploys. */
  builderImage?: string;
}

export interface BuildJob extends BuilderJobBase {
  mode: "build";
  /** The plan the user agreed to. */
  plan: string;
}

export interface ContinueJob extends BuilderJobBase {
  mode: "continue";
  /** What the user said after the container had stopped. */
  message: string;
}

export interface MergeJob extends BuilderJobBase {
  mode: "merge";
}

export interface AbandonJob extends BuilderJobBase {
  mode: "abandon";
}

export type BuilderJob = BuildJob | ContinueJob | MergeJob | AbandonJob;

/** A frame from the Durable Object to the container. */
export interface BuilderSocketFrame {
  type: "message";
  text: string;
}

/** What a status event may carry; only `deployed` and `failed` use it. */
export interface BuilderStatusDetail {
  previewUrl?: string;
  databaseId?: string;
  headCommit?: string;
  /** The commit of main the branch contains after this deploy; the merge check compares it with main's head. */
  baseCommit?: string;
  error?: string;
}

export type BuilderEvent = { seq: number; ts: number } & (
  | { type: "message"; text: string }
  | { type: "status"; status: BuilderStatus; detail?: BuilderStatusDetail }
  // A step worth showing in the chat; relayed as a `progress` frame.
  | { type: "progress"; text: string }
  // Raw command output; logged for operators only.
  | { type: "log"; text: string }
);

/** Statuses after which the container has nothing more to do for this job. */
export type TerminalStatus = "deployed" | "failed" | "merged" | "abandoned";
export const TERMINAL_STATUSES: ReadonlySet<BuilderStatus> = new Set<TerminalStatus>([
  "deployed",
  "failed",
  "merged",
  "abandoned",
]);

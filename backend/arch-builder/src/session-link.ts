import type { RelayedStatus } from "./events";
import type { BuilderRun, BuilderStatusDetail } from "./protocol";

/**
 * What the builder tells the session it works for, as RPC on the session's
 * Durable Object. The session object implements it; the builder only knows
 * this much about it.
 */
export interface BuildSessionLink extends Rpc.DurableObjectBranded {
  /** A builder message for the chat, markdown. */
  relay(text: string): Promise<void>;
  builderStatus(status: RelayedStatus, detail?: BuilderStatusDetail): Promise<void>;
  /** A merge or an abandon from the branch menu, or a revert from troubleshooting: the session runs it as a run of the builder. */
  startRun(run: BuilderRun): Promise<void>;
}

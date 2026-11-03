import type { RelayedStatus } from "./events";
import type { BuilderStatusDetail } from "./protocol";

/**
 * What the builder tells the session it works for, as RPC on the session's
 * Durable Object. The session object implements it; the builder only knows
 * this much about it.
 */
export interface BuildSessionLink extends Rpc.DurableObjectBranded {
  progress(text: string, kind?: "log"): Promise<void>;
  relay(frame: { role: "builder"; text: string }): Promise<void>;
  builderStatus(status: RelayedStatus, detail?: BuilderStatusDetail): Promise<void>;
  builderSnapshot(snapshot: ContainerSnapshot | null): Promise<void>;
}

import { Agent, type AgentToolRunInspection, type AgentToolStoredChunk } from "agents";
import { logger } from "@backend/commons/logger";
import type { BuilderRun } from "./protocol";

const log = logger("arch-builder/run-handle");

/** What a session hands a run: which builder, and what to run. */
export interface RunHandleInput {
  sessionId: string;
  run: BuilderRun;
}

/**
 * The session's handle on one builder run. The session dispatches its builds,
 * merges and abandons as agent-tool runs, each a child agent of the session
 * named by the run id, which the session starts, watches and can cancel. This
 * child has no container: the work happens on the session's builder object,
 * and the handle forwards the agent-tool calls to it, so the session reads
 * the run's record and lines from the builder's records.
 */
export class BuilderRunHandle extends Agent<Cloudflare.Env> {
  async startAgentToolRun(
    input: RunHandleInput,
    options: { runId: string },
  ): Promise<AgentToolRunInspection> {
    await this.ctx.storage.put("sessionId", input.sessionId);
    log.info("run started", {
      runId: options.runId,
      sessionId: input.sessionId,
      mode: input.run.mode,
    });
    return this.env.BUILDERS.getByName(input.sessionId).startRun(
      options.runId,
      input.run,
    );
  }

  async cancelAgentToolRun(runId: string, reason?: unknown): Promise<void> {
    const builder = await this.builder();
    if (!builder) return;
    const text = reason instanceof Error ? reason.message : String(reason ?? "");
    await builder.cancelRun(runId, text);
  }

  async inspectAgentToolRun(runId: string): Promise<AgentToolRunInspection | null> {
    const builder = await this.builder();
    return builder ? builder.inspectRun(runId) : null;
  }

  async getAgentToolChunks(
    runId: string,
    options?: { afterSequence?: number },
  ): Promise<AgentToolStoredChunk[]> {
    const builder = await this.builder();
    return builder ? builder.runChunks(runId, options?.afterSequence ?? -1) : [];
  }

  /** The run's lines as they are stored and then as they come, until the run ends. */
  async tailAgentToolRun(
    runId: string,
    options?: { afterSequence?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const builder = await this.builder();
    if (!builder)
      return new ReadableStream({ start: (controller) => controller.close() });
    return builder.tailRun(runId, options?.afterSequence ?? -1);
  }

  /** The builder this run was handed to, once it was. */
  private async builder() {
    const sessionId = await this.ctx.storage.get<string>("sessionId");
    return sessionId ? this.env.BUILDERS.getByName(sessionId) : null;
  }
}

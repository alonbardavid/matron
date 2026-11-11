import type {
  ContainerHarness,
  ContainerOperationResult,
} from "agents/harness/container";
import { logger } from "@backend/commons/logger";
import { getBuilderModel } from "@backend/arch-settings/service";
import { reviewTrailerSchema, type ReviewTrailer } from "@shared/contract/arch/review";
import type { AgentOutcome, StepInput, StepName, TurnRequest } from "./protocol";
import { EventRelay, type Line } from "./event-relay";
import type { Checkpoint } from "./state";

const log = logger("arch-builder/turns");

const STEP_TIMEOUT_MS = 30 * 60_000;
const AGENT_TURN_TIMEOUT_MS = 40 * 60_000;

/**
 * The container's turns. Every unit of work is one harness turn, a step
 * command or a turn of the coding agent, whose prompt is a JSON
 * {@link TurnRequest}; its events become the run's lines as they happen, and
 * its outcome is the step's result or the agent's report.
 */
export class Turns {
  // Relayed events keep their order on the way to the lines.
  private relaying: Promise<void> = Promise.resolve();

  constructor(
    private readonly harness: ContainerHarness,
    private readonly line: (runId: string, line: Line) => void,
  ) {}

  /** One step; its result, or the error it reported, thrown. */
  async step<T = unknown>(at: Checkpoint, name: StepName, input?: StepInput): Promise<T> {
    const request: TurnRequest = { kind: "step", step: name, run: at.run, input };
    const result = await this.turn(at, request, STEP_TIMEOUT_MS);
    if (result.status !== "done")
      throw new Error(result.reason ?? `the ${name} step failed`);
    return JSON.parse(result.text || "{}") as T;
  }

  /** One agent turn on the checkpoint's prompt; the structured outcome it ended with. */
  async agent(at: Checkpoint): Promise<AgentOutcome> {
    const request: TurnRequest = {
      kind: "agent",
      prompt: at.prompt!,
      run: at.run,
      model: await getBuilderModel(),
    };
    const result = await this.turn(at, request, AGENT_TURN_TIMEOUT_MS);
    if (result.status !== "done")
      throw new Error(`The coding agent failed: ${result.reason ?? "no result"}`);
    const outcome = toOutcome(parseJson(result.text ?? ""));
    if (!outcome) throw new Error("The coding agent ended without reporting an outcome.");
    return outcome;
  }

  /**
   * Submits a turn and waits for it, relaying its events as lines. The
   * operation id is the run's id and turn number: see {@link Checkpoint.runId}.
   */
  private async turn(
    at: Checkpoint,
    request: TurnRequest,
    timeoutMs: number,
  ): Promise<ContainerOperationResult> {
    at.turn += 1;
    const operationId = `${at.run.sessionId}:${at.runId}:${at.turn}`;
    const session = this.harness.session();
    const stream = await session.events();
    const relay = new EventRelay(
      (line) => this.line(at.runId, line),
      stream.snapshot.messages,
    );
    stream.start((events) => {
      this.relaying = this.relaying
        .then(() => relay.handle(events))
        .catch((err) => log.warn("event relay failed", { err }));
    });
    try {
      await session.submit(JSON.stringify(request), { operationId });
      const timeout = AbortSignal.timeout(timeoutMs);
      let result: ContainerOperationResult;
      try {
        result = await session.wait(operationId, timeout);
      } catch (err) {
        if (!timeout.aborted) throw err;
        await session.abort(operationId).catch(() => false);
        const what = request.kind === "step" ? `${request.step} step` : "coding agent";
        throw new Error(
          `The ${what} did not finish within ${Math.round(timeoutMs / 60000)} minutes.`,
          { cause: err },
        );
      }
      await this.relaying;
      return result;
    } finally {
      await stream.stop().catch(() => undefined);
    }
  }
}

function toOutcome(value: unknown): AgentOutcome | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "done" && status !== "question" && status !== "blocked") return null;
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  return {
    status,
    summary: text("summary"),
    reasoning: text("reasoning"),
    message: text("message"),
    review: toReview(record.review),
  };
}

/** The agent's review, or undefined when it gave none worth keeping; a malformed one is dropped, never fatal. */
function toReview(value: unknown): ReviewTrailer | undefined {
  const parsed = reviewTrailerSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const review = parsed.data;
  return review.summary.trim() || review.brackets.length ? review : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

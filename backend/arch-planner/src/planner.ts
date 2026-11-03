import { logger } from "@backend/commons/logger";
import { MAIN_BRANCH } from "@backend/commons/principal";
import { plannerEnv } from "./env";
import {
  modelReply,
  type GatewayMetadata,
  type ModelMessage,
  type ProgressSink,
} from "./model";
import {
  NAME_LINE_PREFIX,
  PLANNER_STATUSES,
  plannerSystemPrompt,
  previousPlanNote,
  STATUS_LINE_PREFIX,
  type PlannerStatus,
} from "./prompts";

const log = logger("arch-planner/planner");

export interface PlannerTurn {
  role: "user" | "planner";
  text: string;
}

export interface PlannerContext {
  sessionId: string;
  transcript: PlannerTurn[];
  /** The last plan the planner proposed, if any. */
  previousPlan: string | null;
  /** Receives one line per thing the planner is doing, as it happens. */
  onProgress?: ProgressSink;
}

export interface PlannerReply {
  /** Markdown for the user, without the status line. */
  text: string;
  status: PlannerStatus;
  /** The plan now on the table: new when `status` is "plan", the previous one when "approved". */
  plan?: string;
  /** The short name the planner gave the change, with a plan. */
  name?: string;
}

/** One planner turn: the transcript so far in, the next planner message out. */
export async function plan(context: PlannerContext): Promise<PlannerReply> {
  const raw = await modelReply(
    plannerMessages(context),
    gatewayMetadata(context.sessionId),
    context.onProgress,
  );
  const reply = resolvePlan(parsePlannerReply(raw), context.previousPlan);
  log.info("planner replied", { status: reply.status, chars: reply.text.length });
  return reply;
}

export function plannerMessages(context: PlannerContext): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "system", content: plannerSystemPrompt() }];
  if (context.previousPlan)
    messages.push({ role: "system", content: previousPlanNote(context.previousPlan) });
  for (const turn of context.transcript) {
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.text,
    });
  }
  return messages;
}

const STATUS_LINE = new RegExp(`^\\s*${STATUS_LINE_PREFIX}\\s*(\\w+)\\s*$`, "gim");
const NAME_LINE = new RegExp(`^\\s*${NAME_LINE_PREFIX}\\s*(.+?)\\s*$`, "gim");

/**
 * Splits the status and name lines off the model's reply. The last status
 * line wins; without one the reply is a question, so a malformed reply never
 * starts a build.
 */
export function parsePlannerReply(raw: string): {
  text: string;
  status: PlannerStatus;
  name?: string;
} {
  let status: PlannerStatus | null = null;
  let name: string | undefined;
  const text = raw
    .replace(STATUS_LINE, (_line, value: string) => {
      const candidate = value.toLowerCase();
      if ((PLANNER_STATUSES as readonly string[]).includes(candidate)) {
        status = candidate as PlannerStatus;
      }
      return "";
    })
    .replace(NAME_LINE, (_line, value: string) => {
      name = value.trim();
      return "";
    })
    .trim();
  if (!status) status = "question";
  return name ? { text, status, name } : { text, status };
}

/**
 * Attaches the plan the reply refers to. An "approved" without a plan on
 * record cannot start a build; the reply is downgraded to a plan the user
 * still has to confirm.
 */
export function resolvePlan(
  parsed: { text: string; status: PlannerStatus; name?: string },
  previousPlan: string | null,
): PlannerReply {
  if (parsed.status === "plan") return { ...parsed, plan: parsed.text };
  if (parsed.status === "approved") {
    if (previousPlan) return { ...parsed, plan: previousPlan };
    return { text: parsed.text, status: "plan", plan: parsed.text };
  }
  return parsed;
}

/** The planner runs before a branch exists, so its requests are tagged with main. */
function gatewayMetadata(sessionId: string): GatewayMetadata {
  const origin = plannerEnv().APP_ORIGIN;
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // Not a URL; the raw value is still a usable tag.
  }
  return { agent: "planner", host, branch: MAIN_BRANCH, sessionId };
}

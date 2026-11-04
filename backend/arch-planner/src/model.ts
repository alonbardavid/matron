import Anthropic from "@anthropic-ai/sdk";
import { getBuilderModel } from "@backend/arch-settings/service";
import { logger } from "@backend/commons/logger";
import { AI_GATEWAY } from "@backend/commons/names";
import { plannerEnv } from "./env";
import { withRepository } from "@backend/arch-repository/service";
import { describeToolCall, repositoryTools } from "./tools";
import { toTurns, type ModelMessage } from "./turns";

export type { ModelMessage } from "./turns";

const log = logger("arch-planner/model");

const MAX_TOKENS = 16_000;
const CLIP_CHARS = 240;
/** Tool rounds one planner turn may take before it must answer. */
const MAX_TOOL_ROUNDS = 16;

/** Receives one line per thing the model is doing, as it happens. */
export type ProgressSink = (text: string) => void;

/** What the gateway's log says about a request: which agent, the app host, the branch and the session. */
export type GatewayMetadata = {
  agent: "planner";
  host: string;
  branch: string;
  sessionId: string;
};

function clip(text: string, max = CLIP_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * One planner turn: Claude, through the account's AI Gateway, with the
 * repository tools; the model reads what it needs and the reply's text comes
 * back. The gateway holds the provider credentials (unified billing or a
 * stored key) and authenticates the Cloudflare token in `cf-aig-authorization`;
 * the SDK still wants an API key, which the gateway ignores, so it is that token.
 */
export async function modelReply(
  messages: ModelMessage[],
  metadata: GatewayMetadata,
  onProgress?: ProgressSink,
): Promise<string> {
  const env = plannerEnv();
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "No model is configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN",
    );
  }
  const client = new Anthropic({
    apiKey: env.CLOUDFLARE_API_TOKEN,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${AI_GATEWAY}/anthropic`,
    defaultHeaders: {
      "cf-aig-authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "cf-aig-metadata": JSON.stringify(metadata),
    },
  });
  const { system, turns } = toTurns(messages);
  // One repository handle serves every tool call of the turn.
  return withRepository(async (repo) => {
    const runner = client.beta.messages.toolRunner({
      model: await getBuilderModel(),
      max_tokens: MAX_TOKENS,
      // The prompt and the tools are the same on every turn: cached across them.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: turns,
      tools: repositoryTools(repo),
      thinking: { type: "adaptive" },
      // A safety refusal re-runs the request on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      stream: true,
      thread: false,
      max_iterations: MAX_TOOL_ROUNDS,
    });
    let response: Anthropic.Beta.BetaMessage | undefined;
    let announcedText = false;
    for await (const stream of runner) {
      // Each finished block is one line: the thought, the tool call, then "writing" once text starts.
      stream.on("contentBlock", (block) => {
        if (block.type === "thinking" && block.thinking.trim()) {
          onProgress?.(`thinking: ${clip(block.thinking)}`);
        } else if (block.type === "tool_use") {
          onProgress?.(describeToolCall(block.name, block.input));
        } else if (block.type === "text" && !announcedText) {
          announcedText = true;
          onProgress?.("planner: writing the reply");
        }
      });
      response = await stream.finalMessage();
    }
    if (!response) throw new Error("The planner gave no reply");
    if (response.stop_reason === "refusal") {
      log.warn("planner refusal", { category: response.stop_details?.category });
      throw new Error("The model declined this request");
    }
    if (response.stop_reason === "tool_use") {
      throw new Error("The planner read the repository for too long without answering");
    }
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    log.info("planner completion", {
      model: response.model,
      stopReason: response.stop_reason,
      chars: text.length,
    });
    return text;
  });
}

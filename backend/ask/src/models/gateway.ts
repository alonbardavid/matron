import type { LanguageModel } from "ai";
import {
  gatewayModel as modelOnGateway,
  type GatewayCredentials,
} from "@backend/commons/gateway-model";
import { AI_GATEWAY } from "@backend/commons/names";

/** What the gateway's log says about a request. */
export interface AskModelMetadata {
  agent: "ask";
  askSessionId: string;
}

/** The gateway options for a Workers AI model the agent runs through the AI binding: the same log, same metadata. */
export function gatewayOptions(metadata: AskModelMetadata): {
  id: string;
  metadata: Record<string, string>;
} {
  return { id: AI_GATEWAY, metadata: { ...metadata } };
}

/** An `anthropic/<model>` slug on the gateway's Anthropic endpoint, logged as the assistant's; null for any other provider. */
export function gatewayModel(
  slug: string,
  credentials: GatewayCredentials,
  metadata: AskModelMetadata,
): LanguageModel | null {
  return modelOnGateway(slug, credentials, { ...metadata });
}

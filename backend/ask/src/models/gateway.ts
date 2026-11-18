import type { LanguageModel } from "ai";
import {
  gatewayModel as modelOnGateway,
  type GatewayCredentials,
} from "@backend/commons/gateway-model";

/** What the gateway's log says about a request. */
export interface AskModelMetadata {
  agent: "ask";
  askSessionId: string;
}

/** An `anthropic/<model>` slug on the gateway's Anthropic endpoint, logged as the assistant's. */
export function gatewayModel(
  slug: string,
  credentials: GatewayCredentials,
  metadata: AskModelMetadata,
): LanguageModel {
  const model = modelOnGateway(slug, credentials, { ...metadata });
  if (!model)
    throw new Error(`The assistant runs on Anthropic models only, not "${slug}"`);
  return model;
}

import { AI_GATEWAY } from "@backend/commons/names";

/** What the gateway's log says about a request. */
export interface AskModelMetadata {
  agent: "ask";
  askSessionId: string;
}

/**
 * The assistant's model is a slug the agent resolves through the Worker's AI
 * binding and the account's gateway: `@cf/...` runs on Workers AI, any other
 * `provider/model` on the gateway's catalog. No token is needed, so a Preview
 * can use it too. These are the gateway options attached to each request.
 */
export function gatewayOptions(metadata: AskModelMetadata): {
  id: string;
  metadata: Record<string, string>;
} {
  return { id: AI_GATEWAY, metadata: { ...metadata } };
}

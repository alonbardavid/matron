import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { AI_GATEWAY } from "@backend/commons/names";

/** What the gateway's log says about a request. */
export interface AskModelMetadata {
  agent: "ask";
  askSessionId: string;
}

/** A Workers AI model id, served through the Worker's AI binding. */
export function isWorkersAIModel(slug: string): boolean {
  return slug.startsWith("@cf/");
}

/** The gateway options for a Workers AI model the agent runs through the AI binding: the same log, same metadata. */
export function gatewayOptions(metadata: AskModelMetadata): {
  id: string;
  metadata: Record<string, string>;
} {
  return { id: AI_GATEWAY, metadata: { ...metadata } };
}

/** What the gateway's provider endpoint needs: the account, and a token that authenticates to the gateway. */
export interface GatewayCredentials {
  accountId: string;
  token: string;
}

const PLACEHOLDER_KEY = "placeholder";

/**
 * An `anthropic/<model>` slug as a model on the gateway's Anthropic endpoint,
 * the route on which the gateway applies the household's stored provider key.
 * The SDK's own credential headers are dropped from every request, so the
 * gateway sees no key but its own. Null for any other provider.
 */
export function gatewayModel(
  slug: string,
  credentials: GatewayCredentials,
  metadata: AskModelMetadata,
): LanguageModel | null {
  const slash = slug.indexOf("/");
  if (slash <= 0) return null;
  const provider = slug.slice(0, slash);
  const model = slug.slice(slash + 1);
  if (provider !== "anthropic" || !model) return null;
  const anthropic = createAnthropic({
    apiKey: PLACEHOLDER_KEY,
    baseURL: `https://gateway.ai.cloudflare.com/v1/${credentials.accountId}/${AI_GATEWAY}/anthropic`,
    headers: {
      "cf-aig-authorization": `Bearer ${credentials.token}`,
      "cf-aig-metadata": JSON.stringify(metadata),
    },
    fetch: withoutProviderCredentials,
  });
  return anthropic(model);
}

/** The SDK's placeholder credentials never reach the gateway. */
const withoutProviderCredentials: typeof fetch = (input, init) => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  headers.delete("x-api-key");
  headers.delete("authorization");
  return fetch(input, { ...init, headers });
};

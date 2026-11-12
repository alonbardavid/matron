import { env } from "cloudflare:workers";
import { DomainError } from "@backend/commons/errors";
import { logger } from "@backend/commons/logger";
import type { HouseholdSecret } from "@shared/contract/arch/settings";

/**
 * The secrets a household enters in App settings. Each is a secret of the
 * Worker itself, set through Cloudflare's API with the Worker's own token, so
 * the Worker reads it from its environment like any other and nothing of it
 * is kept in the database. Setting or removing one makes Cloudflare deploy
 * the Worker again: the value is there for the isolates that start after.
 * The same value goes to the Worker's Preview base config, since a Preview
 * inherits no secret from production.
 * Which secrets there are is the contract's list, HOUSEHOLD_SECRETS.
 */

const log = logger("arch-settings/worker-secrets");

interface SecretsEnv {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  WORKER_NAME: string;
}

function bindings(): SecretsEnv & Partial<Record<HouseholdSecret, string>> {
  return env as unknown as SecretsEnv & Partial<Record<HouseholdSecret, string>>;
}

/** The secret as this isolate started with it, or undefined when it is not set. */
export function householdSecret(name: HouseholdSecret): string | undefined {
  return bindings()[name] || undefined;
}

/** Whether this deployment can change its own secrets: it holds an API token. */
export function canChangeHouseholdSecrets(): boolean {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = bindings();
  return Boolean(CLOUDFLARE_API_TOKEN && CLOUDFLARE_ACCOUNT_ID);
}

/**
 * Sets the secret for the Worker's Previews, which inherit none, and on the
 * Worker itself, which Cloudflare then deploys again.
 */
export async function setHouseholdSecret(
  name: HouseholdSecret,
  value: string,
): Promise<void> {
  await previewSecret(name, value);
  await workerApi("PUT", `/workers/scripts/${workerName()}/secrets`, {
    name,
    text: value,
    type: "secret_text",
  });
  log.info("worker secret set", { name });
}

/** Removes the secret from the Worker and its Previews; one that is not there is left at that. */
export async function removeHouseholdSecret(name: HouseholdSecret): Promise<void> {
  await previewSecret(name, null);
  await workerApi("DELETE", `/workers/scripts/${workerName()}/secrets/${name}`);
  log.info("worker secret removed", { name });
}

/**
 * The Worker's Preview base config: what every Preview is given beside its own
 * settings. A branch has the value from the next time it is built.
 */
async function previewSecret(name: HouseholdSecret, value: string | null): Promise<void> {
  await workerApi(
    "PATCH",
    `/workers/workers/${workerName()}`,
    {
      previews_base_config: {
        env: { [name]: value === null ? null : { type: "secret_text", text: value } },
      },
    },
    "application/merge-patch+json",
  );
}

function workerName(): string {
  return bindings().WORKER_NAME;
}

async function workerApi(
  method: "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  contentType = "application/json",
): Promise<void> {
  const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID } = bindings();
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      "This deployment holds no Cloudflare API token, so it cannot change its own secrets",
    );
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "content-type": contentType,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (response.ok || (method === "DELETE" && response.status === 404)) return;
  const answer = (await response.json().catch(() => null)) as {
    errors?: { code: number; message: string }[];
  } | null;
  const first = answer?.errors?.[0];
  log.warn("worker secret call failed", { status: response.status, code: first?.code });
  throw new DomainError(
    "SERVICE_UNAVAILABLE",
    first
      ? `Cloudflare refused: ${first.message} (code ${first.code})`
      : `Cloudflare answered ${response.status}`,
  );
}

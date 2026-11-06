import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { householdPermissions } from "@backend/household/permissions";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import { decryptSecret, encryptSecret } from "@backend/commons/secrets";
import type { Principal } from "@backend/commons/principal";
import { secretSettings, settings } from "@backend/db-models/arch-settings";
import { getDb } from "@backend/db-models/db";
import {
  ANTHROPIC_MODELS,
  askModelSchema,
  DEFAULT_ASK_MODEL,
  DEFAULT_BUILDER_MODEL,
  type AnthropicModel,
  type AppSettings,
  type AskModel,
  type GoogleOAuthSettings,
  type GoogleOAuthUpdate,
} from "@shared/contract/arch/settings";
import { GOOGLE_CALLBACK_PATH } from "@shared/contract/app/calendar";

const log = logger("arch-settings/service");

const BUILDER_MODEL_KEY = "builder_model";
const ASK_MODEL_KEY = "ask_model";
const GOOGLE_CLIENT_ID_KEY = "google_client_id";
const GOOGLE_CLIENT_SECRET_KEY = "google_client_secret";
/** The purpose secret settings are sealed for, under SECRETS_KEY; tokens elsewhere use their own. */
const SECRET_PURPOSE = "secret-settings";

async function readValue(key: string): Promise<string | undefined> {
  const row = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value;
}

async function writeValue(key: string, value: string): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ id: newEntityId("SETTING"), key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

async function deleteValue(key: string): Promise<void> {
  await getDb().delete(settings).where(eq(settings.key, key));
}

async function readSecret(key: string): Promise<string | undefined> {
  const row = await getDb()
    .select({ value: secretSettings.value })
    .from(secretSettings)
    .where(eq(secretSettings.key, key))
    .get();
  if (!row) return undefined;
  try {
    return await decryptSecret(`${SECRET_PURPOSE}:${key}`, row.value);
  } catch {
    // Sealed under a SECRETS_KEY version this Worker lacks: as good as unset, so it is entered again.
    log.warn("secret setting unreadable", { key });
    return undefined;
  }
}

async function writeSecret(key: string, plaintext: string): Promise<void> {
  const value = await encryptSecret(`${SECRET_PURPOSE}:${key}`, plaintext);
  await getDb()
    .insert(secretSettings)
    .values({ id: newEntityId("SECRET_SETTING"), key, value })
    .onConflictDoUpdate({
      target: secretSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

async function deleteSecret(key: string): Promise<void> {
  await getDb().delete(secretSettings).where(eq(secretSettings.key, key));
}

/** The household's settings, with defaults for anything never set. Every member may read them. */
export async function getSettings(): Promise<AppSettings> {
  const [builderModel, askModel] = await Promise.all([getBuilderModel(), getAskModel()]);
  return { builderModel, askModel };
}

/** The model the planner and the builder use. */
export async function getBuilderModel(): Promise<AnthropicModel> {
  const value = await readValue(BUILDER_MODEL_KEY);
  return (ANTHROPIC_MODELS as readonly string[]).includes(value ?? "")
    ? (value as AnthropicModel)
    : DEFAULT_BUILDER_MODEL;
}

/** The assistant's model, a gateway slug. */
export async function getAskModel(): Promise<AskModel> {
  const value = await readValue(ASK_MODEL_KEY);
  const parsed = askModelSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ASK_MODEL;
}

export async function updateSettings(
  principal: Principal,
  changes: Partial<AppSettings>,
): Promise<AppSettings> {
  if (!householdPermissions.can(principal.role, "manage")) {
    throw new DomainError("FORBIDDEN", "Only owners and admins change the settings");
  }
  if (changes.builderModel) {
    await writeValue(BUILDER_MODEL_KEY, changes.builderModel);
    log.info("setting changed", {
      key: BUILDER_MODEL_KEY,
      value: changes.builderModel,
      userId: principal.userId,
    });
  }
  if (changes.askModel) {
    await writeValue(ASK_MODEL_KEY, changes.askModel);
    log.info("setting changed", {
      key: ASK_MODEL_KEY,
      value: changes.askModel,
      userId: principal.userId,
    });
  }
  return getSettings();
}

/**
 * A stored secret as the settings page may show it: its first few characters,
 * never more than a third of it, then asterisks.
 */
function secretHint(secret: string): string {
  return `${secret.slice(0, Math.min(10, Math.floor(secret.length / 3)))}****`;
}

/** The URI Google returns members to; it must be registered on the OAuth client as is. */
export function googleRedirectUri(): string {
  const origin = (env as unknown as { APP_ORIGIN: string }).APP_ORIGIN.replace(/\/$/, "");
  return `${origin}${GOOGLE_CALLBACK_PATH}`;
}

/** The household's Google OAuth app as the settings page shows it: never the secret. */
export async function getGoogleOAuthSettings(
  principal: Principal,
): Promise<GoogleOAuthSettings> {
  householdPermissions.require(principal, "manage");
  const [clientId, clientSecret] = await Promise.all([
    readValue(GOOGLE_CLIENT_ID_KEY),
    readSecret(GOOGLE_CLIENT_SECRET_KEY),
  ]);
  return {
    clientId: clientId ?? null,
    clientSecretHint: clientSecret === undefined ? null : secretHint(clientSecret),
    redirectUri: googleRedirectUri(),
  };
}

export async function updateGoogleOAuthSettings(
  principal: Principal,
  changes: GoogleOAuthUpdate,
): Promise<GoogleOAuthSettings> {
  householdPermissions.require(principal, "manage");
  const hasSecret = (await readSecret(GOOGLE_CLIENT_SECRET_KEY)) !== undefined;
  if (!changes.clientSecret && !hasSecret) {
    throw new DomainError("BAD_REQUEST", "Enter the client secret");
  }
  await writeValue(GOOGLE_CLIENT_ID_KEY, changes.clientId);
  if (changes.clientSecret)
    await writeSecret(GOOGLE_CLIENT_SECRET_KEY, changes.clientSecret);
  log.info("google oauth app changed", {
    secretChanged: Boolean(changes.clientSecret),
    userId: principal.userId,
  });
  return getGoogleOAuthSettings(principal);
}

export async function removeGoogleOAuthSettings(
  principal: Principal,
): Promise<GoogleOAuthSettings> {
  householdPermissions.require(principal, "manage");
  await Promise.all([
    deleteValue(GOOGLE_CLIENT_ID_KEY),
    deleteSecret(GOOGLE_CLIENT_SECRET_KEY),
  ]);
  log.info("google oauth app removed", { userId: principal.userId });
  return getGoogleOAuthSettings(principal);
}

/**
 * The Google OAuth app for the calendar import to authenticate with, or null
 * when none is set up. Server-side only: the secret never leaves the Worker.
 */
export async function getGoogleOAuthApp(): Promise<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null> {
  const [clientId, clientSecret] = await Promise.all([
    readValue(GOOGLE_CLIENT_ID_KEY),
    readSecret(GOOGLE_CLIENT_SECRET_KEY),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: googleRedirectUri() };
}

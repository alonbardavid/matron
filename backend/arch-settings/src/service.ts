import { eq } from "drizzle-orm";
import { householdPermissions } from "@backend/household/permissions";
import { DomainError } from "@backend/commons/errors";
import { newEntityId } from "@backend/commons/ids";
import { logger } from "@backend/commons/logger";
import type { Principal } from "@backend/commons/principal";
import { settings } from "@backend/db-models/arch-settings";
import { getDb } from "@backend/db-models/db";
import {
  ANTHROPIC_MODELS,
  askModelSchema,
  DEFAULT_ASK_MODEL,
  DEFAULT_BUILDER_MODEL,
  HOUSEHOLD_SECRETS,
  type AnthropicModel,
  type AppSettings,
  type AskModel,
  type HouseholdSecret,
  type HouseholdSecrets,
  type HouseholdSecretsUpdate,
} from "@shared/contract/arch/settings";
import {
  canChangeHouseholdSecrets,
  householdSecret,
  removeHouseholdSecret,
  setHouseholdSecret,
} from "./worker-secrets";

const log = logger("arch-settings/service");

const BUILDER_MODEL_KEY = "builder_model";
const ASK_MODEL_KEY = "ask_model";

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
 * A secret as the settings page may show it: its first few characters,
 * never more than a third of it, then asterisks.
 */
function secretHint(secret: string | undefined): string | null {
  if (secret === undefined) return null;
  return `${secret.slice(0, Math.min(10, Math.floor(secret.length / 3)))}****`;
}

function hintsOf(valueOf: (name: HouseholdSecret) => string | undefined) {
  return {
    changeable: canChangeHouseholdSecrets(),
    secrets: Object.fromEntries(
      HOUSEHOLD_SECRETS.map((name) => [name, secretHint(valueOf(name))]),
    ) as HouseholdSecrets["secrets"],
  };
}

/** The household's secrets as the settings page shows them: a hint of each, never the value. */
export async function getHouseholdSecrets(
  principal: Principal,
): Promise<HouseholdSecrets> {
  householdPermissions.require(principal, "manage");
  return hintsOf(householdSecret);
}

/**
 * Sets or removes the secrets named, each on the Worker, which Cloudflare then
 * deploys again. The answer is what was just set: this isolate still runs
 * with what it started with.
 */
export async function updateHouseholdSecrets(
  principal: Principal,
  changes: HouseholdSecretsUpdate,
): Promise<HouseholdSecrets> {
  householdPermissions.require(principal, "manage");
  const after = new Map<HouseholdSecret, string | undefined>();
  for (const name of HOUSEHOLD_SECRETS) {
    const current = householdSecret(name);
    const change = changes[name];
    after.set(name, change === undefined ? current : (change ?? undefined));
    // A value entered again is set again: it also goes to the Previews, which may lack it.
    if (change === undefined || (change === null && current === undefined)) continue;
    if (change === null) await removeHouseholdSecret(name);
    else await setHouseholdSecret(name, change);
    log.info("household secret changed", {
      name,
      removed: change === null,
      userId: principal.userId,
    });
  }
  return hintsOf((name) => after.get(name));
}

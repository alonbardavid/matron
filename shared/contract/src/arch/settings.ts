import { oc } from "@orpc/contract";
import { z } from "zod";

/** The Anthropic models the planner and the builder's coding agent may run on. */
export const ANTHROPIC_MODELS = [
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];
export const DEFAULT_BUILDER_MODEL: AnthropicModel = "claude-opus-5-5";

/**
 * The assistant's model: `anthropic/<model>`, reached through the account's AI
 * Gateway with the household's stored key, or `@cf/<model>` on Workers AI.
 */
export const askModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(anthropic|@cf)\/.+/,
    "An Anthropic model (anthropic/...) or a Workers AI model (@cf/...)",
  );
export type AskModel = z.infer<typeof askModelSchema>;
export const DEFAULT_ASK_MODEL: AskModel = `anthropic/${DEFAULT_BUILDER_MODEL}`;

export const appSettingsSchema = z.object({
  /** The model the planner and the builder use. */
  builderModel: z.enum(ANTHROPIC_MODELS),
  /** The model the assistant uses, through the gateway. */
  askModel: askModelSchema,
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** One model the assistant may be pointed at, grouped for a picker. */
export const catalogModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
});
export type CatalogModel = z.infer<typeof catalogModelSchema>;

/** Models known to work with the assistant's tools; it accepts other gateway slugs too. */
export const modelCatalogSchema = z.array(catalogModelSchema);
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

/** Where Google sends a member back after they allow access; registered on the OAuth client. */
export const GOOGLE_REDIRECT_PATH = "/api/arch/auth/callback/google";

/**
 * The secrets a household may set from App settings, and no others: each is a
 * secret of the Worker itself, by this name. Here, the household's own Google
 * OAuth app, which members connect their Google Calendar through.
 */
export const HOUSEHOLD_SECRETS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
export type HouseholdSecret = (typeof HOUSEHOLD_SECRETS)[number];

/** A secret as it may be shown: its first few characters and asterisks (`GOCSPX-ab****`), or null when it is not set. */
const secretHint = z.string().nullable();

/** Secrets are write-only: reading shows a hint of each, never the value. */
export const householdSecretsSchema = z.object({
  /** Whether secrets can be set from here: the deployment holds the API token that changes them. */
  changeable: z.boolean(),
  secrets: z.object({
    GOOGLE_CLIENT_ID: secretHint,
    GOOGLE_CLIENT_SECRET: secretHint,
  } satisfies Record<HouseholdSecret, typeof secretHint>),
});
export type HouseholdSecrets = z.infer<typeof householdSecretsSchema>;

/** A new value, null to remove the secret, or left out to keep it as it is. */
const secretChange = z.string().trim().min(1).max(1000).nullable().optional();

export const householdSecretsUpdateSchema = z.strictObject({
  GOOGLE_CLIENT_ID: secretChange,
  GOOGLE_CLIENT_SECRET: secretChange,
} satisfies Record<HouseholdSecret, typeof secretChange>);
export type HouseholdSecretsUpdate = z.infer<typeof householdSecretsUpdateSchema>;

export const settingsContract = {
  get: oc.route({ method: "GET", path: "/api/arch/settings" }).output(appSettingsSchema),
  /** Owners and admins only. */
  update: oc
    .route({ method: "PUT", path: "/api/arch/settings" })
    .input(appSettingsSchema.partial())
    .output(appSettingsSchema),
  /** The models the settings page offers. */
  models: oc
    .route({ method: "GET", path: "/api/arch/settings/models" })
    .output(modelCatalogSchema),
  /** The household's secrets, as hints; owners and admins only. */
  secrets: oc
    .route({ method: "GET", path: "/api/arch/settings/secrets" })
    .output(householdSecretsSchema),
  /** Sets or removes the secrets named; each change deploys the Worker again. */
  updateSecrets: oc
    .route({ method: "PUT", path: "/api/arch/settings/secrets" })
    .input(householdSecretsUpdateSchema)
    .output(householdSecretsSchema),
};

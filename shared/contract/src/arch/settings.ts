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

/**
 * The household's own Google OAuth app, which members connect their Google
 * Calendar through. The secret is write-only: reading shows only its first few characters.
 */
export const googleOAuthSettingsSchema = z.object({
  clientId: z.string().nullable(),
  /** The stored secret's first few characters and asterisks (`GOCSPX-ab****`), or null when none is stored. */
  clientSecretHint: z.string().nullable(),
  /** The redirect URI to register on the OAuth client in the Google Cloud console. */
  redirectUri: z.string(),
});
export type GoogleOAuthSettings = z.infer<typeof googleOAuthSettingsSchema>;

export const googleOAuthUpdateSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, "Enter the client ID")
    .max(300)
    .regex(
      /\.apps\.googleusercontent\.com$/,
      "A Google client ID ends in .apps.googleusercontent.com",
    ),
  /** Left out to keep the stored secret. */
  clientSecret: z.string().trim().min(1, "Enter the client secret").max(300).optional(),
});
export type GoogleOAuthUpdate = z.infer<typeof googleOAuthUpdateSchema>;

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
  /** The Google OAuth app; owners and admins only. */
  google: oc
    .route({ method: "GET", path: "/api/arch/settings/google" })
    .output(googleOAuthSettingsSchema),
  updateGoogle: oc
    .route({ method: "PUT", path: "/api/arch/settings/google" })
    .input(googleOAuthUpdateSchema)
    .output(googleOAuthSettingsSchema),
  /** Forgets the app; members' connections stop syncing until it is set again. */
  removeGoogle: oc
    .route({ method: "DELETE", path: "/api/arch/settings/google" })
    .output(googleOAuthSettingsSchema),
};

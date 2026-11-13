// Pure transform: the config `vite build` emits for the Worker + a deploy
// target → the config wrangler deploys. No I/O here; the CLI wrapper
// (scripts/gen-wrangler-config.mjs) reads env and files. Unit tests live in
// wrangler-config.test.ts.
/* global structuredClone */

export const REQUIRED_COMPAT_FLAGS = [
  "nodejs_compat",
  "global_fetch_strictly_public",
  "enhanced_error_serialization",
  "enable_ctx_exports",
];

/**
 * When production syncs every member's imported Google calendars in full, once
 * a day (UTC). Google's own notices bring each change in between. The Worker
 * tells its crons apart by this text (`GOOGLE_SYNC_CRON` in
 * backend/calendar/src/google.ts) and refuses one it does not know.
 */
export const GOOGLE_SYNC_CRON = "17 3 * * *";

/** Vars that are Worker secrets; a value in the emitted config is only for local dev. */
export const SECRET_VARS = [
  "BETTER_AUTH_SECRET",
  "SIGNING_KEY",
  // Set from App settings, through Cloudflare's API.
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
];

/**
 * @typedef {object} Options
 * @property {"production" | "preview"} target
 * @property {string} workerName        Production Worker name (a Preview belongs to it too);
 *                                      the bucket and the Artifacts namespace are named after it.
 * @property {string} dbName            The D1 this config binds (the branch's, for a Preview).
 * @property {string} dbId
 * @property {string} appOrigin         Production origin, e.g. https://matron.sub.workers.dev
 * @property {string} accountId
 * @property {string} migrationsDir     Relative to the generated file.
 * @property {string} dockerfilePath    Relative to the generated file; used without builderImage.
 * @property {string} [builderImage]    Digest-pinned registry reference of the builder image.
 * @property {boolean} [noContainer]    Production without the builder container (building off).
 */

/**
 * @param {Record<string, any>} emitted  Parsed config emitted by `vite build`.
 * @param {Options} options
 * @returns {Record<string, any>}
 */
export function generateWranglerConfig(emitted, options) {
  const config = structuredClone(emitted);
  const isProduction = options.target === "production";

  config.name = options.workerName;
  delete config.env;
  // `exports` and `migrations` cannot coexist; an empty list is noise.
  if (Array.isArray(config.migrations) && config.migrations.length === 0)
    delete config.migrations;

  config.compatibility_flags = [
    ...new Set([...(config.compatibility_flags ?? []), ...REQUIRED_COMPAT_FLAGS]),
  ];

  const bindings = {
    d1_databases: [
      {
        binding: "DB",
        database_name: options.dbName,
        database_id: options.dbId,
        migrations_dir: options.migrationsDir,
      },
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: options.workerName }],
    artifacts: [{ binding: "ARTIFACTS", namespace: options.workerName }],
    images: { binding: "IMAGES" },
    // Workers AI and the AI Gateway behind it; a Preview reaches models only this way.
    ai: { binding: "AI" },
    send_email: [{ name: "SEND_EMAIL" }],
  };

  const vars = { ...(config.vars ?? {}) };
  for (const key of SECRET_VARS) delete vars[key];
  Object.assign(vars, {
    // A fork runs only the application part; production runs the router.
    WORKER_ROLE: isProduction ? "router" : "application",
    APP_ORIGIN: options.appOrigin,
    WORKER_NAME: options.workerName,
    CLOUDFLARE_ACCOUNT_ID: options.accountId,
    NODE_ENV: "production",
  });
  if (options.builderImage) vars.BUILDER_IMAGE = options.builderImage;

  Object.assign(config, bindings, { vars });
  config.observability = {
    ...(config.observability ?? {
      logs: { invocation_logs: true, head_sampling_rate: 1 },
    }),
    enabled: true,
  };

  delete config.containers;
  delete config.previews;
  delete config.triggers;

  if (isProduction) {
    // The daily sync of members' imported Google calendars; a Preview has none.
    config.triggers = { crons: [GOOGLE_SYNC_CRON] };
    if (options.appOrigin.endsWith(".workers.dev")) config.workers_dev = true;
    // Previews are reached by URL from the router, so they need their URLs on.
    config.preview_urls = true;
    if (!options.noContainer) {
      // A Durable Object-managed container: the object starts it with
      // `ctx.container.images.builder` and picks the instance size then.
      config.containers = [
        {
          name: options.workerName,
          class_name: "BuilderObject",
          scheduling_policy: "durable_object",
          images: {
            builder: options.builderImage
              ? { image: options.builderImage }
              : { dockerfile: options.dockerfilePath },
          },
        },
      ];
      config.exports = {
        ...config.exports,
        BuilderObject: {
          ...config.exports?.BuilderObject,
          container: options.workerName,
        },
      };
    }
  } else {
    // A Preview inherits nothing from the Worker: repeat everything it binds.
    // No containers here, so `wrangler preview` never needs Docker.
    config.previews = {
      vars: { ...vars },
      ...structuredClone(bindings),
      ...(config.durable_objects && {
        durable_objects: structuredClone(config.durable_objects),
      }),
      observability: structuredClone(config.observability),
    };
  }

  return config;
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ASSETS: Fetcher;
    IMAGES?: ImagesBinding;
    SEND_EMAIL?: SendEmail;
    ARTIFACTS?: Artifacts;
    BUILD_SESSIONS: DurableObjectNamespace<
      import("@backend/arch-sessions/session-object").BuildSessionObject
    >;
    BUILDERS: DurableObjectNamespace<
      import("@backend/arch-builder/builder-object").BuilderObject
    >;
    // "application" on a fork (a Preview); production runs the router.
    WORKER_ROLE?: "router" | "application";
    APP_ORIGIN: string;
    BETTER_AUTH_SECRET: string;
    SIGNING_KEY: string;
    CLOUDFLARE_API_TOKEN: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    WORKER_NAME: string;
    BUILDER_IMAGE?: string;
  }
}

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ASSETS: Fetcher;
    AI: Ai;
    IMAGES?: ImagesBinding;
    SEND_EMAIL?: SendEmail;
    ARTIFACTS?: Artifacts;
    BUILD_SESSIONS: DurableObjectNamespace<
      import("@backend/arch-sessions/session-object").BuildSessionObject
    >;
    BUILDERS: DurableObjectNamespace<
      import("@backend/arch-builder/builder-object").BuilderObject
    >;
    ASK_SESSIONS: DurableObjectNamespace<
      import("@backend/ask/ask-object").AskSessionObject
    >;
    ALARMS: DurableObjectNamespace<import("./alarm-object").AlarmObject>;
    // "application" on a fork (a Preview); production runs the router.
    WORKER_ROLE?: "router" | "application";
    APP_ORIGIN: string;
    BETTER_AUTH_SECRET: string;
    SIGNING_KEY: string;
    /** The household's Google OAuth app, set in App settings as secrets of the Worker. */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    /** The account token: the router's API calls, and every model call through the gateway. */
    CLOUDFLARE_API_TOKEN?: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    WORKER_NAME: string;
    BUILDER_IMAGE?: string;
    /** The push key pair; absent on a Preview, which sends no push. */
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
  }
}

declare namespace Cloudflare {
  // Types `ctx.exports` after the main module, so the builder can reach `ContainerEgress`.
  interface GlobalProps {
    mainModule: typeof import("./index");
  }
}

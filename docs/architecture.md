# Architecture

One Worker, three parts. `SELF-RELEASING-GUIDE.md` says what each does; this page says where the code is and
how a request moves through it.

## A request

1. `apps/backend/src/index.ts` picks the router or the application by `WORKER_ROLE`.
   `apps/backend/src/router.ts` is the **router**. It mounts better-auth at `/api/arch/auth/*`,
   resolves the session cookie into a `Principal` (`backend/arch-auth/src/session.ts`) and the
   branch from `?branch=` or the referer (`backend/arch-routing/src/branch-param.ts`), upgrades the
   build chat socket at `/api/arch/sessions/:sessionId/ws` (`openSessionSocket` in
   `backend/arch-sessions/src/service.ts`) and serves
   `/api/arch/*` itself through `backend/arch-api` (routes and handler for the
   `shared/contract/src/arch` contract); a path there that no procedure claims is a 404. A
   request naming a branch that does not exist gets `apps/backend/static/branch-not-found.html`
   from the Worker's assets.
2. Every other path is handed to the **application** (`apps/backend/src/application.ts`) by
   `backend/arch-routing/src/handoff.ts`: the session cookie stripped, the principal (or none,
   when signed out) and the branch signed into the handoff header (`signed-handoff.ts`). On main that is an in-process `application.fetch`; on a branch it is the
   same request sent to the branch's Preview URL. A Preview runs this same Worker with
   `WORKER_ROLE=application`, so its entry skips the router and serves the application only.
3. The application verifies the signature (`require-handoff.ts`), serves `/api/app/*` through
   `backend/api` (routes and handler for the `shared/contract/src/app` contract), and everything
   else from static assets.

## Building

- `POST /api/arch/sessions` creates a session row; the chat is a WebSocket to the session's
  `BuildSessionObject` (`backend/arch-sessions/src/session-object.ts`), which serves the chat
  procedures of `shared/contract/src/arch/sessions.ts` on it (`chat-router.ts`: oRPC's WebSocket
  adapter with the hibernation plugin), keeps the transcript in its SQLite storage and runs the
  planner (`backend/arch-planner`: `planner.ts`, prompts in `prompts.ts`, the model call in
  `model.ts`, which runs the SDK's tool runner with the repository tools in `tools.ts` so the
  planner reads only the files it needs).
- When a plan is approved the session object creates the branch row
  (`backend/arch-branches/src/service.ts`) and hands a `BuildJob` to the `BuilderObject`
  (`backend/arch-builder/src/builder-object.ts`), the Durable Object that owns the builder
  container. The builder reports back over RPC on the session object, through the
  `BuildSessionLink` interface it declares (`session-link.ts`); it never imports the sessions
  package.
- The code repository (Artifacts) is reached only through `backend/arch-repository/src/service.ts`:
  main's head, the file listing, reading and searching behind the planner's tools, and the
  token a builder clones with.
- The container (`apps/builder`) speaks the protocol in
  `backend/arch-builder/src/protocol.ts`: the object posts the job over HTTP, then
  holds one WebSocket into the container; builder events come up it and user messages go down
  it, and a watchdog alarm reconnects after an eviction. The container clones the Artifacts repository, runs Claude Code, verifies, commits, pushes,
  clones the production D1, deploys the Preview and reports `deployed`. The object relays
  every builder message into the chat, snapshots the container filesystem when it pauses or
  finishes, and restores it on the next user message.
- Merge and abandon are jobs for the same container in `merge`/`abandon` mode
  (`backend/arch-builder/src/jobs.ts`).

## Configuration

`apps/backend/wrangler.jsonc` is for local development only. Deploys stamp a target onto the
config the build emits (`scripts/gen-wrangler-config.mjs`): production binds the production
D1 and declares the builder container; a preview config binds the branch's D1 under a
`previews` block and declares no container. See `docs/deployment.md`.

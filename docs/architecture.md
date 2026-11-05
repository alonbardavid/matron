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
   `backend/api` (routes and handler for the `shared/contract/src/app` contract), upgrades the
   assistant's chat socket at `/api/app/ask/:id/ws` (`backend/ask/src/socket.ts`), and serves
   everything else from static assets. The features behind the routes are `backend/tasks`,
   `backend/calendar` (with the recurrence expansion in `recurrence.ts`), `backend/household`
   (the member list) and `backend/ask` (the conversations and the assistant).

## The assistant

`AskSessionObject` (`backend/ask/src/ask-object.ts`) is a Think agent, one per conversation,
named by the ask session id. Its tools (`tools.ts`) wrap the tasks, calendar and household
services as the connected user, so a tool can do no more than the user could in the app, plus
`query_database`, one read-only SELECT checked by `sql-guard.ts` against the tables the user's
role may read. The model is the household's assistant setting (`backend/arch-settings`); the
planner and the builder's agent turns have their own. `models/gateway.ts` reaches it: an
`anthropic/` slug is Anthropic's API through the gateway with the Worker's token, so the
household's stored provider key applies, and a `@cf/` slug is Workers AI through the AI binding.
A Preview holds the token too, so its assistant takes the same route.

## Building

- `POST /api/arch/sessions` creates a session row; the chat is a WebSocket to the session's
  `BuildSessionObject` (`backend/arch-sessions/src/session-object.ts`), an Agent from the
  Agents SDK: a connection gets the transcript replayed from the frame it names, then every
  frame the object broadcasts (`shared/contract/src/arch/sessions.ts`), and the object keeps
  the transcript in its SQLite storage and runs the planner (`backend/arch-planner`:
  `planner.ts`, prompts in `prompts.ts`, the model call in `model.ts`, which runs the SDK's
  tool runner with the repository tools in `tools.ts` so the planner reads only the files it
  needs). The browser side is `frontend/api/src/socket.ts`, on the Agents SDK client.
- When a plan is approved the session object creates the branch row
  (`backend/arch-branches/src/service.ts`) and hands a `BuildJob` to the `BuilderObject`
  (`backend/arch-builder/src/builder-object.ts`), the Durable Object that owns the builder
  container. The builder reports back over RPC on the session object, through the
  `BuildSessionLink` interface it declares (`session-link.ts`); it never imports the sessions
  package.
- The code repository (Artifacts) is reached only through `backend/arch-repository/src/service.ts`:
  main's head, the file listing, reading and searching behind the planner's tools, and the
  token a builder clones with.
- The builder object is an Agent whose container harness (Agents SDK) owns the builder
  container: it starts it from the image, runs every turn the object submits as a durable
  operation, streams the turn's events, reattaches after an eviction, and snapshots the
  workspace when the container has idled five minutes. A job is a fiber in the object: a
  sequence of turns, each a step command or a turn of the coding agent
  (`backend/arch-builder/src/protocol.ts` lists them), checkpointed after each, so an evicted
  object resumes the job from its last checkpoint. The image (`apps/builder`) is the
  harness's daemon with an adapter for both kinds of turn: a step runs `cli.ts`, an agent
  turn runs the coding agent's CLI in the checkout, with hooks that enforce the runner's
  rules and model calls routed through the harness's egress, which adds the gateway and its
  credentials outside the container. A question from the agent parks the job until the user
  replies.
- Merge and abandon are jobs for the same container in `merge`/`abandon` mode
  (`backend/arch-builder/src/jobs.ts`).

## Configuration

`apps/backend/wrangler.jsonc` is for local development only. Deploys stamp a target onto the
config the build emits (`scripts/gen-wrangler-config.mjs`): production binds the production
D1 and declares the builder container; a preview config binds the branch's D1 under a
`previews` block and declares no container. See `docs/deployment.md`.

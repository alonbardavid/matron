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
   from the Worker's assets. better-auth also offers the providers the household has set up in
   App settings (Google): a member links their account there, and the application asks for a
   valid access token through `backend/arch-auth/src/app-interface.ts`, the one file of the auth
   that application code imports.
   The household's Google app is two secrets of the Worker, set from App settings through
   Cloudflare's API (`backend/arch-settings/src/worker-secrets.ts`).
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
   (the member list and their pictures, `avatar.ts`), `backend/files` (uploads: `storage.ts` keeps
   writes under the branch's own R2 prefix, `service.ts` records and opens them by their visibility,
   `pictures.ts` checks and squares a picture through the Images binding; `files.get` returns the
   stream, which `fileResponses` in `backend/commons/src/api.ts` answers with the file's headers) and `backend/ask` (the conversations
   and the assistant).

## The assistant

`AskSessionObject` (`backend/ask/src/ask-object.ts`) is a Think agent, one per conversation,
named by the ask session id, on the branch the conversation was started on (the socket's URL
names the branch; `socket.ts` refuses another branch's conversation). Its tools (`tools.ts`) wrap the tasks, calendar and household
services as the connected user, so a tool can do no more than the user could in the app, plus
`query_database`, one read-only SELECT checked by `sql-guard.ts` against the tables the user's
role may read. The model is the household's assistant setting (`backend/arch-settings`); the
planner and the builder's agent turns have their own. `models/gateway.ts` reaches it: an
`anthropic/` slug is Anthropic's API through the gateway with the Worker's token, so the
household's stored provider key applies, and a `@cf/` slug is Workers AI through the AI binding.
A Preview holds the token too, so its assistant takes the same route.

## Reminders

`apps/frontend/public/site.webmanifest` and `sw.js` make the SPA installable; the service
worker handles no fetch, only `push` and `notificationclick`. `frontend/notifications` holds
the install prompt, the device's subscription and the settings card. A subscription is a row
in `push_subscription` (`backend/notifications/src/service.ts`), with the device's time zone.

A member's alarm on an event or a task is a row in `alarm` (`backend/notifications/src/alarms.ts`):
how many minutes before. Each has a Durable Object of its own, an Agents SDK agent
(`alarm-object.ts`) holding one schedule: the next ring. A ring works out again what is due,
pushes it with `web-push.ts` (RFC 8291 encryption, VAPID keys from
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) and schedules the one after. The feature a thing
belongs to extends the object with how its rings are worked out (`EventAlarmObject` and
`nextEventRing` in `backend/calendar`, `TaskAlarmObject` and `nextTaskRing` in
`backend/tasks`), decides who may set an alarm, and arms it again when the thing changes
(`rearmAlarms`), so `backend/notifications` knows neither events nor tasks.

The Worker's `scheduled` entry (`apps/backend/src/index.ts`) picks its job by the cron's
text and throws for one it does not know. The one cron is the daily Google sync; locally,
`curl "localhost:8301/cdn-cgi/handler/scheduled?cron=17+3+*+*+*"` runs it.

## Building

- `POST /api/arch/sessions` creates a session row; the chat is a WebSocket to the session's
  `BuildSessionObject` (`backend/arch-sessions/src/session-object.ts`), a Think agent like the
  assistant's, named by the session id. The planner is its model, through the gateway on the
  household's builder-model setting, with the repository tools (`backend/arch-planner/src/tools.ts`)
  and the session's own: `propose_plan` records the plan and the branch name, `start_build`
  starts the build, `tell_builder` passes the member's words (and the files of their latest
  message) to the builder. Which tools a turn may call, and the system prompt (`prompts.ts`),
  depend on the session's phase, which the object syncs to its clients as state. The browser
  side (`frontend/build`) is the Think chat client, with `useAgentToolEvents` for the runs.
- A build, a merge or an abandon is a run of the builder as the session's sub-agent
  (`runAgentTool` with `BuilderRunHandle`, `backend/arch-builder/src/run-handle.ts`): a detached
  run that outlives the turn, is watched by the session's own reconcile loop after an eviction,
  and whose lines stream to the chat as the run's chunks beside the planner's reply. The handle
  is a facet child of the session with no container of its own: it forwards the four agent-tool
  methods to the `BuilderObject` (`backend/arch-builder/src/builder-object.ts`), the Durable
  Object that owns the builder container and keeps each run's record and lines in its SQLite
  (`runs`, `run_chunks`), tailing them live over an RPC stream. The builder's messages and
  status go the other way, over RPC on the session object through the `BuildSessionLink`
  interface it declares (`session-link.ts`): a message joins the conversation on the member's
  side, marked as the builder's, so the planner reads it as said to it; a status moves the
  session's phase and rows. The builder never imports the sessions package.
- The code repository (Artifacts) is reached only through `backend/arch-repository/src/service.ts`:
  main's head, the file listing, reading and searching behind the planner's tools (at any
  ref), the tree diff and commit log behind the review, and the token a builder clones with.
  It can also pull a branch of a public repository into one of its own and say what main
  lacks of it (`mirror.ts`, isomorphic-git over `node:fs`, whose `/tmp` in a Worker is
  memory that lasts for the request).
- The review (`backend/arch-review`, `frontend/review`) reads a live branch's diff against
  its `base_commit`, the builder's commit messages (`commits.ts`), and the summary and
  brackets the builder agent gave with the newest deploy, which the build session object
  keeps (`reviewReport`). The browser diffs each file
  itself (`frontend/review/src/diff.ts`) and keeps viewed marks in `localStorage`. Questions
  go to the planner's model call with the branch's tools (`reviewer.ts`); the client sends the
  whole conversation each time and nothing is stored.
- Upstream updates are `backend/arch-upstream`: where upstream is (`source.ts`), the check that
  pulls it into the repository's `upstream/main` branch and compares main with it, and the start
  of the build session that merges it, with the plan under `prompts/`. It reaches the
  session through `getSession` in the sessions service, which returns the session's Durable
  Object. The screen side is `frontend/upstream`, a widget on troubleshooting's Branches tab.
- The builder object is an Agent whose container harness (Agents SDK) owns the builder
  container: it starts it from the image, runs every turn the object submits as a durable
  operation, streams the turn's events, reattaches after an eviction, and snapshots the
  workspace when the container has idled five minutes. A run is a fiber in the object: a
  sequence of turns, each a step command or a turn of the coding agent
  (`backend/arch-builder/src/protocol.ts` lists them), checkpointed after each, so an evicted
  object resumes the run from its last checkpoint. The image (`apps/builder`) is the
  harness's daemon with an adapter for both kinds of turn: a step runs `cli.ts`, an agent
  turn runs the coding agent's CLI in the checkout, with hooks that enforce the runner's
  rules and model calls routed through the harness's egress, which adds the gateway and its
  credentials outside the container. A question from the agent parks the run until the user
  replies.
- Merge and abandon are runs for the same container in `merge`/`abandon` mode
  (`backend/arch-builder/src/runs.ts`). `backend/arch-builder/README.md` lays out the moving parts.

## Configuration

`apps/backend/wrangler.jsonc` is for local development only. Deploys stamp a target onto the
config the build emits (`scripts/gen-wrangler-config.mjs`): production binds the production
D1 and declares the builder container; a preview config binds the branch's D1 under a
`previews` block and declares no container. See `docs/deployment.md`.

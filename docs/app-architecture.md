# Application architecture

Matron is one Cloudflare Worker with three parts. The **router** signs people in and decides which branch of the code answers a request. The **builder** changes the code and releases it. The **application** is the household app itself: every page a member sees and every procedure under `/api/app/*`.

This page is about the application: where it runs, how a feature is laid out, what it gets from the router, and what a change made from inside the app can and cannot do. What the app does is in [app-product-guide.md](app-product-guide.md). The router and the builder are in [router-architecture.md](router-architecture.md). The rules for writing the code are in [`CLAUDE.md`](../CLAUDE.md).

## Where it runs

- **Production** runs the application inside the Worker, behind the router, on the production database.
- **A branch** runs the same application as a Preview of the Worker, on a copy of the production database made when the branch was first deployed. Data changed on a branch is thrown away when the branch is merged or abandoned: only its code and its migrations reach production.

The application does not know which of the two it is. Every request reaches it through one handoff from the router, which strips the session cookie and signs two things into a header: who is asking (the principal: user id, name, email and role, or nobody) and the branch. The application checks the signature (`backend/arch-routing/src/require-handoff.ts`) and trusts nothing else, so a Preview reached directly answers with an error.

`apps/backend/src/application.ts` then serves:

- `/api/app/*` through `backend/api`, the routes and handler for the `shared/contract/src/app` contract. Signed-in members only.
- `/api/app/public/*` through `backend/api/src/public`, for procedures that answer anyone. They have a contract of their own (`shared/contract/src/app/public`), each says itself what makes a call count, and a signed-out caller reaches production's only, never a branch's. The one there today is where Google posts that an imported calendar changed.
- `/api/app/ask/:id/ws`, the assistant's chat socket, and what the chat asks for below it, handed to the conversation's Durable Object (`askProxyRoute` in `backend/api/src/routes/conversations.ts`, through `backend/ask/src/proxy.ts`).
- Everything else from static assets: the SPA that `apps/frontend` builds.

## A feature

A feature is self-contained: a contract, a backend package, a frontend package, its tables and a migration. Lists are the one to copy; the calendar shows sharing and repetition.

| Part        | Where                                           | Holds                                                                                                  |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Contract    | `shared/contract/src/app/<feature>.ts`          | zod schemas and oRPC procedures, no implementation; added to `contract.ts` beside it                   |
| Routes      | `backend/api/src/routes/<feature>.ts`           | the contract's procedures, each calling the service                                                    |
| Service     | `backend/<feature>/src/service.ts`              | the logic and the authorization                                                                        |
| Permissions | `backend/<feature>/src/permissions.ts`          | the feature's resource, its actions and each role's grants; listed in `backend/access/src/registry.ts` |
| Tables      | `backend/db-models/src/<feature>.ts`            | drizzle tables; every table has an `id` from `newEntityId`                                             |
| Migration   | `migrations/`                                   | one SQL file per change (`pnpm db:new <name>`), never edited afterwards                                |
| Screens     | `frontend/<feature>/src/screens`, `src/widgets` | routed pages and embeddable pieces, on the design system in `frontend/ds`                              |
| Navigation  | `frontend/root/src`                             | the route in `App.tsx`, the page's name in `pages.ts`, its entry in `Navbar.tsx`                       |
| Assistant   | `backend/ask/src/tools.ts`                      | a tool per service action, so the assistant can do what the page can                                   |
| Tests       | `tests/e2e/<feature>`                           | Playwright, through the browser                                                                        |

One feature reaches another only through that feature's `service.ts`.

## The packages

| Package                                                 | What it owns                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/lists`, `frontend/lists`                       | Lists and their items.                                                                                                                                  |
| `backend/calendar`, `frontend/calendar`                 | Events, repetition (`recurrence.ts`), calendars (`calendars.ts`), the Google import (`google.ts`, `google-api.ts`) and place suggestions (`places.ts`). |
| `backend/household`                                     | The member list (`users.ts`) and members' pictures (`avatar.ts`).                                                                                       |
| `backend/files`                                         | Uploads: where they are stored, who may open them, and pictures.                                                                                        |
| `backend/notifications`, `frontend/notifications`       | Push devices and alarms.                                                                                                                                |
| `backend/ask`, `frontend/ask`, `frontend/conversations` | The assistant, its chat and the list of conversations.                                                                                                  |
| `frontend/settings`                                     | A member's Settings page, and the owner's App settings page, which talks to the router.                                                                 |
| `frontend/auth`                                         | The sign-in and Users screens, and `useMe`: who is signed in and what they may do.                                                                      |
| `frontend/root`                                         | The layout, the navigation and the Ask and Build buttons.                                                                                               |
| `frontend/api`                                          | The oRPC client, the auth client and the branch parameter.                                                                                              |
| `frontend/ds`                                           | The design system: theme, palette, forms, chat, Markdown.                                                                                               |
| `backend/api`                                           | The application's procedures and their handler.                                                                                                         |
| `backend/commons`                                       | Cross-cutting low-level code: ids, logger, errors, crypto, permissions, templates.                                                                      |
| `backend/db-models`                                     | Every drizzle table, the router's too.                                                                                                                  |
| `backend/access`                                        | The registry that builds the roles from every feature's permissions.                                                                                    |

## Authorization

A member has one of three roles: `owner`, `admin` or `member`. What a role may do is written in code, not stored. A service action first calls its resource's `require(principal, action)`, then the object's own rule: who made it and who it is shared with. Routes and screens only mirror those checks.

| Resource       | Actions                                                  | Who                                                                                                         |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `list`         | `view`, `create`, `update`, `share`, `remove`            | Everyone; the list's shares decide which lists.                                                             |
| `event`        | `view`, `create`, `update`, `share`, `remove`            | Everyone; the event's creator and shares decide which events.                                               |
| `calendar`     | `view`, `create`, `update`, `share`, `remove`, `connect` | Everyone, on their own calendars only.                                                                      |
| `conversation` | `view`, `create`, `chat`, `rename`, `archive`            | Everyone, on their own conversations only.                                                                  |
| `push`         | `view`, `subscribe`, `unsubscribe`                       | Everyone, on their own devices only.                                                                        |
| `member`       | `view`                                                   | Everyone: the list of members to share with.                                                                |
| `household`    | `manage`                                                 | Owners and admins: adding and removing members, and their roles.                                            |
| `database`     | `read`, `read_router`, `read_files`                      | The assistant's queries: `read` for everyone, `read_router` for owners and admins, `read_files` for owners. |

An event or a list is shared per member with `view`, and with `share` and `edit` each given on their own (`SHARE_PERMISSIONS` in `shared/contract/src/app/calendar.ts`). What the caller may do with one comes back in its `myPermissions`.

## Data

- All tables are in one D1 database, declared in `backend/db-models`. A branch's database is a copy and carries the router's tables too, unused there.
- A schema change is a new file in `migrations/`, named by when it was written (`YYYYMMDDHHmmss_name.sql`, UTC). A merge applies the branch's pending migrations to production before it deploys, so a migration has to work on the household's real data and keep it.
- A new table adds its id prefix to `backend/commons/src/ids.ts` first.

## Files

The R2 bucket is shared, with a prefix per branch: an object's key is `<branch>/<folder>/<id>`, such as `main/avatars/<file id>`. Any branch reads any object, since a branch's database begins as a copy of production's and keeps pointing at production's files. Writes (uploads, changes, deletes) are allowed only under the branch's own prefix (`backend/files/src/storage.ts`).

A file row records the key, the type, who uploaded it and its visibility. Files have no permissions of their own: the feature that stores one has checked its own, and says who may see it (`service.ts`). A `household` file is served to every signed-in member, a `private` one only to its uploader, and an owner sees every file. `files.get` returns the stream, which `fileResponses` in `backend/commons/src/api.ts` answers with the file's headers. `pictures.ts` checks a picture and squares it through the Images binding.

## The assistant

`AskSessionObject` (`backend/ask/src/ask-object.ts`) is a Think agent, one per conversation, named by the ask session id, on the branch the conversation was started on (the socket's URL names the branch; `proxy.ts` refuses another branch's conversation). Its tools (`tools.ts`) wrap the lists, calendar and household services as the connected user, so a tool can do no more than the user could in the app, plus `query_database`, one read-only SELECT checked by `sql-guard.ts` against the tables the user's role may read. A new service is also a new tool there. Its prompt (`prompts/system.md`) carries [app-product-guide.md](app-product-guide.md) in full, so it can say what the app does and where.

The model is the household's assistant setting, one of Anthropic's models. `models/gateway.ts` reaches it through the account's AI Gateway with the Worker's token, so the household's stored provider key applies. A Preview holds the token too, so a branch's assistant takes the same route.

## Reminders

`apps/frontend/public/site.webmanifest` and `sw.js` make the SPA installable; the service worker handles no fetch, only `push` and `notificationclick`. `frontend/notifications` holds the install prompt, the device's subscription and the settings card. A subscription is a row in `push_subscription` (`backend/notifications/src/service.ts`), with the device's time zone.

A member's alarm on an event or a list item is a row in `alarm` (`backend/notifications/src/alarms.ts`): how many minutes before. Each has a Durable Object of its own, an Agents SDK agent (`alarm-object.ts`) holding one schedule: the next ring. A ring works out again what is due, pushes it with `web-push.ts` (RFC 8291 encryption, VAPID keys from `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`) and schedules the one after.

The feature a thing belongs to works out its rings (`nextEventRing` in `backend/calendar`, `nextItemRing` in `backend/lists`), decides who may set an alarm, and arms it again when the thing changes (`rearmAlarms`), so `backend/notifications` knows neither events nor lists. The one class every alarm runs as, `AlarmObject` in `apps/backend/src/alarm-object.ts`, names each kind's rings.

## What it gets from the router

- **Who is asking and on which branch**, from the signed handoff. The application never reads a cookie.
- **Linked accounts**, through `backend/arch-auth/src/app-interface.ts`, the one file of the auth that application code imports: whether a provider is set up, a member's linked account, and a valid access token for it. The Google import uses it.
- **The assistant's model**, from the household's settings (`getAskModel` in `backend/arch-settings/src/service.ts`).
- **The `user` table** (`backend/db-models/src/arch-auth.ts`), which `backend/household` reads for the member list and where it records each member's picture (`user.image`). Creating, changing and removing accounts is the router's.
- **Household secrets**, as variables of the Worker: an owner enters them in App settings, and only the names in `HOUSEHOLD_SECRETS` (`shared/contract/src/arch/settings.ts`) can be set.
- **In the browser**, `frontend/api` keeps `?branch=` on every navigation and call.

## What a change can and cannot do

A change asked for in the build chat is a change to the application. It can add a feature or change one: packages, tables with their migrations, pages and navigation, assistant tools, reminders for a new kind of thing, a public procedure, a call to an outside service.

It cannot:

- **Add Cloudflare resources.** The builder never edits `scripts/`, `apps/builder/`, `turbo.json` or `apps/backend/wrangler.jsonc` (`apps/builder/src/hook-guard.ts` refuses), so a build adds no binding, no Durable Object class and no cron trigger. Those need a developer and a deploy from a terminal. What the application has: the D1 database (`DB`), the R2 bucket (`FILES`), Images (`IMAGES`), the assistant's and the alarms' Durable Objects, and production's one daily cron.
- **Change the router or the builder**: signing in, branches, the build chat, merging, the builder's container. The planner turns such a request down.
- **Send email or text messages.** The Worker has no binding for either.
- **Count on production-only things on a branch.** A Preview sends no reminders (it has no push keys), gets neither Google's change notices nor the daily sync, and cannot link a Google account, since Google returns to production.
- **Keep a branch's data.** Whatever a member enters while trying a branch is gone after the merge.

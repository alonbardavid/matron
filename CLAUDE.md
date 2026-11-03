# Matron — project rules

Matron is a self-releasing household organizer: one Cloudflare Worker that is router,
application and builder at once. `SELF-RELEASING-GUIDE.md` is the product and architecture spec; read the
section you are working on before changing it. This file is a rulebook: keep it short, edit
in place, never append history.

## Layout

- `apps/backend` — the Worker shell: `src/index.ts` picks `src/router.ts` or
  `src/application.ts` by role, Durable Object exports, `wrangler.jsonc` (local dev only;
  deploys use a generated config), `static/` for the router's own pages, served as assets
  beside the frontend's build. No procedures live here.
- `backend/arch-api` and `backend/api` — the router's and the application's oRPC
  procedures: `routes/*` implement that side's contract, `handler.ts` serves them.
- `apps/frontend` — the SPA shell: `main.tsx` wiring only. Screens live in feature packages.
- `apps/builder` — the builder image: Dockerfile, the container harness daemon (`src/daemon.ts`)
  that runs the step commands (`src/cli.ts`) and the coding agent, its prompts and hook.
- `backend/<feature>` — one package per concern, code under `src/`: `service.ts` (logic and
  authorization), other files as needed. `backend/commons` is cross-cutting low-level code
  (ids, logger, crypto, errors). `backend/db-models` holds every drizzle table.
- `shared/contract` — every contract and nothing else: zod schemas, oRPC procedures and
  socket frames, no implementation. `src/arch/<feature>.ts` (router, `/api/arch/*`) and
  `src/app/<feature>.ts` (application, `/api/app/*`) are composed by that side's
  `contract.ts`; `src/contract.ts` combines both for the frontend.
- `frontend/<feature>` — `src/screens/` (routed pages) and `src/widgets/` (embeddable pieces);
  `frontend/ds` is the design system (theme, palette, forms, Markdown).
- `migrations` — numbered D1 migrations; `pnpm db:new <name>` adds one.

## Rules

- **Import the file, not the package.** Packages have no `index.ts`; write
  `import { listTodos } from "@backend/todo/service"`, which is `backend/todo/src/service.ts`.
  `tsconfig.base.json` `paths` and `tooling/workspace-alias.ts` do the mapping; a new package
  adds its `paths` line. ESLint rejects `export *`. `pnpm type-check` checks the Worker side
  and the browser side as one program each (`tsconfig.worker.json`, `tsconfig.browser.json`);
  a new package under `backend/`, `frontend/` or `shared/` is covered by their globs.
- **Features are self-contained.** Changing how todos work touches `backend/todo`,
  `frontend/todo-list` and a migration; nothing else. Cross-feature calls go through the
  other feature's `service.ts`.
- **Contract first.** Declare a procedure in the feature's file under `shared/contract/src/arch`
  (router) or `shared/contract/src/app` (application), add a new feature's contract to that
  side's `contract.ts`, and implement it in `backend/arch-api` or `backend/api` under
  `routes/*`. Backend and frontend both import types from `@shared/contract/...`.
- **Authorization lives in services**, decided with `canBranch(role, action)` from
  `@backend/arch-auth/permissions`. Routes and screens only mirror it.
- **Every table has an `id`** from `newEntityId("<ENTITY>")` in `@backend/commons/ids`; a new
  table adds its prefix there first and gets a migration.
- **Log constant messages with props**: `log.info("todo created", { todoId })`, through
  `logger("<package>/<file>")` from `@backend/commons/logger`. Never log secrets or tokens.
- **Forms go through `@frontend/ds/forms`**, API calls through `@frontend/api/orpc`.
- Use `pnpm` (and `pnpx`), never `npm`/`npx`.

## Traps

- `turbo.json` backend `build` outputs must include `.wrangler/deploy/**`, or a cache hit
  restores `dist/` without the redirect and config generation fails.
- `kysely` is pinned in `pnpm.overrides`: better-auth imports its kysely adapter even on the
  Drizzle path, and newer versions break in workerd.
- A Preview inherits nothing from production: everything a fork needs is repeated in the
  `previews` block that `scripts/gen-wrangler-config.mjs` writes. Previews declare no
  container, so no Docker is needed to deploy one.

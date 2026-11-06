# Deploying

Matron deploys from the terminal with `pnpm run deploy`, which runs `pnpm build` and then
`scripts/deploy.mjs`. Wrangler configuration is never committed: `pnpm build` emits a config
for the Worker, and `scripts/gen-wrangler-config.mjs` stamps a target onto it right before
each deploy. A Workers Paid plan is required (Containers, Artifacts).

## Before the first deploy

1. Install Docker and start it (the builder image is built locally; see Limitations).
2. Create an API token at <https://dash.cloudflare.com/profile/api-tokens> with:
   - Account / Workers Scripts / Edit (deploys Previews and production; without it every
     `wrangler preview` is refused with "No access to the specified resource")
   - Account / D1 / Edit
   - Account / Workers R2 Storage / Edit
   - Account / Artifacts / Edit
   - Account / AI Gateway / Run
   - Account / Workers Containers / Edit
   - Account / Cloudflare Images / Edit and Account / Email Sending / Edit (a Preview binds both)
   - Account / Account Settings / Read
   - Optional: Account / Workers Observability / Read, to query log history from the terminal
3. `export CLOUDFLARE_API_TOKEN=...`. If the token sees several accounts, also
   `export CLOUDFLARE_ACCOUNT_ID=...`. Without the variable the script deploys with wrangler's
   own login (`wrangler login`) and leaves the Worker secret unset, so the app runs but cannot
   build until a later `pnpm run deploy` with the token exported.
4. Fund the AI Gateway: the planner and the coding agent call Claude through the account's
   `default` gateway with this token. AI Gateway creates that gateway on its first authenticated
   request; it must hold the provider credentials. In the dashboard (AI → AI Gateway → `default`)
   enable Unified Billing, or store an Anthropic key under Provider Keys (BYOK). There is no
   Anthropic key on the Worker.
5. Commit your work on `main`: the repository is pushed to Artifacts with full history and the
   deploy refuses a dirty tree or another branch (unless `--skip-repo`).

## What `pnpm run deploy` does

1. Resolves the account (`CLOUDFLARE_ACCOUNT_ID` or `GET /accounts`, which must list exactly one)
   and the production origin (`--origin`, or `https://<name>.<subdomain>.workers.dev`).
2. Creates the D1 database if missing and resolves its id.
3. Creates the R2 bucket (same name as the database) if missing.
4. Creates the Artifacts namespace `matron` if missing (REST API).
5. Builds `apps/builder` with `wrangler containers build ... --push`, tagged with the git sha, and
   keeps the pushed digest: the config references
   `registry.cloudflare.com/<account>/matron-builder@sha256:<digest>`.
6. Writes `apps/backend/dist/worker/wrangler.generated.production.json`.
7. Applies pending D1 migrations to the production database.
8. Lists the Worker's secrets; generates `BETTER_AUTH_SECRET`, `SIGNING_KEY` and `SECRETS_KEY` (as `v1-<hex>`) when missing.
9. `wrangler deploy` with a temporary `--secrets-file` (deleted afterwards).
10. Creates the Artifacts repository `matron/matron` if missing, mints a one-hour write token and
    runs `git push --all` and `git push --tags` to it (the token travels in git's config env).
11. If the `user` table is empty, asks for the owner's email, name and password (password without
    echo) and inserts the owner with a hash made by better-auth's own `hashPassword`.
12. Prints the URL.

Flags (`pnpm run deploy --name home`):

| Flag                                                | Default                                  | Meaning                                                                                                      |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--name`                                            | `matron`                                 | Worker name; the D1, R2 bucket, Artifacts namespace and repository, and the builder image are named after it |
| `--origin`                                          | `https://<name>.<subdomain>.workers.dev` | Production origin (`APP_ORIGIN`)                                                                             |
| `--skip-image`                                      | off                                      | Do not build; use `BUILDER_IMAGE=<digest-pinned ref>` from the shell                                         |
| `--no-container`                                    | off                                      | Deploy without the builder container; no Docker, building off                                                |
| `--skip-repo`                                       | off                                      | Do not create or push the Artifacts repository                                                               |
| `--owner-email`, `--owner-name`, `--owner-password` | prompted                                 | Owner account on a first deploy                                                                              |

## Where things live

| What                                                                              | Where                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`, `SIGNING_KEY`, `SECRETS_KEY`        | Worker secrets (never in config; printed nowhere)                                                                   |
| `APP_ORIGIN`, `WORKER_NAME`, `CLOUDFLARE_ACCOUNT_ID`, `BUILDER_IMAGE`, `NODE_ENV` | Worker vars in the generated config; everything else is derived from `WORKER_NAME` (`backend/commons/src/names.ts`) |
| Code                                                                              | Artifacts repository `<name>` in namespace `<name>` (the only source of truth after the first deploy)               |
| Users, branches, sessions, tasks, events                                          | Production D1 `<name>`                                                                                              |
| Files                                                                             | R2 bucket `<name>`, one prefix per branch                                                                           |
| Builder image                                                                     | `registry.cloudflare.com/<account>/<name>-builder@sha256:<digest>`                                                  |
| Planner model, AI Gateway                                                         | App settings (builder model, assistant model and backend); the account's `default` gateway is a constant in code    |

The API token is stored on the Worker on purpose: the router creates branch databases and
Previews with it and the builder container deploys with it. Scope it to the list above.

## The generated configs

`scripts/gen-wrangler-config.mjs` reads `apps/backend/.wrangler/deploy/config.json` (written by
`vite build`) to find the emitted config and writes `wrangler.generated.<target>.json` beside it.

Env: `TARGET` (`production` | `preview`), `WORKER_NAME`, `DB_NAME`, `DB_ID`, `APP_ORIGIN`,
`ACCOUNT_ID`; optional `BUILDER_IMAGE`. The bucket and the Artifacts namespace are named after
the Worker.

- `production`: `workers_dev` when the origin is a `workers.dev` URL, `preview_urls` on, the
  builder container as a Durable Object-managed container named `builder` whose image
  `builder` is `BUILDER_IMAGE` (or the Dockerfile when unset), linked from the `exports` entry of
  `BuilderObject`, and observability.
- `preview`: no container at all, and a `previews` block repeating vars, D1, R2, Artifacts, AI,
  Images, email and Durable Object bindings, because a Preview inherits nothing. The builder uses
  it with `wrangler preview --config ... --name <preview>`.

## Limitations

- Changes to `apps/builder` (the image) only ship through this terminal deploy; the builder
  references the published image and never rebuilds it.
- Docker is required unless `BUILDER_IMAGE` points at an image already in the registry
  (`--skip-image`). Previews never need Docker.
- A custom `--origin` is not attached as a route or domain by the script; add the custom domain
  to the Worker in the dashboard.
- Secrets are additive: a secret removed from the shell is not removed from the Worker.

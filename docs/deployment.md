# Deploying

Matron deploys from the terminal with `pnpm run deploy`, which runs `pnpm type-check`,
`pnpm build` and then `scripts/deploy.mjs`. Wrangler configuration is never committed:
`pnpm build` emits a config for the Worker, and `scripts/gen-wrangler-config.mjs` stamps a
target onto it right before each deploy. A Workers Paid plan is required (Containers, Artifacts).

The first deploy installs Matron. After it the app releases its own changes, and a deploy from
the terminal is needed only for what the app cannot release itself (see Limitations). How the
parts fit together is in [router-architecture.md](router-architecture.md).

## Before the first deploy

1. Install Docker and start it (the builder image is built locally; see Limitations).
2. Log wrangler in to the account: `pnpm --filter @app/backend exec wrangler login`. The deploy
   runs with this login: it creates the database, the bucket, the Artifacts repository and the
   builder image, which the Worker's own token is not allowed to. If the login sees several
   accounts, also `export CLOUDFLARE_ACCOUNT_ID=...`.
3. Create the Worker's API token at <https://dash.cloudflare.com/profile/api-tokens>, with only
   what the app itself does through Cloudflare's API (see The Worker's token).
4. `export WORKER_API_TOKEN=...` for the first deploy. The script stores it on the Worker as the
   secret `CLOUDFLARE_API_TOKEN`, and a later deploy leaves it alone unless the variable is set
   again. Without it the app runs but cannot build until a deploy is given one.
5. Fund the AI Gateway: the planner and the coding agent call Claude through the account's
   `default` gateway with the Worker's token. AI Gateway creates that gateway on its first authenticated
   request; it must hold the provider credentials. In the dashboard (AI → AI Gateway → `default`)
   enable Unified Billing, or store an Anthropic key under Provider Keys (BYOK). There is no
   Anthropic key on the Worker.
6. Commit your work, on any branch: the deploy refuses a dirty tree, and the commit it deploys
   becomes `main` in the Artifacts repository, with its history.

A `CLOUDFLARE_API_TOKEN` in the shell takes the login's place, for a deploy from a machine that
cannot log in. That token needs the Worker's permissions and Account / Artifacts / Edit, Account /
Cloudflare Images / Edit and Account / Account Settings / Read, and it is the token the Worker
keeps unless `WORKER_API_TOKEN` names another.

## The Worker's token

The token is stored on the Worker on purpose. The router reaches the models, sets the household
secrets and reads Troubleshooting with it, and hands it to the builder container, which creates
branch databases and deploys Previews and production with it. Keep it to these permissions:

| Permission                          | Used by                      | For                                                                                                                                                                             |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account / Workers Scripts / Edit    | Builder, router              | The builder deploys Previews and production; App settings set the household secrets. Without it every `wrangler preview` is refused with "No access to the specified resource". |
| Account / D1 / Edit                 | Builder, router              | The builder creates, fills, migrates and deletes a branch's database, and restores production's on a revert. Troubleshooting lists databases and deletes them.                  |
| Account / AI Gateway / Run          | Router, application, builder | Every call to a model: the planner, the review, the assistant and the coding agent.                                                                                             |
| Account / Workers Containers / Edit | Builder, router              | A production deploy applies the builder container's settings. Troubleshooting lists the containers.                                                                             |
| Account / Workers R2 Storage / Edit | Builder                      | Deleting a branch deletes its files. Without it they stay in the bucket and the rest of the cleanup goes on.                                                                    |

## Deploying again

A later deploy is the same command, from a clean tree. It needs neither the owner's details nor
`WORKER_API_TOKEN` again, and it needs Docker unless `--skip-image` or `--no-container` is given.
The commit it deploys must contain `main` of the Artifacts repository: once changes were merged
in the app, merge that `main` into your branch first.

## What `pnpm run deploy` does

1. Resolves the account (`CLOUDFLARE_ACCOUNT_ID` or `GET /accounts`, which must list exactly one)
   and the production origin (`--origin`, or `https://<name>.<subdomain>.workers.dev`).
2. Creates the D1 database if missing and resolves its id.
3. Creates the R2 bucket (same name as the database) if missing.
4. Creates the Artifacts namespace `<name>` if missing (REST API), and the repository
   `<name>` in it, and mints a one-hour write token (it travels in git's config env).
   Checks with `git push --dry-run` that the commit can become `main` there: if `main` there
   holds commits this one lacks (a merge made in the app, another deploy), the deploy stops
   before anything changes. Merge that `main` in and deploy again.
5. Builds `apps/builder` with `wrangler containers build`, tagged with the git sha. An image the
   registry already holds (the builder unchanged since an earlier deploy) is reused by its
   digest; any other is pushed with `wrangler containers push`. The config references
   `registry.cloudflare.com/<account>/<name>@sha256:<digest>`.
6. Writes `apps/backend/dist/worker/wrangler.generated.production.json`.
7. Applies pending D1 migrations to the production database.
8. Lists the Worker's secrets; sets `CLOUDFLARE_API_TOKEN` when `WORKER_API_TOKEN` is given,
   generates `BETTER_AUTH_SECRET` and `SIGNING_KEY` when missing,
   and the push key pair `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` once (a new pair would
   unsubscribe every device).
9. `wrangler deploy` with a temporary `--secrets-file` (deleted afterwards); the secrets it set go to the Worker's Preview base config too, which gives them to every Preview. The push key pair does not: a Preview sends no reminders.
10. Pushes the deployed commit to `main` in the repository (`HEAD:main`) and the tags; on the
    first deploy also starts `upstream/main` there at the same commit.
11. If the `user` table is empty, asks for the owner's email, name and password (password without
    echo) and inserts the owner with a hash made by better-auth's own `hashPassword`.
12. Prints the URL.

Flags (`pnpm run deploy --name home`):

| Flag                                                | Default                                  | Meaning                                                                                                                |
| --------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--name`                                            | `matron`                                 | Worker name; the D1, R2 bucket, Artifacts namespace and repository, and the builder image and container share its name |
| `--origin`                                          | `https://<name>.<subdomain>.workers.dev` | Production origin (`APP_ORIGIN`)                                                                                       |
| `--skip-image`                                      | off                                      | Do not build; use `BUILDER_IMAGE=<digest-pinned ref>` from the shell                                                   |
| `--no-container`                                    | off                                      | Deploy without the builder container; no Docker, building off                                                          |
| `--owner-email`, `--owner-name`, `--owner-password` | prompted                                 | Owner account on a first deploy                                                                                        |

Shell variables:

| Variable                | Meaning                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_API_TOKEN`      | The token the Worker keeps. Give it on the first deploy, or again to replace it.                                                |
| `CLOUDFLARE_ACCOUNT_ID` | The account to deploy to, when the login sees several.                                                                          |
| `CLOUDFLARE_API_TOKEN`  | Deploys with this token in place of wrangler's login. It is also the token the Worker keeps unless `WORKER_API_TOKEN` is given. |
| `BUILDER_IMAGE`         | With `--skip-image`: a digest-pinned image that is already in the registry.                                                     |

## When the deploy stops

Each of these stops the deploy before the Worker changes.

| The script says                                          | What to do                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| "the working tree has uncommitted changes"               | Commit or stash. The Worker would be built from the changes, but the repository push would not carry them.                                 |
| "not logged in"                                          | Run `wrangler login`, or set `CLOUDFLARE_API_TOKEN`.                                                                                       |
| "the token sees N accounts"                              | Set `CLOUDFLARE_ACCOUNT_ID` to one of the accounts it lists.                                                                               |
| "could not resolve the account's workers.dev subdomain"  | Enable the subdomain in the dashboard, or pass `--origin`.                                                                                 |
| "could not create the Artifacts namespace"               | Artifacts needs a Workers Paid plan. A `CLOUDFLARE_API_TOKEN` deploying in the login's place needs Account / Artifacts / Edit.             |
| "main in the repository has commits this one lacks"      | A change was merged in the app, or deployed from elsewhere. Merge the repository's `main` (the script prints its remote) and deploy again. |
| "Docker is not available"                                | Start Docker, or deploy with `--skip-image` and `BUILDER_IMAGE`, or with `--no-container`.                                                 |
| "first deploy: pass --owner-email, --owner-name and ..." | There is no terminal to ask in: pass the three owner flags.                                                                                |

## Where things live

| What                                                                              | Where                                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `BETTER_AUTH_SECRET`, `SIGNING_KEY`, `VAPID_*`            | Worker secrets (never in config; printed nowhere)                                                         |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PLACES_API_KEY`               | Worker secrets too, set from App settings through Cloudflare's API; a deploy leaves them as they are      |
| `APP_ORIGIN`, `WORKER_NAME`, `CLOUDFLARE_ACCOUNT_ID`, `BUILDER_IMAGE`, `NODE_ENV` | Worker vars in the generated config; every resource the deployment owns carries the name in `WORKER_NAME` |
| Code                                                                              | Artifacts repository `<name>` in namespace `<name>` (the only source of truth after the first deploy)     |
| Users, branches, sessions, lists, events                                          | Production D1 `<name>`                                                                                    |
| Files                                                                             | R2 bucket `<name>`, one prefix per branch                                                                 |
| Builder image                                                                     | `registry.cloudflare.com/<account>/<name>@sha256:<digest>`                                                |
| Planner model, AI Gateway                                                         | App settings (builder model, assistant model); the account's `default` gateway is a constant in code      |

## The generated configs

`scripts/gen-wrangler-config.mjs` reads `apps/backend/.wrangler/deploy/config.json` (written by
`vite build`) to find the emitted config and writes `wrangler.generated.<target>.json` beside it.

Env: `TARGET` (`production` | `preview`), `WORKER_NAME`, `DB_NAME`, `DB_ID`, `APP_ORIGIN`,
`ACCOUNT_ID`; optional `BUILDER_IMAGE`, and `NO_CONTAINER=1` to leave the builder container out
(what `--no-container` sets). The bucket and the Artifacts namespace are named after the Worker.

- `production`: `workers_dev` when the origin is a `workers.dev` URL, `preview_urls` on, the
  builder container as a Durable Object-managed container named after the Worker whose image
  `builder` is `BUILDER_IMAGE` (or the Dockerfile when unset), linked from the `exports` entry of
  `BuilderObject`, and observability.
- `preview`: no container at all, and a `previews` block repeating vars, D1, R2, Artifacts,
  Images and Durable Object bindings, because a Preview inherits nothing. The builder uses
  it with `wrangler preview --config ... --name <preview>`.

## Limitations

- Changes to `apps/builder` (the image) only ship through this terminal deploy; the builder
  references the published image and never rebuilds it.
- Docker is required unless `BUILDER_IMAGE` points at an image already in the registry
  (`--skip-image`) or the Worker is deployed without the builder (`--no-container`, which turns
  building off). Previews never need Docker.
- A custom `--origin` is not attached as a route or domain by the script; add the custom domain
  to the Worker in the dashboard.
- Secrets are additive: a secret removed from the shell is not removed from the Worker.
- A Preview gets production's secrets from the Worker's Preview base config. A secret changed by hand
  on the Worker (`wrangler secret put`) is changed there too
  (`wrangler preview base-config secret put`), or branches stop working.

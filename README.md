# Matron

A household organizer that releases itself. Matron runs as one Cloudflare Worker and lets
the people using it ask for changes from inside the app: a planning agent turns the request
into a plan, a builder container writes the code on a branch, deploys it as a Worker Preview
with its own copy of the data, and the owner merges it back when it looks right.

`SELF-RELEASING-GUIDE.md` is the design. `CLAUDE.md` holds the conventions for working in this repository.
`docs/deployment.md` explains `pnpm run deploy`.

## Requirements

- A Cloudflare account on the Workers Paid plan.
- Node 22, pnpm 10, git, and Docker for the first deploy (it builds the builder image).
- Unified Billing (or a stored provider key) on the account's default AI Gateway; the
  planner and the coding agent call Claude through it with the Cloudflare token.

## Develop

```sh
pnpm install
pnpm db:migrate        # local D1
# apps/backend/.dev.vars: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, for the planner
pnpm dev               # worker on :8301, SPA on :5173
pnpm test              # Playwright e2e
```

## Deploy

```sh
export CLOUDFLARE_API_TOKEN=...   # see docs/deployment.md for the permissions
pnpm run deploy
```

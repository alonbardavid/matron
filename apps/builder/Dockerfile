# The builder image: the container harness's daemon (`src/daemon.ts`), which
# runs the step commands and the coding agent as the BuilderObject asks, and
# the tools they need. Built for linux/amd64 and pushed to the Cloudflare
# registry by `pnpm deploy`.
FROM --platform=linux/amd64 node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl jq procps util-linux \
  && rm -rf /var/lib/apt/lists/*

RUN npm i -g pnpm@10 wrangler @anthropic-ai/claude-code \
  && npm cache clean --force

# Chromium for the repository's Playwright tests. The version matches
# `@playwright/test` in tests/package.json; a browser is only found by the
# Playwright that downloaded it.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm dlx playwright@1.64.1 install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/* /root/.cache/pnpm

ENV NODE_ENV=production \
    HOME=/root \
    CLAUDE_CONFIG_DIR=/work/claude \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_AUTOUPDATER=1 \
    WRANGLER_SEND_METRICS=false \
    CI=true \
    MATRON_WORK_DIR=/work

COPY package.json /app/package.json
# The package is a workspace member, so there is no lockfile of its own to freeze.
RUN cd /app && pnpm install --prod --no-frozen-lockfile \
  && pnpm store prune
COPY dist /app/dist
COPY prompts /app/prompts
COPY claude-settings.json /app/claude-settings.json

RUN mkdir -p /work/state /work/claude
WORKDIR /work

# The harness tells the daemon its port, identity and secret in the environment.
CMD ["node", "/app/dist/daemon.js"]

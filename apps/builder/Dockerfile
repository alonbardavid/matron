# The builder container: clones the repository, runs the coding agent, deploys
# Previews and merges branches. Built for linux/amd64 and pushed to the
# Cloudflare registry by `pnpm deploy`.
FROM --platform=linux/amd64 node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl jq \
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
    CLAUDE_CONFIG_DIR=/work/claude \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    WRANGLER_SEND_METRICS=false \
    CI=true

COPY package.json /app/package.json
# The package is a workspace member, so there is no lockfile of its own to freeze.
RUN cd /app && pnpm install --prod --no-frozen-lockfile \
  && pnpm store prune
COPY dist /app/dist
COPY prompts /app/prompts

RUN mkdir -p /work/state /work/claude
WORKDIR /work

EXPOSE 8080
CMD ["node", "/app/dist/server.js"]

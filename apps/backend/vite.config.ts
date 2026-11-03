import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { workspaceAlias } from "../../tooling/workspace-alias";

const persistTo = process.env.WORKER_PERSIST_TO;
// Artifacts has no local simulator. With this set, local dev binds the real
// namespace (wrangler login, or CLOUDFLARE_API_TOKEN).
const artifactsNamespace = process.env.ARTIFACTS_NAMESPACE;

export default defineConfig(({ command }) => ({
  // The Worker's assets. A build serves apps/backend/public, which
  // scripts/assemble-assets.mjs fills with the frontend's build and the
  // router's pages from static/; dev serves static/ alone, the frontend
  // having its own dev server.
  publicDir: command === "build" ? "public" : "static",
  plugins: [
    cloudflare({
      // Pins the output to dist/worker regardless of the worker name.
      viteEnvironment: { name: "worker" },
      persistState: persistTo ? { path: persistTo } : true,
      config: {
        ...(artifactsNamespace && {
          artifacts: [
            { binding: "ARTIFACTS", namespace: artifactsNamespace, remote: true },
          ],
        }),
      },
    }),
  ],
  resolve: { alias: workspaceAlias },
  server: { port: 8301, strictPort: true },
}));

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workspaceAlias } from "../../tooling/workspace-alias";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAlias },
  build: { outDir: "dist/public", emptyOutDir: true },
  server: {
    proxy: { "/api": { target: "http://localhost:8301", ws: true } },
  },
});

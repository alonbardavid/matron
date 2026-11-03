#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Runs before `vite build` of the worker, which copies apps/backend/public
// into the Worker's static assets: the frontend's build, plus the router's
// own pages from apps/backend/static.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "apps/backend/public");
const frontendBuild = resolve(root, "apps/frontend/dist/public");
const routerStatic = resolve(root, "apps/backend/static");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(frontendBuild, target, { recursive: true });
await cp(routerStatic, target, { recursive: true });
console.log(`Staged frontend assets and router pages in ${target}`);

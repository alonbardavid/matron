#!/usr/bin/env node
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm db:new add_lists` → migrations/0002_add_lists.sql
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const name = process.argv.slice(2).join(" ").trim();
const slug = name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_|_$/g, "");
if (!slug) {
  console.error("Usage: pnpm db:new <name>");
  process.exit(1);
}
const numbers = readdirSync(migrationsDir)
  .map((file) => Number(/^(\d+)_/.exec(file)?.[1]))
  .filter((n) => Number.isFinite(n));
const next = String(Math.max(0, ...numbers) + 1).padStart(4, "0");
const file = join(migrationsDir, `${next}_${slug}.sql`);
writeFileSync(file, "", { flag: "wx" });
console.log(`Created ${relative(process.cwd(), file)}`);

#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// `pnpm db:new add_lists` → migrations/20270314092653_add_lists.sql
// A migration is named by when it was written (UTC, to the second), so two
// written apart never take the same name and they apply in the order written.
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
const written = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const file = join(migrationsDir, `${written}_${slug}.sql`);
writeFileSync(file, "", { flag: "wx" });
console.log(`Created ${relative(process.cwd(), file)}`);

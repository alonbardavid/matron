import { readFileSync, rmSync } from "node:fs";
import { combined, describeFailure, exec, tail, type ExecResult } from "./exec.js";
import { BuilderError, type BuilderRun } from "./types.js";

export type WranglerContext = {
  run: BuilderRun;
  /** apps/backend in the clone. */
  cwd: string;
  onOutput?: (text: string) => void;
};

export function wranglerEnv(run: BuilderRun): NodeJS.ProcessEnv {
  return {
    CLOUDFLARE_API_TOKEN: run.cloudflare.apiToken,
    CLOUDFLARE_ACCOUNT_ID: run.cloudflare.accountId,
    WRANGLER_SEND_METRICS: "false",
    CI: "true",
  };
}

export type WranglerOptions = {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export async function wrangler(
  ctx: WranglerContext,
  args: string[],
  options: WranglerOptions = {},
): Promise<ExecResult> {
  return exec("pnpm", ["exec", "wrangler", ...args], {
    cwd: options.cwd ?? ctx.cwd,
    env: { ...wranglerEnv(ctx.run), ...options.env },
    timeoutMs: options.timeoutMs ?? 10 * 60 * 1000,
    onOutput: ctx.onOutput,
  });
}

/** Runs wrangler and throws a readable BuilderError (with the output tail) on failure. */
export async function wranglerMust(
  ctx: WranglerContext,
  label: string,
  args: string[],
  options: WranglerOptions = {},
): Promise<ExecResult> {
  const result = await wrangler(ctx, args, options);
  if (result.code !== 0)
    throw new BuilderError(describeFailure(label, result), tail(combined(result)));
  return result;
}

/** Runs wrangler and reports failure as a log line instead of throwing (cleanup steps). */
export async function wranglerTolerant(
  ctx: WranglerContext,
  label: string,
  args: string[],
  log: (text: string) => void,
): Promise<boolean> {
  try {
    const result = await wrangler(ctx, args);
    if (result.code === 0) return true;
    log(`${describeFailure(label, result)} (ignored)\n${tail(combined(result), 20)}`);
  } catch (error) {
    log(`${label} failed: ${String(error)} (ignored)`);
  }
  return false;
}

export type D1Database = { uuid: string; name: string };

export async function d1List(ctx: WranglerContext): Promise<D1Database[]> {
  const result = await wranglerMust(ctx, "wrangler d1 list", ["d1", "list", "--json"]);
  return parseD1List(result.stdout);
}

export function parseD1List(stdout: string): D1Database[] {
  const value = parseJsonOutput(stdout);
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({ uuid: String(item.uuid ?? ""), name: String(item.name ?? "") }))
    .filter((db) => db.uuid && db.name);
}

export async function d1Find(
  ctx: WranglerContext,
  name: string,
): Promise<D1Database | null> {
  return (await d1List(ctx)).find((db) => db.name === name) ?? null;
}

export async function d1Info(
  ctx: WranglerContext,
  name: string,
): Promise<D1Database | null> {
  const result = await wrangler(ctx, ["d1", "info", name, "--json"]);
  if (result.code !== 0) return null;
  const value = parseJsonOutput(result.stdout);
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const uuid = typeof record.uuid === "string" ? record.uuid : null;
  return uuid
    ? { uuid, name: typeof record.name === "string" ? record.name : name }
    : null;
}

export async function d1Create(ctx: WranglerContext, name: string): Promise<void> {
  await wranglerMust(ctx, `wrangler d1 create ${name}`, ["d1", "create", name]);
}

/** Exports one half of a database: its tables and indexes, or the rows in them. */
export async function d1Export(
  ctx: WranglerContext,
  name: string,
  output: string,
  part: "schema" | "data",
): Promise<void> {
  await wranglerMust(
    ctx,
    `wrangler d1 export ${name} (${part})`,
    [
      "d1",
      "export",
      name,
      "--remote",
      "--output",
      output,
      "--skip-confirmation",
      part === "schema" ? "--no-data" : "--no-schema",
    ],
    {
      timeoutMs: 30 * 60 * 1000,
    },
  );
}

/** Deletes a database; best effort, for one that was only half made. */
export async function d1Delete(ctx: WranglerContext, name: string): Promise<void> {
  await wrangler(ctx, ["d1", "delete", name, "--skip-confirmation"]);
}

export async function d1ExecuteFile(
  ctx: WranglerContext,
  name: string,
  file: string,
): Promise<void> {
  await wranglerMust(
    ctx,
    `wrangler d1 execute ${name}`,
    ["d1", "execute", name, "--remote", "--yes", "--file", file],
    {
      timeoutMs: 30 * 60 * 1000,
    },
  );
}

export async function d1MigrationsApply(
  ctx: WranglerContext,
  config: string,
): Promise<void> {
  await wranglerMust(
    ctx,
    "wrangler d1 migrations apply",
    ["d1", "migrations", "apply", "DB", "--remote", "--config", config],
    {
      timeoutMs: 20 * 60 * 1000,
    },
  );
}

export async function workerDeploy(ctx: WranglerContext, config: string): Promise<void> {
  await wranglerMust(ctx, "wrangler deploy", ["deploy", "--config", config], {
    timeoutMs: 20 * 60 * 1000,
  });
}

/**
 * The preview URL from `wrangler preview`: the output file (WRANGLER_OUTPUT_FILE_PATH)
 * carries `preview_urls`; `--json` stdout may carry the same; otherwise a
 * `https://<preview>-<worker>.<subdomain>.workers.dev` link in the text.
 */
export function parsePreviewUrl(
  text: string,
  previewName: string,
  workerName: string,
): string | null {
  const host = `${previewName}-${workerName}`;
  for (const candidate of jsonCandidates(text)) {
    const url = urlFromRecord(candidate, host);
    if (url) return url;
  }
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(`https://${escaped}\\.[a-z0-9-]+\\.workers\\.dev`, "i").exec(
    text,
  );
  if (exact) return exact[0];
  const any = /https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/i.exec(text);
  return any ? any[0] : null;
}

function urlFromRecord(value: unknown, host: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const lists = [record.preview_urls, record.deployment_urls, record.urls];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const urls = list.filter((item): item is string => typeof item === "string");
    const match = urls.find((url) => url.includes(host)) ?? urls[0];
    if (match) return match.startsWith("http") ? match : `https://${match}`;
  }
  for (const key of ["preview_url", "url"]) {
    const url = record[key];
    if (typeof url === "string" && url.includes("workers.dev"))
      return url.startsWith("http") ? url : `https://${url}`;
  }
  return null;
}

function* jsonCandidates(text: string): Generator<unknown> {
  const whole = parseJsonOutput(text);
  if (whole !== undefined) yield whole;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      yield JSON.parse(trimmed);
    } catch {
      // not a JSON line
    }
  }
}

/** Parses JSON that wrangler may surround with banner lines. */
export function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  const start = Math.min(
    ...["[", "{"].map((ch) => text.indexOf(ch)).filter((i) => i >= 0),
  );
  if (!Number.isFinite(start)) return undefined;
  for (const end of [text.lastIndexOf("]"), text.lastIndexOf("}")]) {
    if (end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // try the other closer
      }
    }
  }
  return undefined;
}

export function readOutputFile(file: string): string {
  try {
    const text = readFileSync(file, "utf8");
    rmSync(file, { force: true });
    return text;
  } catch {
    return "";
  }
}

const API = "https://api.cloudflare.com/client/v4";

async function api(
  run: BuilderRun,
  method: string,
  path: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${run.cloudflare.apiToken}`,
      "Content-Type": "application/json",
    },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body.success === false) {
    const errors = Array.isArray(body.errors)
      ? body.errors.map((e) => JSON.stringify(e)).join("; ")
      : "";
    throw new Error(`${method} ${path} -> ${response.status} ${errors}`);
  }
  return body;
}

/** The account's workers.dev subdomain, to compose a preview URL when wrangler printed none. */
export async function workersSubdomain(run: BuilderRun): Promise<string | null> {
  try {
    const body = await api(
      run,
      "GET",
      `/accounts/${run.cloudflare.accountId}/workers/subdomain`,
    );
    const result = body.result as Record<string, unknown> | undefined;
    return typeof result?.subdomain === "string" ? result.subdomain : null;
  } catch {
    return null;
  }
}

export function composePreviewUrl(
  previewName: string,
  workerName: string,
  subdomain: string,
): string {
  return `https://${previewName}-${workerName}.${subdomain}.workers.dev`;
}

/** Deletes every object under `prefix` in `bucket`. Returns how many were deleted. */
export async function r2DeletePrefix(
  run: BuilderRun,
  bucket: string,
  prefix: string,
): Promise<number> {
  const base = `/accounts/${run.cloudflare.accountId}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const query = new URLSearchParams({ prefix, per_page: "1000" });
    if (cursor) query.set("cursor", cursor);
    const body = await api(run, "GET", `${base}?${query}`);
    const objects = Array.isArray(body.result)
      ? (body.result as Record<string, unknown>[])
      : [];
    for (const object of objects) {
      if (typeof object.key !== "string") continue;
      await api(run, "DELETE", `${base}/${encodeURIComponent(object.key)}`);
      deleted++;
    }
    const info = body.result_info as Record<string, unknown> | undefined;
    cursor =
      info?.is_truncated && typeof info.cursor === "string" ? info.cursor : undefined;
  } while (cursor);
  return deleted;
}

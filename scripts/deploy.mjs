#!/usr/bin/env node
// Terminal deploy (SELF-RELEASING-GUIDE.md "Initial setup"): `pnpm run deploy` runs `pnpm build`
// and then this script. It provisions the production resources that do not
// exist yet, generates the production wrangler config, deploys the Worker,
// pushes the code into the Artifacts repository and creates the owner on a
// first deploy. Every Cloudflare call goes through wrangler or the REST API,
// authenticated with CLOUDFLARE_API_TOKEN from the shell or, without one, with
// wrangler's own login. See docs/deployment.md.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createUserSql } from "./lib/owner-sql.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(root, "apps/backend");
const generatedConfig = "dist/worker/wrangler.generated.production.json"; // relative to apps/backend
const API = "https://api.cloudflare.com/client/v4";

const TOKEN_PERMISSIONS = [
  "Account / Workers Scripts / Edit",
  "Account / D1 / Edit",
  "Account / Workers R2 Storage / Edit",
  "Account / Artifacts / Edit",
  "Account / AI Gateway / Run",
  "Account / Workers Containers / Edit",
  "Account / Cloudflare Images / Edit",
  "Account / Email Sending / Edit",
  "Account / Account Settings / Read",
];

const USAGE = `Usage: pnpm run deploy [flags]   (or: pnpm build && node scripts/deploy.mjs [flags])

  --name <worker>          Worker name (default: matron); the database, bucket, repository and image are named after it
  --origin <url>           Production origin (default: https://<name>.<subdomain>.workers.dev)
  --skip-image             Do not build/push the builder image; use BUILDER_IMAGE (digest-pinned) from the shell
  --no-container           Deploy without the builder container (no Docker needed; building is off)
  --skip-repo              Do not create/push the Artifacts code repository
  --owner-email <email>    Owner account on a first deploy (prompted when omitted)
  --owner-name <name>
  --owner-password <pw>    Prompted without echo when omitted
  --help

Shell: CLOUDFLARE_API_TOKEN (stored on the Worker; without it wrangler's login is used
and the secret is left for later), optional CLOUDFLARE_ACCOUNT_ID, BUILDER_IMAGE (with --skip-image).`;

// ---------------------------------------------------------------- helpers

function fail(message) {
  console.error(`\ndeploy: ${message}`);
  process.exit(1);
}

let stepNo = 0;
function step(title) {
  stepNo += 1;
  console.log(`\n[${stepNo}] ${title}`);
}

/** Runs wrangler in apps/backend through pnpm. Returns stdout when captured. */
function wrangler(args, { capture = false, allowFailure = false, env = {} } = {}) {
  const cmd = ["--silent", "--filter", "@app/backend", "exec", "wrangler", ...args];
  if (!capture) console.log(`  $ wrangler ${args.join(" ")}`);
  const result = spawnSync("pnpm", cmd, {
    cwd: backendDir,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
      ...env,
    },
  });
  if (result.error) fail(`could not run wrangler: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    if (capture) process.stderr.write(result.stderr ?? "");
    fail(`wrangler ${args[0]} ${args[1] ?? ""} failed (exit ${result.status})`);
  }
  return capture
    ? { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
    : result;
}

/** wrangler prints a banner before JSON unless --json silences it; take the last JSON value. */
function parseJsonOutput(text) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in wrangler output:\n${text}`);
  return JSON.parse(text.slice(start));
}

function run(
  cmd,
  args,
  { cwd = root, capture = true, env = {}, allowFailure = false } = {},
) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    if (allowFailure) return { status: 1, stdout: "", stderr: result.error.message };
    fail(`could not run ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    if (capture) process.stderr.write(result.stderr ?? "");
    fail(`${cmd} ${args.join(" ")} failed (exit ${result.status})`);
  }
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: result.stderr ?? "",
  };
}

/**
 * Bearer for REST calls: the shell token, else the OAuth token wrangler keeps
 * for its login (refreshed by running any wrangler command first).
 */
function apiBearer() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const configDir =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "darwin"
      ? join(homedir(), "Library/Preferences")
      : join(homedir(), ".config"));
  const file = join(configDir, ".wrangler/config/default.toml");
  if (!existsSync(file))
    fail("not logged in: run wrangler login, or set CLOUDFLARE_API_TOKEN");
  const text = readFileSync(file, "utf8");
  const expires = /^expiration_time\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  if (expires && new Date(expires).getTime() < Date.now() + 60_000) {
    // Any wrangler command refreshes the stored token.
    wrangler(["whoami"], { capture: true });
    return apiBearer();
  }
  const token = /^oauth_token\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  if (!token)
    fail(`no oauth_token in ${file}: run wrangler login, or set CLOUDFLARE_API_TOKEN`);
  return token;
}

async function cfApi(path, { method = "GET", body, retried = false } = {}) {
  const response = await globalThis.fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiBearer()}`,
      ...(body && { "content-type": "application/json" }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { errors: [{ message: text.slice(0, 200) }] };
  }
  const errors = json.errors ?? [];
  // A login token that was rotated or expired under us answers "Access denied":
  // any wrangler command stores a fresh one, so refresh and try once more.
  if (
    !retried &&
    !process.env.CLOUDFLARE_API_TOKEN &&
    errors.some((e) => e.code === 10004 || /access denied/i.test(e.message ?? ""))
  ) {
    wrangler(["whoami"], { capture: true });
    return cfApi(path, { method, body, retried: true });
  }
  return {
    status: response.status,
    ok: response.ok && json.success !== false,
    result: json.result,
    errors,
  };
}

function describeErrors(errors) {
  return (
    errors.map((e) => `${e.code ? `${e.code}: ` : ""}${e.message}`).join("; ") ||
    "unknown error"
  );
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolvePrompt) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      let muted = false;
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (text) => {
        if (!muted) write(text);
      };
      rl.question(question, (answer) => {
        muted = false;
        process.stdout.write("\n");
        rl.close();
        resolvePrompt(answer);
      });
      muted = true;
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolvePrompt(answer.trim());
      });
    }
  });
}

// ---------------------------------------------------------------- arguments

let flags;
try {
  flags = parseArgs({
    options: {
      name: { type: "string", default: "matron" },
      origin: { type: "string" },
      "skip-image": { type: "boolean", default: false },
      "no-container": { type: "boolean", default: false },
      "skip-repo": { type: "boolean", default: false },
      "owner-email": { type: "string" },
      "owner-name": { type: "string" },
      "owner-password": { type: "string" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  }).values;
} catch (error) {
  console.error(`deploy: ${error.message}\n\n${USAGE}`);
  process.exit(1);
}

if (flags.help) {
  console.log(USAGE);
  process.exit(0);
}

const workerName = flags.name;
const DIGEST_IMAGE =
  /^registry\.cloudflare\.com\/[a-f0-9]{32}\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/;

if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(workerName)) {
  fail(`--name must be lowercase letters, digits and dashes, got "${workerName}"`);
}

const hasApiToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
if (!hasApiToken) {
  console.log(
    "CLOUDFLARE_API_TOKEN is not set: deploying with wrangler's login. The Worker needs the token\n" +
      "as a secret before it can build: create one at https://dash.cloudflare.com/profile/api-tokens with\n" +
      TOKEN_PERMISSIONS.map((p) => `  - ${p}`).join("\n") +
      "\nand set it with `export CLOUDFLARE_API_TOKEN=... && pnpm run deploy`.",
  );
}

if (!existsSync(join(backendDir, ".wrangler/deploy/config.json"))) {
  fail(
    "no build output in apps/backend: run pnpm build first (pnpm run deploy does both)",
  );
}

let accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined;

// ---------------------------------------------------------------- git preflight

const gitHead = run("git", ["rev-parse", "--verify", "--short", "HEAD"], {
  allowFailure: true,
});
if (!flags["skip-repo"]) {
  if (gitHead.status !== 0)
    fail(
      "the repository has no commits yet; commit before deploying (or pass --skip-repo)",
    );
  const branch = run("git", ["branch", "--show-current"]).stdout;
  if (branch !== "main")
    fail(`deploy from the main branch (currently on "${branch || "detached HEAD"}")`);
  const dirty = run("git", ["status", "--porcelain"]).stdout;
  if (dirty) {
    fail(
      "the working tree has uncommitted changes; the Worker was built from them but the repository push would not carry them.\n" +
        "Commit (or stash) first, or pass --skip-repo.\n" +
        dirty,
    );
  }
}

// ---------------------------------------------------------------- 1. account

step("Resolving the Cloudflare account");
if (accountId) {
  console.log(`  using CLOUDFLARE_ACCOUNT_ID=${accountId}`);
} else {
  const accounts = await cfApi("/accounts?per_page=50");
  if (!accounts.ok) {
    fail(
      `GET /accounts failed: ${describeErrors(accounts.errors)}\nThe token needs at least these permissions:\n` +
        TOKEN_PERMISSIONS.map((p) => `  - ${p}`).join("\n"),
    );
  }
  if (accounts.result.length !== 1) {
    fail(
      `the token sees ${accounts.result.length} accounts; set CLOUDFLARE_ACCOUNT_ID to one of:\n` +
        accounts.result.map((a) => `  ${a.id}  ${a.name}`).join("\n"),
    );
  }
  accountId = accounts.result[0].id;
  console.log(`  account ${accounts.result[0].name} (${accountId})`);
}

let origin = flags.origin?.replace(/\/$/, "");
if (!origin) {
  const subdomain = await cfApi(`/accounts/${accountId}/workers/subdomain`);
  if (!subdomain.ok || !subdomain.result?.subdomain) {
    fail(
      "could not resolve the account's workers.dev subdomain; enable it in the dashboard (Workers & Pages → " +
        "your subdomain) or pass --origin https://... explicitly. " +
        describeErrors(subdomain.errors),
    );
  }
  origin = `https://${workerName}.${subdomain.result.subdomain}.workers.dev`;
}
console.log(`  worker ${workerName} → ${origin}`);

// ---------------------------------------------------------------- 2. D1

step(`D1 database "${workerName}"`);
function findDatabase() {
  const list = parseJsonOutput(
    wrangler(["d1", "list", "--json"], { capture: true }).stdout,
  );
  return list.find((db) => db.name === workerName);
}
let database = findDatabase();
if (database) {
  console.log(`  exists (${database.uuid})`);
} else {
  wrangler(["d1", "create", workerName]);
  database = findDatabase();
  if (!database)
    fail(`created D1 "${workerName}" but cannot find it in wrangler d1 list`);
  console.log(`  created (${database.uuid})`);
}
const dbId = database.uuid;

// ---------------------------------------------------------------- 3. R2

step(`R2 bucket "${workerName}"`);
{
  const list = wrangler(["r2", "bucket", "list"], { capture: true }).stdout;
  const names = [...list.matchAll(/^name:\s+(\S+)/gm)].map((m) => m[1]);
  if (names.includes(workerName)) {
    console.log("  exists");
  } else {
    const created = wrangler(["r2", "bucket", "create", workerName], {
      capture: true,
      allowFailure: true,
    });
    if (
      created.status !== 0 &&
      !/already exists/i.test(created.stderr + created.stdout)
    ) {
      process.stderr.write(created.stderr);
      fail(`could not create R2 bucket "${workerName}"`);
    }
    console.log(created.status === 0 ? "  created" : "  exists");
  }
}

// ---------------------------------------------------------------- 4. AI Gateway + Artifacts namespace

step(`Artifacts namespace "${workerName}"`);
{
  // wrangler has no "namespaces create"; the REST API does.
  const existing = await cfApi(
    `/accounts/${accountId}/artifacts/namespaces/${workerName}`,
  );
  if (existing.ok) {
    console.log("  exists");
  } else {
    const created = await cfApi(`/accounts/${accountId}/artifacts/namespaces`, {
      method: "POST",
      body: { namespace: workerName },
    });
    if (created.ok) console.log("  created");
    else if (created.status === 409) console.log("  exists");
    else {
      fail(
        `could not create the Artifacts namespace: ${describeErrors(created.errors)}\n` +
          "Artifacts needs a Workers Paid plan and the token needs Artifacts Edit.",
      );
    }
  }
}

// ---------------------------------------------------------------- 5. builder image

step("Builder container image");
let builderImage = process.env.BUILDER_IMAGE?.trim() || undefined;
if (flags["no-container"]) {
  console.log("  skipped: deploying without the builder container");
} else if (flags["skip-image"]) {
  if (!builderImage || !DIGEST_IMAGE.test(builderImage))
    fail(
      "--skip-image needs BUILDER_IMAGE=registry.cloudflare.com/<account>/<repo>@sha256:<digest> in the shell",
    );
  console.log(`  skipped; using ${builderImage}`);
} else {
  const docker = run("docker", ["info"], { allowFailure: true });
  if (docker.status !== 0) {
    fail(
      "Docker is not available, and the builder image is built locally.\n" +
        "Install and start Docker, or deploy with an image that is already in the registry:\n" +
        `  BUILDER_IMAGE=registry.cloudflare.com/${accountId}/${workerName}@sha256:<digest> pnpm run deploy --skip-image`,
    );
  }
  const tag =
    gitHead.status === 0
      ? gitHead.stdout
      : new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  // `-t name:tag --push` pushes to registry.cloudflare.com/<account>/name:tag.
  // The config needs the digest, which the push prints.
  const built = wrangler(
    [
      "containers",
      "build",
      join(root, "apps/builder"),
      "-t",
      `${workerName}:${tag}`,
      "--push",
    ],
    { capture: true },
  );
  process.stdout.write(built.stdout.split("\n").slice(-12).join("\n") + "\n");
  let digest = /digest:\s*(sha256:[a-f0-9]{64})/.exec(built.stdout + built.stderr)?.[1];
  if (!digest) {
    // A tag that is already in the registry is not pushed again, and then
    // nothing prints its digest: the registry is asked for it instead.
    const ref = `registry.cloudflare.com/${accountId}/${workerName}:${tag}`;
    const inspected = run(
      "docker",
      ["buildx", "imagetools", "inspect", ref, "--format", "{{.Manifest.Digest}}"],
      { capture: true, allowFailure: true },
    );
    digest = /sha256:[a-f0-9]{64}/.exec(inspected.stdout)?.[0];
  }
  if (!digest) fail("the image was pushed but no digest appeared in wrangler's output");
  builderImage = `registry.cloudflare.com/${accountId}/${workerName}@${digest}`;
  console.log(`  pushed ${builderImage}`);
}

// ---------------------------------------------------------------- 6. config

step("Generating the production wrangler config");
run("node", [join(root, "scripts/gen-wrangler-config.mjs")], {
  capture: false,
  env: {
    TARGET: "production",
    WORKER_NAME: workerName,
    DB_NAME: workerName,
    DB_ID: dbId,
    APP_ORIGIN: origin,
    ACCOUNT_ID: accountId,
    BUILDER_IMAGE: builderImage,
    NO_CONTAINER: flags["no-container"] ? "1" : "",
  },
});

// ---------------------------------------------------------------- 7. migrations

step("Applying D1 migrations");
wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", generatedConfig]);

// ---------------------------------------------------------------- 8. secrets

step("Worker secrets");
const secretsFileDir = mkdtempSync(join(tmpdir(), "matron-deploy-"));
const secretsFile = join(secretsFileDir, "secrets.json");
let firstDeploy = false;
// What this run sets on the Worker, by name; the same goes to its Previews.
let settingNow;
{
  const listed = wrangler(
    [
      "secret",
      "list",
      "--name",
      workerName,
      "--config",
      generatedConfig,
      "--format",
      "json",
    ],
    {
      capture: true,
      allowFailure: true,
    },
  );
  let existing = [];
  if (listed.status === 0) {
    existing = parseJsonOutput(listed.stdout).map((s) => s.name);
  } else if (/10007|not found|does not exist/i.test(listed.stderr + listed.stdout)) {
    firstDeploy = true;
    console.log("  the Worker does not exist yet: first deploy");
  } else {
    process.stderr.write(listed.stderr);
    fail("could not list the Worker's secrets");
  }
  const secrets = {};
  if (hasApiToken) secrets.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  for (const generated of ["BETTER_AUTH_SECRET", "SIGNING_KEY"]) {
    if (!existing.includes(generated))
      secrets[generated] = randomBytes(32).toString("hex");
  }
  writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  settingNow = Object.keys(secrets);
  console.log(`  setting: ${Object.keys(secrets).join(", ") || "nothing new"}`);
  if (hasApiToken) {
    console.log(
      "  WARNING: CLOUDFLARE_API_TOKEN is stored as a Worker secret. The router creates databases and\n" +
        "  Previews with it, and the builder container receives it. Keep its permissions to the list above.",
    );
  } else if (!existing.includes("CLOUDFLARE_API_TOKEN")) {
    console.log(
      "  CLOUDFLARE_API_TOKEN is not set on the Worker: building stays off until it is.",
    );
  }
}

// ---------------------------------------------------------------- 9. deploy

step("Deploying the Worker");
try {
  wrangler(["deploy", "--config", generatedConfig, "--secrets-file", secretsFile]);
  // A Preview inherits no secret from production. The Worker's Preview base
  // config gives each one the same values; the app keeps the household's own
  // secrets there when they are saved in its settings.
  if (settingNow.length > 0) {
    console.log(`  the same for Previews: ${settingNow.join(", ")}`);
    wrangler(
      [
        "preview",
        "base-config",
        "secret",
        "bulk",
        secretsFile,
        "--worker-name",
        workerName,
      ],
      { capture: true },
    );
  }
  const shared = wrangler(
    ["preview", "base-config", "secret", "list", "--worker-name", workerName, "--json"],
    { capture: true, allowFailure: true },
  );
  if (shared.status === 0) {
    const names = parseJsonOutput(shared.stdout).map((s) => s.name);
    const missing = ["SIGNING_KEY", "BETTER_AUTH_SECRET", "CLOUDFLARE_API_TOKEN"].filter(
      (name) => !names.includes(name),
    );
    if (missing.length > 0) {
      console.log(
        `  WARNING: the Preview base config lacks ${missing.join(", ")}. A secret set on the Worker by an\n` +
          "  earlier deploy cannot be read back, so set each in both places with the same value:\n" +
          "  `wrangler secret put <NAME>` and `wrangler preview base-config secret put <NAME>`.\n" +
          "  Without SIGNING_KEY or BETTER_AUTH_SECRET a branch does not work; without CLOUDFLARE_API_TOKEN\n" +
          "  the assistant on a branch reaches no Anthropic model. The token given to Previews may be a\n" +
          "  narrower one than the Worker's.",
      );
    }
  }
} finally {
  rmSync(secretsFileDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 10. repository

step(`Artifacts repository "${workerName}/${workerName}"`);
if (flags["skip-repo"]) {
  console.log("  skipped");
} else {
  const nsArgs = ["--namespace", workerName, "--json"];
  let repo;
  const got = wrangler(["artifacts", "repos", "get", workerName, ...nsArgs], {
    capture: true,
    allowFailure: true,
  });
  if (got.status === 0) {
    repo = parseJsonOutput(got.stdout);
    console.log(`  exists (${repo.remote})`);
  } else {
    const created = wrangler(
      ["artifacts", "repos", "create", workerName, ...nsArgs, "--default-branch", "main"],
      { capture: true },
    );
    repo = parseJsonOutput(created.stdout);
    console.log(`  created (${repo.remote})`);
  }
  if (!repo.remote) fail("the repository has no remote URL in wrangler's output");
  const issued = parseJsonOutput(
    wrangler(
      [
        "artifacts",
        "repos",
        "issue-token",
        workerName,
        ...nsArgs,
        "--scope",
        "write",
        "--ttl",
        "3600",
      ],
      {
        capture: true,
      },
    ).stdout,
  );
  if (!issued.plaintext) fail("issue-token returned no plaintext token");
  // The token travels in git's config env, never in argv.
  const gitEnv = {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${issued.plaintext}`,
    GIT_TERMINAL_PROMPT: "0",
  };
  console.log(`  $ git push --all ${repo.remote}`);
  run("git", ["push", "--all", repo.remote], { capture: false, env: gitEnv });
  console.log(`  $ git push --tags ${repo.remote}`);
  run("git", ["push", "--tags", repo.remote], { capture: false, env: gitEnv });
}

// ---------------------------------------------------------------- 11. owner

step("Owner account");
{
  const count = parseJsonOutput(
    wrangler(
      [
        "d1",
        "execute",
        "DB",
        "--remote",
        "--yes",
        "--json",
        "--config",
        generatedConfig,
        "--command",
        "SELECT count(*) AS n FROM user",
      ],
      { capture: true },
    ).stdout,
  );
  const users = Number(count?.[0]?.results?.[0]?.n ?? NaN);
  if (!Number.isFinite(users))
    fail("unexpected output from wrangler d1 execute while counting users");
  if (users > 0) {
    console.log(`  ${users} user(s) exist; nothing to do`);
  } else {
    firstDeploy = true;
    let email = flags["owner-email"];
    let name = flags["owner-name"];
    let password = flags["owner-password"];
    if ((!email || !name || !password) && !process.stdin.isTTY) {
      fail(
        "first deploy: pass --owner-email, --owner-name and --owner-password (no terminal to prompt in)",
      );
    }
    while (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      email = await ask("  Owner email: ");
    while (!name) name = await ask("  Owner name: ");
    while (!password || password.length < 8) {
      password = await ask("  Owner password (min 8 chars): ", { hidden: true });
      if (password.length >= 8) {
        const again = await ask("  Repeat password: ", { hidden: true });
        if (again !== password) {
          console.log("  passwords differ, try again");
          password = "";
        }
      }
    }
    const sql = await createUserSql({ email, name, role: "owner", password });
    const sqlFile = join(mkdtempSync(join(tmpdir(), "matron-owner-")), "owner.sql");
    writeFileSync(sqlFile, sql + ";\n", { mode: 0o600 });
    try {
      wrangler(
        [
          "d1",
          "execute",
          "DB",
          "--remote",
          "--yes",
          "--config",
          generatedConfig,
          "--file",
          sqlFile,
        ],
        { capture: true },
      );
    } finally {
      rmSync(dirname(sqlFile), { recursive: true, force: true });
    }
    console.log(`  created owner ${email}`);
  }
}

// ---------------------------------------------------------------- 12. done

console.log(`
Deployed ${workerName}: ${origin}
`);
if (firstDeploy)
  console.log(
    "Sign in with the owner account and add the household from the app's user management.",
  );
console.log(`Next deploys: pnpm run deploy (same flags). Changes to apps/builder need this terminal deploy; code
changes made through build sessions are released by the builder itself. See docs/deployment.md.`);

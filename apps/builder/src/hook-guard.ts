import { relative } from "node:path";

/**
 * A PreToolUse hook for the coding agent (wired by /app/claude-settings.json):
 * reads the tool call from stdin and denies what the runner does for the
 * agent, or what would change what the runner is about to do. The prompt
 * says so too; this makes it a rule.
 */
const FORBIDDEN_COMMANDS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\bgit\s+(push|fetch|pull|rebase|cherry-pick|filter-branch|reflog)\b/,
    reason:
      "The runner fetches, pushes and keeps the history; the agent only edits and commits.",
  },
  {
    pattern: /\bgit\s+(reset\s+--hard|checkout\s+-[bB]|switch\s+-[cC]|branch\s+-[dD])\b/,
    reason: "Stay on this branch; the runner manages branches.",
  },
  {
    pattern: /\bgit\s+commit\b.*--amend/,
    reason: "Make a new commit instead of amending.",
  },
  {
    pattern: /\bwrangler\b/,
    reason: "The runner deploys; nothing here talks to Cloudflare.",
  },
  { pattern: /\bpnpm\s+(run\s+)?deploy\b/, reason: "The runner deploys." },
  { pattern: /\bnpm\s|\bnpx\s/, reason: "Use pnpm, never npm or npx." },
];

/** Files the agent never edits, relative to the repository. */
const PROTECTED_PATHS = [
  "scripts/",
  "apps/builder/",
  "turbo.json",
  "apps/backend/wrangler.jsonc",
];

type HookInput = {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
};

export function decide(input: HookInput): string | null {
  const args = input.tool_input ?? {};
  if (input.tool_name === "Bash" && typeof args.command === "string") {
    const command = args.command;
    const hit = FORBIDDEN_COMMANDS.find(({ pattern }) => pattern.test(command));
    return hit ? hit.reason : null;
  }
  if (typeof args.file_path === "string" && input.cwd) {
    const path = relative(input.cwd, args.file_path).replace(/\\/g, "/");
    if (path.startsWith("..")) return "Only files inside the repository may change.";
    const hit = PROTECTED_PATHS.find((p) => path === p || path.startsWith(p));
    return hit ? `${hit} belongs to the runner; a build session never changes it.` : null;
  }
  return null;
}

function main(): void {
  const chunks: Buffer[] = [];
  process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
  process.stdin.on("end", () => {
    let input: HookInput = {};
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as HookInput;
    } catch {
      // Nothing to judge; allow.
    }
    const reason = decide(input);
    if (reason) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        }),
      );
    }
    process.exit(0);
  });
}

main();

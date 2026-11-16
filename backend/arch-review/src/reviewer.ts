import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { answer, repositoryTools } from "@backend/arch-planner/tools";
import { readFile, withRepository } from "@backend/arch-repository/service";
import { getBuilderModel } from "@backend/arch-settings/service";
import { gatewayModel } from "@backend/commons/gateway-model";
import { logger } from "@backend/commons/logger";
import { renderTemplate } from "@backend/commons/template";
import type { ReviewMessage } from "@shared/contract/arch/review";
import branchTemplate from "../prompts/branch.md?raw";
import commitTemplate from "../prompts/commit.md?raw";
import systemTemplate from "../prompts/system.md?raw";
import { reviewEnv } from "./env";
import type { BranchState } from "./service";

const log = logger("arch-review/reviewer");

/** A commit's request or reasoning is cut past this in the prompt. */
const MAX_NOTE_CHARS = 4_000;
const MAX_OUTPUT_TOKENS = 16_000;
/** Model calls one answer may take, tool rounds included, before it must answer. */
const MAX_STEPS = 16;
/** What a section of the prompt says when the branch has nothing for it. */
const NONE = "(none)";

/** The reviewer's next answer: the branch's state and notes in the instructions, the conversation after it. */
export async function askReviewer(
  state: BranchState,
  conversation: ReviewMessage[],
): Promise<string> {
  const env = reviewEnv();
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    throw new Error(
      "No model is configured: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN",
    );
  }
  const slug = `anthropic/${await getBuilderModel()}`;
  const model = gatewayModel(
    slug,
    { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_API_TOKEN },
    {
      agent: "reviewer",
      host: hostOf(env.APP_ORIGIN),
      branch: state.branch.id,
      sessionId: state.branch.buildSessionId,
    },
  );
  if (!model) throw new Error(`The reviewer runs Anthropic models, not "${slug}"`);
  const messages: ModelMessage[] = conversation.map((message) => ({
    role: message.role,
    content: message.text,
  }));
  const result = await generateText({
    model,
    instructions: renderTemplate(systemTemplate, { branch: describeBranch(state) }).trim(),
    messages,
    tools: {
      ...repositoryTools(state.headCommit),
      read_main_file: tool({
        description:
          "Reads one file as it is on main at the commit the branch is compared with, before the branch changed it.",
        inputSchema: z.object({ path: z.string().describe("Repository-relative path") }),
        execute: ({ path }) =>
          answer(
            async () =>
              (await withRepository((repo) => readFile(repo, path, state.baseCommit))) ??
              `No file '${path}' on main`,
          ),
      }),
      file_diff: tool({
        description:
          "The unified diff of one changed file between main and the branch, with line numbers.",
        inputSchema: z.object({ path: z.string().describe("Repository-relative path") }),
        execute: ({ path }) =>
          answer(async () => {
            const [before, after] = await withRepository((repo) =>
              Promise.all([
                readFile(repo, path, state.baseCommit),
                readFile(repo, path, state.headCommit),
              ]),
            );
            if (before === null && after === null) return `No file '${path}'`;
            if (before === after) return `'${path}' did not change on the branch`;
            return createTwoFilesPatch(
              `main/${path}`,
              `branch/${path}`,
              before ?? "",
              after ?? "",
            );
          }),
      }),
    },
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  if (result.finishReason === "content-filter") {
    log.warn("reviewer refusal", { branchId: state.branch.id });
    throw new Error("The model declined this request");
  }
  if (result.finishReason === "tool-calls") {
    throw new Error("The reviewer read the repository for too long without answering");
  }
  log.info("reviewer completion", {
    branchId: state.branch.id,
    finishReason: result.finishReason,
    chars: result.text.length,
  });
  return result.text;
}

/** The branch as the reviewer starts from it: its changed files and the builder's notes. */
export function describeBranch(state: BranchState): string {
  const changes = state.changes.map((change) => `- ${change.status}: ${change.path}`);
  const brackets = state.review.brackets.map(
    (bracket, i) =>
      `${i + 1}. [${bracket.kind}] ${bracket.title}: ${bracket.description}\n${bracket.ranges
        .map(
          (range) =>
            `   - ${range.path}:${range.start}-${range.end}${range.note ? ` (${range.note})` : ""}`,
        )
        .join("\n")}`,
  );
  const commits = state.commits
    .filter((commit) => !commit.merge)
    .map((commit) =>
      renderTemplate(commitTemplate, {
        title: commit.title,
        hash: commit.hash.slice(0, 10),
        request: clip(commit.request),
        reasoning: clip(commit.reasoning),
      }).trim(),
    );
  return renderTemplate(branchTemplate, {
    name: state.branch.name,
    baseCommit: state.baseCommit.slice(0, 10),
    headCommit: state.headCommit.slice(0, 10),
    changes: changes.join("\n") || NONE,
    summary: state.review.summary || NONE,
    brackets: brackets.join("\n") || NONE,
    commits: commits.join("\n\n") || NONE,
  }).trim();
}

function clip(text: string): string {
  if (!text) return NONE;
  return text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)}…` : text;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

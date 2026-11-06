import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import { modelReply, type ModelMessage } from "@backend/arch-planner/model";
import { answer, repositoryTools } from "@backend/arch-planner/tools";
import { readFile } from "@backend/arch-repository/service";
import type { ReviewMessage } from "@shared/contract/arch/review";
import { reviewEnv } from "./env";
import type { BranchState } from "./service";

/** A commit's request or reasoning is cut past this in the prompt. */
const MAX_NOTE_CHARS = 4_000;

const REVIEWER_ROLE = `You are the reviewer's assistant in Matron, a self-releasing household organizer. Its owner is reading the code of a branch before merging it into main, and asks you about it. The branch was written by Matron's builder, a coding agent, from a household member's request; every commit it made records the request it worked on and the reasoning behind its decisions, and the newest one carries its summary of the branch and its brackets (the groups of changed lines it suggests reading together).

You are talking to the owner, an engineer. Be direct and concrete: name files, functions and lines, and quote code when it helps. Use markdown. Answer what was asked; when the code does not settle a question, say so rather than guess.

You can read the code with tools: list_files, read_file and search_files see the branch as it is now, read_main_file sees the file on main as the branch started from, and file_diff shows one file's change. The builder's notes below say why it did things; the code says what it did. When they disagree, trust the code and point out the difference.`;

/** The reviewer's next answer: the branch's state and notes in the system prompt, the conversation after it. */
export async function askReviewer(
  state: BranchState,
  conversation: ReviewMessage[],
): Promise<string> {
  const messages: ModelMessage[] = [
    { role: "system", content: REVIEWER_ROLE },
    { role: "system", content: describeBranch(state) },
    ...conversation.map((message) => ({ role: message.role, content: message.text })),
  ];
  return modelReply(
    messages,
    {
      agent: "reviewer",
      host: hostOf(reviewEnv().APP_ORIGIN),
      branch: state.branch.id,
      sessionId: state.branch.buildSessionId,
    },
    undefined,
    (repo) => [
      ...repositoryTools(repo, state.headCommit),
      betaZodTool({
        name: "read_main_file",
        description:
          "Reads one file as it is on main at the commit the branch is compared with, before the branch changed it.",
        inputSchema: z.object({ path: z.string().describe("Repository-relative path") }),
        run: ({ path }) =>
          answer(
            async () =>
              (await readFile(repo, path, state.baseCommit)) ??
              `No file '${path}' on main`,
          ),
      }),
      betaZodTool({
        name: "file_diff",
        description:
          "The unified diff of one changed file between main and the branch, with line numbers.",
        inputSchema: z.object({ path: z.string().describe("Repository-relative path") }),
        run: ({ path }) =>
          answer(async () => {
            const [before, after] = await Promise.all([
              readFile(repo, path, state.baseCommit),
              readFile(repo, path, state.headCommit),
            ]);
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
    ],
  );
}

/** The branch as the reviewer starts from it: its changed files and the builder's notes. */
export function describeBranch(state: BranchState): string {
  const parts = [
    `## The branch under review: ${state.branch.name}`,
    `Compared with main at ${state.baseCommit.slice(0, 10)}; the branch is at ${state.headCommit.slice(0, 10)}.`,
    `### Changed files\n${state.changes.map((change) => `- ${change.status}: ${change.path}`).join("\n") || "(none)"}`,
  ];
  if (state.review.summary)
    parts.push(`### The builder's summary\n${state.review.summary}`);
  if (state.review.brackets.length) {
    parts.push(
      `### The builder's brackets\n${state.review.brackets
        .map(
          (bracket, i) =>
            `${i + 1}. [${bracket.kind}] ${bracket.title}: ${bracket.description}\n${bracket.ranges
              .map(
                (range) =>
                  `   - ${range.path}:${range.start}-${range.end}${range.note ? ` (${range.note})` : ""}`,
              )
              .join("\n")}`,
        )
        .join("\n")}`,
    );
  }
  const commits = state.commits.filter((commit) => !commit.merge);
  parts.push(
    `### The builder's commits, newest first\n${
      commits
        .map(
          (commit) =>
            `#### ${commit.title} (${commit.hash.slice(0, 10)})\nRequest:\n${clip(commit.request)}\n\nReasoning:\n${clip(commit.reasoning)}`,
        )
        .join("\n\n") || "(none recorded)"
    }`,
  );
  return parts.join("\n\n");
}

function clip(text: string): string {
  if (!text) return "(none)";
  return text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)}…` : text;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  listFiles,
  readFile,
  searchFiles,
  withRepository,
} from "@backend/arch-repository/service";
import { DomainError } from "@backend/commons/errors";
import { MAIN_BRANCH } from "@backend/commons/principal";

/**
 * How the planner looks at the code: the repository as it is at `ref` (main,
 * or a branch for the reviewer), read through the Artifacts binding. Every
 * tool answers with text the model reads.
 */
export function repositoryTools(ref: string = MAIN_BRANCH): ToolSet {
  const on = ref === MAIN_BRANCH ? "on main" : "on the branch under review";
  return {
    list_files: tool({
      description: `Lists the files in the repository (${on}) under a directory, recursively. Start at the root to see the layout.`,
      inputSchema: z.object({
        directory: z
          .string()
          .optional()
          .describe(
            "Repository-relative directory, such as 'frontend/tasks'; omit for the root",
          ),
      }),
      execute: ({ directory }) =>
        answer(async () => {
          const files = await withRepository((repo) =>
            listFiles(repo, directory ?? "", ref),
          );
          return files.length ? files.join("\n") : `No directory '${directory ?? ""}'`;
        }),
    }),
    read_file: tool({
      description: `Reads one file from the repository (${on}) and returns its text.`,
      inputSchema: z.object({
        path: z
          .string()
          .describe("Repository-relative path, such as 'SELF-RELEASING-GUIDE.md'"),
      }),
      execute: ({ path }) =>
        answer(
          async () =>
            (await withRepository((repo) => readFile(repo, path, ref))) ??
            `No file '${path}'`,
        ),
    }),
    search_files: tool({
      description: `Finds lines containing a text (case-insensitive) across the repository's files ${on}, as path:line: text. Use it to locate where something is implemented.`,
      inputSchema: z.object({
        query: z
          .string()
          .describe("The text to look for, such as a function or table name"),
        directory: z.string().optional().describe("Limit the search to this directory"),
      }),
      execute: ({ query, directory }) =>
        answer(async () => {
          const matches = await withRepository((repo) =>
            searchFiles(repo, query, directory ?? "", ref),
          );
          return matches.length ? matches.join("\n") : `Nothing contains '${query}'`;
        }),
    }),
  };
}

// A repository problem is an answer the model can act on, not a failed turn.
export async function answer(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError)
      return `The repository is not available: ${err.message}`;
    throw err;
  }
}

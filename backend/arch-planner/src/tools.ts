import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { listFiles, readFile, searchFiles } from "@backend/arch-repository/service";
import { DomainError } from "@backend/commons/errors";

/**
 * How the planner looks at the code: the repository as it is on main, read
 * through one Artifacts handle shared by every call of the turn. Every tool
 * answers with text the model reads.
 */
export function repositoryTools(repo: ArtifactsRepo) {
  return [
    betaZodTool({
      name: "list_files",
      description:
        "Lists the files in the repository (on main) under a directory, recursively. Start at the root to see the layout.",
      inputSchema: z.object({
        directory: z
          .string()
          .optional()
          .describe(
            "Repository-relative directory, such as 'frontend/todo-list'; omit for the root",
          ),
      }),
      run: ({ directory }) =>
        answer(async () => {
          const files = await listFiles(repo, directory ?? "");
          return files.length ? files.join("\n") : `No directory '${directory ?? ""}'`;
        }),
    }),
    betaZodTool({
      name: "read_file",
      description: "Reads one file from the repository (on main) and returns its text.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Repository-relative path, such as 'SELF-RELEASING-GUIDE.md'"),
      }),
      run: ({ path }) =>
        answer(async () => (await readFile(repo, path)) ?? `No file '${path}'`),
    }),
    betaZodTool({
      name: "search_files",
      description:
        "Finds lines containing a text (case-insensitive) across the repository's files on main, as path:line: text. Use it to locate where something is implemented.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The text to look for, such as a function or table name"),
        directory: z.string().optional().describe("Limit the search to this directory"),
      }),
      run: ({ query, directory }) =>
        answer(async () => {
          const matches = await searchFiles(repo, query, directory ?? "");
          return matches.length ? matches.join("\n") : `Nothing contains '${query}'`;
        }),
    }),
  ];
}

/** What a tool call looks like in the chat's progress line. */
export function describeToolCall(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, string | undefined>;
  switch (name) {
    case "list_files":
      return `planner: listing ${args.directory || "the repository"}`;
    case "read_file":
      return `planner: reading ${args.path ?? "a file"}`;
    case "search_files":
      return `planner: searching for "${args.query ?? ""}"`;
    default:
      return `planner: ${name}`;
  }
}

// A repository problem is an answer the model can act on, not a failed turn.
async function answer(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError)
      return `The repository is not available: ${err.message}`;
    throw err;
  }
}

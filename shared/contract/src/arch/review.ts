import { oc } from "@orpc/contract";
import { z } from "zod";
import { branchSchema } from "./branches";

/** What a bracket groups; the builder picks one per bracket. */
export const BRACKET_KINDS = [
  "flow",
  "schema",
  "refactor",
  "move",
  "tests",
  "config",
  "docs",
  "other",
] as const;
export type BracketKind = (typeof BRACKET_KINDS)[number];

/** Lines `start`..`end` of `path`, counted in the branch's version (the old one for a deleted file). */
export const bracketRangeSchema = z.object({
  path: z.string().min(1).max(1000),
  start: z.number().int().min(1),
  end: z.number().int().min(1),
  /** One short sentence shown above the lines; empty when the description says it. */
  note: z.string().max(500).default(""),
});
export type BracketRange = z.infer<typeof bracketRangeSchema>;

/** Line ranges a reviewer reads together, in the order they should be read. */
export const bracketSchema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(BRACKET_KINDS).catch("other"),
  description: z.string().max(5000).default(""),
  ranges: z.array(bracketRangeSchema).max(200),
});
export type Bracket = z.infer<typeof bracketSchema>;

/**
 * What the builder agent prepares for the owner's review of its branch: a
 * summary and the whole branch split into brackets. The branch's build
 * session keeps the one from the newest deploy.
 */
export const reviewReportSchema = z.object({
  summary: z.string().max(20_000).default(""),
  brackets: z.array(bracketSchema).max(50).default([]),
});
export type ReviewReport = z.infer<typeof reviewReportSchema>;

/** One of the branch's own commits, as the builder described it. */
export const reviewCommitSchema = z.object({
  hash: z.string(),
  title: z.string(),
  /** The user's request and the agent's reasoning, from the message body. */
  request: z.string(),
  reasoning: z.string(),
  /** A merge that took main in. */
  merge: z.boolean(),
  committedAt: z.number(),
});
export type ReviewCommit = z.infer<typeof reviewCommitSchema>;

export const FILE_STATUSES = ["added", "modified", "deleted"] as const;

/**
 * A changed file with both versions' text. `before` is null for an added
 * file, `after` for a deleted one; neither is sent for a binary or
 * too-large file, which `omitted` explains.
 */
export const reviewFileSchema = z.object({
  path: z.string(),
  status: z.enum(FILE_STATUSES),
  before: z.string().nullable(),
  after: z.string().nullable(),
  omitted: z.enum(["binary", "too-large", "generated"]).nullable(),
});
export type ReviewFile = z.infer<typeof reviewFileSchema>;

export const branchReviewSchema = z.object({
  branch: branchSchema,
  baseCommit: z.string(),
  headCommit: z.string(),
  /** What the builder prepared for the review with the newest deploy; empty before one did. */
  summary: z.string(),
  brackets: z.array(bracketSchema),
  /** Newest first. */
  commits: z.array(reviewCommitSchema),
  files: z.array(reviewFileSchema),
});
export type BranchReview = z.infer<typeof branchReviewSchema>;

export const reviewMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(20_000),
});
export type ReviewMessage = z.infer<typeof reviewMessageSchema>;

/** The owner's review of a live branch before merging it (`review` resource). */
export const reviewContract = {
  get: oc
    .route({ method: "GET", path: "/api/arch/branches/{id}/review" })
    .input(z.object({ id: z.string() }))
    .output(branchReviewSchema),
  // Stateless: the whole conversation comes in, the next answer goes out. Nothing is stored.
  ask: oc
    .route({ method: "POST", path: "/api/arch/branches/{id}/review/ask" })
    .input(
      z.object({
        id: z.string(),
        messages: z.array(reviewMessageSchema).min(1).max(40),
      }),
    )
    .output(z.object({ text: z.string() })),
};

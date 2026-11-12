import type {
  BracketKind,
  BracketRange,
  BranchReview,
} from "@shared/contract/arch/review";
import { changesIn, fileModel, markKey, type FileModel } from "./diff";

/** A bracket as the screen shows it: the builder's, or the one gathering what no bracket covers. */
export interface ShownBracket {
  title: string;
  kind: BracketKind | "unbracketed";
  description: string;
  ranges: BracketRange[];
  /** The viewed-mark keys of every change its ranges cover. */
  keys: string[];
}

export interface ReviewModel {
  files: Map<string, FileModel>;
  /** Changed paths, in tree order. */
  paths: string[];
  brackets: ShownBracket[];
  /** Every change's viewed-mark key. */
  keys: string[];
}

/** Changes in the same file this close together share one range of the unbracketed group. */
const NEARBY_LINES = 6;

export function reviewModel(review: BranchReview): ReviewModel {
  const files = new Map(review.files.map((file) => [file.path, fileModel(file)]));
  const keysOf = (range: BracketRange) => {
    const model = files.get(range.path);
    if (!model) return [];
    return changesIn(model, range.start, range.end).map((c) => markKey(range.path, c));
  };
  const brackets: ShownBracket[] = review.brackets.map((bracket) => ({
    ...bracket,
    keys: unique(bracket.ranges.flatMap(keysOf)),
  }));
  const covered = new Set(brackets.flatMap((bracket) => bracket.keys));
  const leftOver: BracketRange[] = [];
  for (const [path, model] of files) {
    const open = model.changes.filter((change) => !covered.has(markKey(path, change)));
    let range: BracketRange | null = null;
    for (const change of open) {
      if (range && change.at - range.end <= NEARBY_LINES) {
        range.end = Math.max(range.end, change.at);
        continue;
      }
      range = { path, start: change.at, end: change.at, note: "" };
      leftOver.push(range);
    }
  }
  if (leftOver.length) {
    brackets.push({
      title: brackets.length ? "Not in a bracket" : "Every change",
      kind: "unbracketed",
      description: brackets.length
        ? "Changes the builder did not put in any bracket."
        : "The builder left no brackets for this branch, so every change is listed here, file by file.",
      ranges: leftOver,
      keys: unique(leftOver.flatMap(keysOf)),
    });
  }
  const paths = treeOrder([...files.keys()]);
  return {
    files,
    paths,
    brackets,
    keys: paths.flatMap((path) =>
      files.get(path)!.changes.map((change) => markKey(path, change)),
    ),
  };
}

/** Paths sorted as a file tree lists them: a directory's files after its subdirectories. */
export function treeOrder(paths: string[]): string[] {
  const sortKey = (path: string) => {
    const parts = path.split("/");
    return parts
      .map((part, i) => (i < parts.length - 1 ? `0${part}` : `1${part}`))
      .join("/");
  };
  return [...paths].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

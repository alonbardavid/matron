import { diffLines as diffChanges } from "diff";
import type { ReviewFile } from "@shared/contract/arch/review";

export type DiffLine =
  | { kind: "same"; text: string; old: number; new: number }
  | { kind: "removed"; text: string; old: number }
  | { kind: "added"; text: string; new: number };

/**
 * One change a reviewer marks viewed: an added or removed line, or a removed
 * line and the added line that replaced it, counted once.
 */
export interface Change {
  /** Stable across rebuilds: made from the change's text and the unchanged line above it, never its line numbers. */
  key: string;
  /** Indexes into the file's lines. */
  lines: number[];
  /** The line a bracket range finds the change by (see `owners`). */
  at: number;
}

export interface FileModel {
  file: ReviewFile;
  lines: DiffLine[];
  changes: Change[];
  /** For each line, the change it belongs to, or -1. */
  changeOf: number[];
  /**
   * For each line, the line number a range counts it by: its own new number,
   * or for a removed line the next new line. A file left empty counts its old lines.
   */
  owners: number[];
  added: number;
  removed: number;
}

/** The key of the single change of a file with no lines to show (binary, too large, generated). */
export const WHOLE_FILE = "file";

// Past this many edits a file counts as wholly replaced, so a huge rewrite stays cheap.
const MAX_EDIT_LENGTH = 1000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const replaced = [
    { value: before, added: false, removed: true },
    { value: after, added: true, removed: false },
  ];
  const parts =
    before === "" || after === ""
      ? replaced
      : (diffChanges(before, after, { maxEditLength: MAX_EDIT_LENGTH }) ?? replaced);
  const lines: DiffLine[] = [];
  let old = 1;
  let next = 1;
  for (const part of parts) {
    for (const text of splitLines(part.value)) {
      if (part.added) lines.push({ kind: "added", text, new: next++ });
      else if (part.removed) lines.push({ kind: "removed", text, old: old++ });
      else lines.push({ kind: "same", text, old: old++, new: next++ });
    }
  }
  return lines;
}

export function fileModel(file: ReviewFile): FileModel {
  const lines = file.omitted ? [] : diffLines(file.before ?? "", file.after ?? "");
  const owners = lineOwners(lines);
  const changes: Change[] = [];
  const changeOf = lines.map(() => -1);
  const seen = new Map<string, number>();
  let above = "";
  let removed: number[] = [];
  let added: number[] = [];
  // A run of removed lines pairs with the added lines after it, one change per pair.
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const left = removed[i];
      const right = added[i];
      const base = hash(
        [
          left === undefined ? "" : `-${lines[left]!.text}`,
          right === undefined ? "" : `+${lines[right]!.text}`,
          above,
        ].join("\n"),
      );
      const repeat = seen.get(base) ?? 0;
      seen.set(base, repeat + 1);
      const indexes = [left, right].filter((x): x is number => x !== undefined);
      for (const index of indexes) changeOf[index] = changes.length;
      changes.push({
        key: repeat ? `${base}.${repeat}` : base,
        lines: indexes,
        at: owners[right ?? left!]!,
      });
    }
    removed = [];
    added = [];
  };
  lines.forEach((line, i) => {
    if (line.kind === "same") {
      flush();
      above = line.text;
    } else if (line.kind === "removed") {
      if (added.length) flush();
      removed.push(i);
    } else {
      added.push(i);
    }
  });
  flush();
  if (file.omitted) changes.push({ key: WHOLE_FILE, lines: [], at: 1 });
  return {
    file,
    lines,
    changes,
    changeOf,
    owners,
    added: lines.filter((line) => line.kind === "added").length,
    removed: lines.filter((line) => line.kind === "removed").length,
  };
}

function lineOwners(lines: DiffLine[]): number[] {
  if (!lines.some((line) => line.kind !== "removed")) {
    return lines.map((line) => (line.kind === "removed" ? line.old : 0));
  }
  let owner = 0;
  for (const line of lines) if (line.kind !== "removed") owner = line.new;
  const owners: number[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.kind !== "removed") owner = line.new;
    owners[i] = owner;
  }
  return owners;
}

/** The viewed-mark key of one change of a file. */
export function markKey(path: string, change: Change): string {
  return `${path}\n${change.key}`;
}

/** The changes of `model` that a range of lines covers. */
export function changesIn(model: FileModel, start: number, end: number): Change[] {
  if (model.file.omitted) return model.changes;
  return model.changes.filter((change) => change.at >= start && change.at <= end);
}

// cyrb53: a fast 53-bit string hash, short enough to keep one per change.
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

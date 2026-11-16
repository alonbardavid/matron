import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

/**
 * The languages Matron's own code is written in, and a few a chat may quote.
 * Anything else is shown as plain text.
 */
const lowlight = createLowlight({
  bash,
  css,
  diff,
  dockerfile,
  ini,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
  xml,
  yaml,
});
lowlight.registerAlias({
  bash: ["sh", "shell", "zsh", "console"],
  dockerfile: ["docker"],
  ini: ["toml"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  json: ["jsonc", "json5"],
  markdown: ["md"],
  python: ["py"],
  typescript: ["ts", "tsx", "mts", "cts"],
  xml: ["html", "svg"],
  yaml: ["yml"],
});

/** A run of characters in one colour; `className` names its highlight.js scope. */
export interface Token {
  text: string;
  className?: string;
}

/** The language a fence or extension names, when it is one we colour. */
export function languageNamed(name: string | null | undefined): string | null {
  const key = name?.trim().toLowerCase();
  return key && lowlight.registered(key) ? key : null;
}

/** The language of a repository file, from its name. */
export function languageOfPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? languageNamed(name.slice(dot + 1)) : null;
}

/**
 * `text` as lines of coloured tokens. The whole text is highlighted at once,
 * so a comment or string that spans lines is coloured on every line it covers.
 * Lines split on "\n" and a final newline ends the last line, as the review's
 * diff splits them.
 */
export function highlightLines(text: string, language: string | null): Token[][] {
  const lines: Token[][] = [[]];
  const push = (value: string, className: string | undefined) => {
    value.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ text: part, className });
    });
  };
  const tree = language ? highlightTree(text, language) : null;
  if (tree) walk(tree.children, undefined, push);
  else push(text, undefined);
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

/** The parts of lowlight's tree read here. */
interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function highlightTree(text: string, language: string): { children: HastNode[] } | null {
  try {
    return lowlight.highlight(language, text) as unknown as { children: HastNode[] };
  } catch {
    // A grammar that gives up on odd input leaves the text plain rather than failing.
    return null;
  }
}

/** Each text node takes the classes of the innermost scope around it. */
function walk(
  nodes: readonly HastNode[],
  inherited: string | undefined,
  push: (value: string, className: string | undefined) => void,
): void {
  for (const node of nodes) {
    if (node.type === "text" && node.value) {
      push(node.value, inherited);
    } else if (node.type === "element" && node.children) {
      const own = node.properties?.className;
      const className = Array.isArray(own) && own.length ? own.join(" ") : inherited;
      walk(node.children, className, push);
    }
  }
}

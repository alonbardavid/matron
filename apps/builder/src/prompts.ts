import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PromptName = "system" | "build" | "fix" | "continue";

/**
 * Replaces `{{name}}` placeholders. Unknown placeholders are left in place so
 * a typo in a template is visible rather than silently blank.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name: string) => {
    const value = vars[name];
    return value === undefined ? whole : value;
  });
}

export function loadPrompt(dir: string, name: PromptName): string {
  return readFileSync(join(dir, `${name}.md`), "utf8");
}

export function promptPath(dir: string, name: PromptName): string {
  return join(dir, `${name}.md`);
}

/**
 * The structured output every agent turn must end with, as one line of JSON:
 * `outcome-schema.json` beside the prompts, `preparingReview` included.
 */
export function loadOutcomeSchema(dir: string): string {
  return JSON.stringify(
    JSON.parse(readFileSync(join(dir, "outcome-schema.json"), "utf8")),
  );
}

import type { Principal } from "@backend/commons/principal";
import databaseAdmin from "../prompts/database-admin.md?raw";
import databaseMember from "../prompts/database-member.md?raw";
import database from "../prompts/database.md?raw";
import system from "../prompts/system.md?raw";
import { databasePermissions } from "./permissions";

export interface AskPromptContext {
  principal: Principal;
  timeZone: string;
  now: Date;
}

/** The assistant's system prompt, from the templates under prompts/. */
export function askSystemPrompt({ principal, timeZone, now }: AskPromptContext): string {
  return renderTemplate(system, {
    userName: principal.name,
    userRole: principal.role,
    now: now.toISOString(),
    timeZone,
    database: `${database.trim()}\n\n${(databasePermissions.can(principal.role, "read_router") ? databaseAdmin : databaseMember).trim()}`,
  }).trim();
}

/**
 * Replaces `{{name}}` placeholders. Unknown placeholders are left in place so
 * a typo in a template is visible rather than silently blank.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? (vars[name] as string) : whole,
  );
}

import type { Principal } from "@backend/commons/principal";
import { renderTemplate } from "@backend/commons/template";
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

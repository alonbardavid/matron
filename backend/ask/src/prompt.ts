import type { Principal } from "@backend/commons/principal";
import { renderTemplate } from "@backend/commons/template";
import productGuide from "../../../docs/app-product-guide.md?raw";
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
    productGuide: productGuide.trim(),
    database: `${database.trim()}\n\n${(databasePermissions.can(principal.role, "read_router") ? databaseAdmin : databaseMember).trim()}`,
  }).trim();
}

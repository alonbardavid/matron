/**
 * Replaces `{{name}}` placeholders. Unknown placeholders are left in place so
 * a typo in a template is visible rather than silently blank.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? (vars[name] as string) : whole,
  );
}

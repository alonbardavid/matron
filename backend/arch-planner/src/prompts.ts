/** The planner's prompts, one system prompt per phase of the session, from the templates under prompts/. */
import { renderTemplate } from "@backend/commons/template";
import type { BuildPhase } from "@shared/contract/arch/sessions";
import { BUILDER_SAYS } from "@shared/contract/arch/sessions";
import appArchitecture from "../../../docs/app-architecture.md?raw";
import productGuide from "../../../docs/app-product-guide.md?raw";
import building from "../prompts/building.md?raw";
import closed from "../prompts/closed.md?raw";
import planning from "../prompts/planning.md?raw";
import role from "../prompts/role.md?raw";

/** The system prompt for a turn in the given phase: who the planner is, then what that phase asks of it. */
export function plannerSystemPrompt(phase: BuildPhase): string {
  return `${role.trim()}\n\n${phaseInstructions(phase).trim()}`;
}

function phaseInstructions(phase: BuildPhase): string {
  switch (phase) {
    case "planning":
      // The planner always needs both documents, so they are part of its prompt
      // and not something it is told to read.
      return renderTemplate(planning, {
        productGuide: productGuide.trim(),
        appArchitecture: appArchitecture.trim(),
      });
    case "closed":
      return closed;
    default:
      return renderTemplate(building, { builderSays: BUILDER_SAYS.trim() });
  }
}

/** Which of the planner's tools a turn in the given phase may call. */
export function plannerToolsFor(phase: BuildPhase): string[] {
  switch (phase) {
    case "planning":
      return ["list_files", "read_file", "search_files", "propose_plan", "start_build"];
    case "closed":
      return [];
    default:
      return ["tell_builder"];
  }
}

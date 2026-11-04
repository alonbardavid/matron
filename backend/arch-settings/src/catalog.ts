import { env } from "cloudflare:workers";
import { logger } from "@backend/commons/logger";
import { ANTHROPIC_MODELS, type ModelCatalog } from "@shared/contract/arch/settings";

const log = logger("arch-settings/catalog");

/** The bindings the catalog reads; apps/backend/src/env.d.ts is the full declaration. */
interface CatalogEnv {
  AI?: Ai;
}

const CACHE_MS = 10 * 60_000;
const TEXT_GENERATION = "Text Generation";
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

let cached: { at: number; catalog: ModelCatalog } | null = null;

/**
 * What the settings page offers for the assistant: Anthropic's models through
 * the gateway, and the Workers AI text models that can call tools, which the
 * assistant needs, grouped by the family that made them. Any other slug the
 * gateway serves may still be typed in.
 */
export async function listModelCatalog(): Promise<ModelCatalog> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.catalog;
  const anthropic = ANTHROPIC_MODELS.map((id) => entry(`anthropic/${id}`));
  const catalog = [
    ...anthropic,
    ...(await workersAiModels(env as unknown as CatalogEnv)),
  ];
  catalog.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  cached = { at: Date.now(), catalog };
  return catalog;
}

/** A catalog entry for a slug: the slug itself, under its family. */
function entry(id: string): ModelCatalog[number] {
  return { id, name: id, group: familyOf(id) };
}

/**
 * The family a slug belongs to: the segment before the model's own name,
 * `meta` for `@cf/meta/llama-...` and `anthropic` for `anthropic/claude-...`.
 */
export function familyOf(id: string): string {
  const parts = id.replace(/^@cf\//, "").split("/");
  return parts.length > 1 ? parts[0]! : "other";
}

/** Workers AI's text-generation models with tool calling, by the name the gateway resolves. */
async function workersAiModels(bindings: CatalogEnv): Promise<ModelCatalog> {
  if (!bindings.AI) return [];
  const models: ModelCatalog = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await bindings.AI.models({
        task: TEXT_GENERATION,
        hide_experimental: true,
        per_page: PAGE_SIZE,
        page,
      });
      for (const model of batch) {
        if (model.task?.name && model.task.name !== TEXT_GENERATION) continue;
        if (!callsTools(model.properties)) continue;
        models.push(entry(model.name));
      }
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (err) {
    log.warn("workers ai listing failed", { err });
  }
  return models;
}

function callsTools(properties: { property_id: string; value: string }[] | undefined) {
  return (properties ?? []).some(
    (p) => p.property_id === "function_calling" && p.value === "true",
  );
}

import type { Recipe, Resource } from "../types";

export interface RecipeDifference { label: string; left: string; right: string; different: boolean }
export function compareRecipes(left: Recipe, right: Recipe, resources: Resource[] = []): RecipeDifference[] {
  const display = (value: unknown) => value == null || value === "" ? "Not set" : String(value);
  function reference(id: string | undefined, name: string | undefined) {
    const resource = resources.find((item) => item.id === id);
    const path = resource?.path.replace(/\\/g, "/").split("/models/").pop();
    return path ? `${name || resource?.name || "Model"}\n${path}` : name || id;
  }
  const loras = (recipe: Recipe) => [...recipe.loras].sort((a, b) => a.order - b.order)
    .map((item) => `${reference(item.resourceId, item.name)} · model ${item.modelStrength} · CLIP ${item.clipStrength}${item.enabledTriggerWords.length ? ` · ${item.enabledTriggerWords.join(", ")}` : ""}`).join("\n") || "None";
  const fields: [string, unknown, unknown][] = [
    ["Positive prompt", left.positivePrompt, right.positivePrompt],
    ["Negative prompt", left.negativePrompt, right.negativePrompt],
    ["Base model", reference(left.modelId, left.modelName), reference(right.modelId, right.modelName)],
    ["Ordered LoRAs", loras(left), loras(right)],
    ["Width", left.params.width, right.params.width], ["Height", left.params.height, right.params.height],
    ["Sampler", left.params.sampler, right.params.sampler], ["Scheduler", left.params.scheduler, right.params.scheduler],
    ["Steps", left.params.steps, right.params.steps], ["CFG", left.params.cfg, right.params.cfg],
    ["Seed", left.params.seed, right.params.seed], ["Modality", left.modality, right.modality],
    ["Notes", left.notes, right.notes],
  ];
  return fields.map(([label, a, b]) => ({ label, left: display(a), right: display(b), different: display(a) !== display(b) }));
}

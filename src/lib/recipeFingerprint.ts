import type { RecipeInput, Resource } from "../types";
import { recipeExportDeferred } from "./comfyuiImport";

// Compare generation content, not titles, covers, tags, or import notes. Keep
// subfolders and prompt whitespace: collapsing them could hide distinct recipes.
export function recipeFingerprint(recipe: RecipeInput, resources: Resource[]): string {
  function reference(id: string | undefined, name: string | undefined) {
    const resource = resources.find((item) => item.id === id);
    return (resource?.path || (id?.startsWith("import:") ? id.slice(7) : name) || id || "")
      .trim().replace(/\\/g, "/");
  }
  const prompt = (text: string) => text.replace(/\r\n?/g, "\n").trim();
  return JSON.stringify({
    modality: recipe.modality,
    kind: recipeExportDeferred(recipe, resources) ? "diffusion_model" : "checkpoint",
    model: reference(recipe.modelId, recipe.modelName),
    positive: prompt(recipe.positivePrompt),
    negative: prompt(recipe.negativePrompt),
    loras: [...recipe.loras].sort((a, b) => a.order - b.order).map((lora) => [
      reference(lora.resourceId, lora.name), lora.modelStrength, lora.clipStrength,
      lora.enabledTriggerWords,
    ]),
    // Explicit keys make the comparison independent of JSON property order.
    params: [recipe.params.width, recipe.params.height, recipe.params.sampler,
      recipe.params.scheduler, recipe.params.steps, recipe.params.cfg,
      recipe.params.seed?.trim() || null],
  });
}

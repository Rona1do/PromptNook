import { describe, expect, it } from "vitest";
import type { RecipeInput, Resource } from "../types";
import { importRecipeFromText, toRecipeInput } from "./comfyuiImport";
import { recipeFingerprint } from "./recipeFingerprint";

const input = () => toRecipeInput(importRecipeFromText(
  "a quiet garden\nNegative prompt: blurry\nSteps: 24, Sampler: Euler, CFG scale: 7, Seed: 42, Size: 512x768, Model: garden.safetensors",
), []);
const key = (recipe: RecipeInput) => recipeFingerprint(recipe, []);

describe("generation duplicate detection", () => {
  it("ignores titles, annotations, covers and parameter key order", () => {
    const first = input();
    const second = { ...input(), title: "Renamed", notes: "Personal note", favorite: true,
      assets: [{ id: "cover", name: "different.png", mimeType: "image/png", url: "data:" }],
      params: { seed: "42", cfg: 7, height: 768, width: 512, steps: 24, sampler: "euler", scheduler: "normal" },
    };
    expect(key(second)).toBe(key(first));
  });

  it("keeps differences in seed, negative prompt, dimensions and sampler", () => {
    const first = input();
    for (const second of [
      { ...first, params: { ...first.params, seed: "43" } },
      { ...first, negativePrompt: "blurry, text" },
      { ...first, params: { ...first.params, width: 768 } },
      { ...first, params: { ...first.params, sampler: "dpmpp_2m" } },
      { ...first, positivePrompt: "a  quiet garden" },
    ]) expect(key(second)).not.toBe(key(first));
  });

  it("keeps ordered LoRAs and different model or CLIP strengths distinct", () => {
    const first = input();
    first.loras = ["a", "b"].map((name, order) => ({
      resourceId: `import:${name}.safetensors`, name, modelStrength: 0.8,
      clipStrength: 1, order, triggerWords: [], enabledTriggerWords: [],
    }));
    const reversed = { ...first, loras: first.loras.map((lora) => ({ ...lora, order: 1 - lora.order })) };
    expect(key(reversed)).not.toBe(key(first));
    expect(key({ ...first, loras: first.loras.map((lora) => ({ ...lora, modelStrength: 0.5 })) })).not.toBe(key(first));
    expect(key({ ...first, loras: first.loras.map((lora) => ({ ...lora, clipStrength: 0.5 })) })).not.toBe(key(first));
  });

  it("resolves catalog aliases while preserving model subfolders and model type", () => {
    const resources: Resource[] = [{ id: "model", name: "Garden", path: "style/garden.safetensors",
      resourceType: "checkpoint", available: true, triggerWords: [], confirmedTriggerWords: [] }];
    const imported = { ...input(), modelName: "style\\garden.safetensors" };
    const catalog = { ...input(), modelId: "model", modelName: "Garden" };
    expect(recipeFingerprint(imported, resources)).toBe(recipeFingerprint(catalog, resources));
    expect(recipeFingerprint({ ...imported, modelName: "other/garden.safetensors" }, resources))
      .not.toBe(recipeFingerprint(catalog, resources));
    expect(recipeFingerprint(catalog, [{ ...resources[0], resourceType: "diffusion_model" }]))
      .not.toBe(recipeFingerprint(catalog, resources));
  });
});

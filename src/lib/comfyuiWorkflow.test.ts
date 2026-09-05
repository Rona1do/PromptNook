import { describe, expect, it } from "vitest";
import type { AppSettings, Recipe, Resource } from "../types";
import { buildBrowserComfyWorkflow } from "./comfyuiWorkflow";

const settings: AppSettings = {
  privacyMode: false,
  loraPath: "C:\\ComfyUI\\models\\loras",
  checkpointPath: "C:\\ComfyUI\\models\\checkpoints",
  diffusionModelPath: "C:\\ComfyUI\\models\\diffusion_models",
  backupPath: "",
  translationProvider: "off",
  translationEndpoint: "",
  translationModel: "",
  onlineTranslationEnabled: false,
  translationTargetLanguage: "en",
  promptModels: [{ id: "general", name: "General", description: "" }],
  activePromptModel: "general",
  defaultPrefix: "",
  defaultNegative: "",
};

const resources: Resource[] = [
  {
    id: "checkpoint-1",
    name: "DreamShaper XL",
    resourceType: "checkpoint",
    path: "C:\\ComfyUI\\models\\checkpoints\\sdxl\\dreamshaper.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
  },
  {
    id: "lora-1",
    name: "Film Still",
    resourceType: "lora",
    path: "C:\\ComfyUI\\models\\loras\\style\\film.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
  },
];

const recipe: Recipe = {
  id: "recipe-1",
  title: "Cinematic Portrait",
  status: "reproducible",
  modality: "text_to_image",
  positivePrompt: "cinematic portrait",
  positiveTranslation: "",
  negativePrompt: "blurry",
  negativeTranslation: "",
  modelId: "checkpoint-1",
  modelName: "DreamShaper XL",
  loras: [
    {
      resourceId: "lora-1",
      name: "Film Still",
      modelStrength: 0.8,
      clipStrength: 1,
      order: 0,
      triggerWords: [],
      enabledTriggerWords: [],
    },
  ],
  params: {
    width: 1024,
    height: 768,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    steps: 24,
    cfg: 5.5,
    seed: "42",
  },
  assets: [],
  tagIds: [],
  notes: "",
  favorite: false,
  rating: 0,
  usageCount: 0,
  promptModel: "general",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("browser ComfyUI workflow export", () => {
  it("builds the same editable core graph as the desktop exporter", () => {
    const result = buildBrowserComfyWorkflow(recipe, resources, settings);
    const nodes = result.workflow.nodes as Array<Record<string, unknown>>;

    expect(result.fileName).toBe("cinematic-portrait.comfyui.json");
    expect(result.warnings).toEqual([]);
    expect(result.workflow.version).toBe(0.4);
    expect(nodes).toHaveLength(8);
    expect(nodes[0].widgets_values).toEqual([
      "sdxl/dreamshaper.safetensors",
    ]);
    expect(nodes[1].widgets_values).toEqual([
      "style/film.safetensors",
      0.8,
      1,
    ]);
    expect(nodes[5].widgets_values).toEqual([
      42,
      "fixed",
      24,
      5.5,
      "dpmpp_2m",
      "karras",
      1,
    ]);
  });

  it("rejects diffusion-model recipes instead of emitting a broken graph", () => {
    expect(() =>
      buildBrowserComfyWorkflow(
        { ...recipe, modelId: "flux" },
        [
          ...resources,
          {
            ...resources[0],
            id: "flux",
            resourceType: "diffusion_model",
          },
        ],
        settings,
      ),
    ).toThrow("supports checkpoint workflows only");
  });
});

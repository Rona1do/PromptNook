import { describe, expect, it } from "vitest";
import type { AppSettings, Recipe, Resource } from "../types";
import { buildBrowserComfyWorkflow } from "./comfyuiWorkflow";
import {
  DIFFUSION_EXPORT_ERROR,
  DIFFUSION_IMPORT_MARKER,
  importRecipeFromPngBytes,
  importRecipeFromText,
  toRecipeInput,
} from "./comfyuiImport";

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
    triggerWords: ["film grain"],
    confirmedTriggerWords: ["film grain"],
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

function pngWithText(keyword: string, text: string): Uint8Array {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 1);
  new DataView(ihdr.buffer).setUint32(4, 1);
  ihdr[8] = 8;
  const payload = new Uint8Array(keyword.length + 1 + text.length);
  payload.set(new TextEncoder().encode(keyword), 0);
  payload.set(new TextEncoder().encode(text), keyword.length + 1);
  const parts = [signature, chunk("IHDR", ihdr), chunk("tEXt", payload), chunk("IEND", new Uint8Array())];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  return out;
}

describe("ComfyUI recipe import", () => {
  it("round-trips an exported checkpoint workflow back into a recipe", () => {
    const exported = buildBrowserComfyWorkflow(recipe, resources, settings);
    const imported = importRecipeFromText(
      JSON.stringify(exported.workflow),
      "portrait.json",
    );

    expect(imported.positivePrompt).toBe("cinematic portrait");
    expect(imported.negativePrompt).toBe("blurry");
    expect(imported.checkpointName).toBe("sdxl/dreamshaper.safetensors");
    expect(imported.checkpointKind).toBe("checkpoint");
    expect(imported.loras).toEqual([
      { name: "style/film.safetensors", modelStrength: 0.8, clipStrength: 1 },
    ]);
    expect(imported.params).toMatchObject({
      width: 1024,
      height: 768,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      steps: 24,
      cfg: 5.5,
      seed: "42",
    });

    const input = toRecipeInput(imported, resources);
    expect(input.modelId).toBe("checkpoint-1");
    expect(input.modelName).toBe("DreamShaper XL");
    expect(input.loras[0]).toMatchObject({
      resourceId: "lora-1",
      name: "Film Still",
      modelStrength: 0.8,
    });
    expect(input.notes).not.toContain(DIFFUSION_IMPORT_MARKER);
  });

  it("reads an API prompt and an A1111 parameters block", () => {
    const apiPrompt = {
      "4": {
        class_type: "CheckpointLoaderSimple",
        inputs: { ckpt_name: "dreamshaper.safetensors" },
      },
      "6": {
        class_type: "CLIPTextEncode",
        inputs: { text: "neon street", clip: ["4", 1] },
        _meta: { title: "Positive" },
      },
      "7": {
        class_type: "CLIPTextEncode",
        inputs: { text: "daylight", clip: ["4", 1] },
        _meta: { title: "Negative" },
      },
      "5": {
        class_type: "EmptyLatentImage",
        inputs: { width: 1024, height: 1024, batch_size: 1 },
      },
      "3": {
        class_type: "KSampler",
        inputs: {
          seed: 9,
          steps: 8,
          cfg: 2,
          sampler_name: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
      },
    };
    const fromApi = importRecipeFromText(JSON.stringify(apiPrompt));
    expect(fromApi.positivePrompt).toBe("neon street");
    expect(fromApi.negativePrompt).toBe("daylight");
    expect(fromApi.params.steps).toBe(8);
    expect(fromApi.params.seed).toBe("9");

    const fromA1111 = importRecipeFromText(
      "cinematic portrait, <lora:film:0.8>\nNegative prompt: blurry\nSteps: 24, Sampler: DPM++ 2M Karras, CFG scale: 5.5, Seed: 42, Size: 1024x768, Model hash: abcd, Model: dreamshaper.safetensors",
      "parameters.txt",
    );
    expect(fromA1111.positivePrompt).toBe("cinematic portrait");
    expect(fromA1111.negativePrompt).toBe("blurry");
    expect(fromA1111.checkpointName).toBe("dreamshaper.safetensors");
    expect(fromA1111.loras).toEqual([
      { name: "film", modelStrength: 0.8, clipStrength: 0.8 },
    ]);
    expect(fromA1111.params).toMatchObject({
      width: 1024,
      height: 768,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      steps: 24,
      cfg: 5.5,
      seed: "42",
    });
  });

  it("keeps a FLUX graph and blocks checkpoint export", () => {
    const workflow = {
      nodes: [
        {
          id: 1,
          type: "UNETLoader",
          widgets_values: ["flux1-dev-fp8.safetensors", "fp8"],
          inputs: [],
        },
        {
          id: 2,
          type: "CLIPTextEncodeFlux",
          widgets_values: ["", "a rainy street", 3.5],
          inputs: [],
        },
        {
          id: 3,
          type: "RandomNoise",
          widgets_values: [7, "fixed"],
          inputs: [],
        },
        {
          id: 4,
          type: "BasicScheduler",
          widgets_values: ["simple", 28, 1],
          inputs: [],
        },
        {
          id: 5,
          type: "KSamplerSelect",
          widgets_values: ["euler"],
          inputs: [],
        },
        {
          id: 6,
          type: "FluxGuidance",
          widgets_values: [3.5],
          inputs: [{ name: "conditioning", link: 1 }],
        },
        {
          id: 7,
          type: "BasicGuider",
          inputs: [
            { name: "model", link: 2 },
            { name: "conditioning", link: 3 },
          ],
        },
        {
          id: 8,
          type: "EmptySD3LatentImage",
          widgets_values: [1024, 1365, 1],
          inputs: [],
        },
        {
          id: 9,
          type: "SamplerCustomAdvanced",
          inputs: [
            { name: "noise", link: 4 },
            { name: "guider", link: 5 },
            { name: "sampler", link: 6 },
            { name: "sigmas", link: 7 },
            { name: "latent_image", link: 8 },
          ],
        },
        {
          id: 10,
          type: "SaveImage",
          inputs: [{ name: "images", link: 9 }],
        },
      ],
      links: [
        [1, 2, 0, 6, 0, "CONDITIONING"],
        [2, 1, 0, 7, 0, "MODEL"],
        [3, 6, 0, 7, 1, "CONDITIONING"],
        [4, 3, 0, 9, 0, "NOISE"],
        [5, 7, 0, 9, 1, "GUIDER"],
        [6, 5, 0, 9, 2, "SAMPLER"],
        [7, 4, 0, 9, 3, "SIGMAS"],
        [8, 8, 0, 9, 4, "LATENT"],
        [9, 9, 0, 10, 0, "IMAGE"],
      ],
    };

    const imported = importRecipeFromText(JSON.stringify(workflow), "flux.json");
    expect(imported.positivePrompt).toBe("a rainy street");
    expect(imported.checkpointKind).toBe("diffusion_model");
    expect(imported.checkpointName).toBe("flux1-dev-fp8.safetensors");
    expect(imported.params).toMatchObject({
      width: 1024,
      height: 1365,
      sampler: "euler",
      scheduler: "simple",
      steps: 28,
      cfg: 3.5,
      seed: "7",
    });
    expect(imported.notes).toContain(DIFFUSION_IMPORT_MARKER);

    const input = toRecipeInput(imported, resources);
    expect(() => buildBrowserComfyWorkflow({ ...recipe, ...input, id: "imported" }, resources, settings)).toThrow(
      DIFFUSION_EXPORT_ERROR,
    );
  });

  it("reads workflow metadata embedded in a PNG", async () => {
    const exported = buildBrowserComfyWorkflow(recipe, resources, settings);
    const bytes = pngWithText("workflow", JSON.stringify(exported.workflow));
    const imported = await importRecipeFromPngBytes(bytes, "ComfyUI_00001.png");
    expect(imported.positivePrompt).toBe("cinematic portrait");
    expect(imported.title).toBe("");
  });

  it("rejects a file that has no generation data", () => {
    expect(() => importRecipeFromText("{\"hello\":true}")).toThrow(/no ComfyUI nodes/i);
  });
});

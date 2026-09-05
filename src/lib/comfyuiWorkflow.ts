import type { AppSettings, Recipe, Resource } from "../types";

export interface BrowserComfyWorkflow {
  workflow: Record<string, unknown>;
  warnings: string[];
  fileName: string;
}

interface WorkflowLink {
  id: number;
  fromNode: number;
  fromSlot: number;
  toNode: number;
  toSlot: number;
  dataType: string;
}

const nodeProperties = (nodeType: string) => ({
  "Node name for S&R": nodeType,
  cnr_id: "comfy-core",
});

function safeFileStem(title: string, fallback: string): string {
  const value = title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return value || `recipe-${fallback.slice(0, 12)}`;
}

function pathReference(
  resource: Resource,
  root: string,
  label: string,
  warnings: string[],
): string {
  if (!resource.available) {
    warnings.push(
      `${label} ${resource.name} is currently offline; the saved reference was exported`,
    );
  }

  const path = resource.path.replace(/\\/g, "/");
  const normalizedRoot = root.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedRoot) {
    const prefix = `${normalizedRoot}/`;
    if (path.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
      return path.slice(prefix.length);
    }
    warnings.push(
      `${label} ${resource.name} is outside the configured model directory; only its filename was exported`,
    );
  }
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || resource.name;
}

function samplerWidgets(recipe: Recipe): unknown[] {
  const rawSeed = (recipe.params.seed ?? "").trim();
  const parsedSeed = /^\d+$/.test(rawSeed) ? Number(rawSeed) : Number.NaN;
  const fixed =
    Number.isSafeInteger(parsedSeed) && parsedSeed <= 1_125_899_906_842_624;
  return [
    fixed ? parsedSeed : 0,
    fixed ? "fixed" : "randomize",
    recipe.params.steps ?? 20,
    recipe.params.cfg ?? 7,
    recipe.params.sampler ?? "euler",
    recipe.params.scheduler ?? "normal",
    1,
  ];
}

export function buildBrowserComfyWorkflow(
  recipe: Recipe,
  resources: Resource[],
  settings: AppSettings,
): BrowserComfyWorkflow {
  if (recipe.modality !== "text_to_image") {
    throw new Error("ComfyUI export currently supports text-to-image recipes only");
  }
  if (!recipe.positivePrompt.trim()) {
    throw new Error("Add a positive prompt before exporting to ComfyUI");
  }

  const warnings: string[] = [];
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const checkpoint = recipe.modelId
    ? resourcesById.get(recipe.modelId)
    : undefined;
  let checkpointName = recipe.modelName?.trim() || "";

  if (checkpoint) {
    if (checkpoint.resourceType === "diffusion_model") {
      throw new Error(
        "This recipe uses a diffusion-model resource. The first exporter supports checkpoint workflows only; a FLUX template will be added separately.",
      );
    }
    if (checkpoint.resourceType !== "checkpoint") {
      throw new Error("The selected recipe model is not a checkpoint resource");
    }
    checkpointName = pathReference(
      checkpoint,
      settings.checkpointPath,
      "checkpoint",
      warnings,
    );
  } else if (checkpointName) {
    warnings.push(
      "The saved checkpoint is missing from the local catalog; its saved display name was exported",
    );
  } else {
    throw new Error("Select a checkpoint in the recipe before exporting to ComfyUI");
  }

  const loras = [...recipe.loras].sort((a, b) => a.order - b.order);
  const loraReferences = loras.map((lora) => {
    const resource = resourcesById.get(lora.resourceId);
    if (!resource) {
      warnings.push(
        `LoRA ${lora.name} is missing from the local catalog; its saved name was exported`,
      );
      return lora.name;
    }
    if (resource.resourceType !== "lora") {
      warnings.push(
        `${lora.name} is not catalogued as a LoRA; its display name was exported`,
      );
      return lora.name;
    }
    return pathReference(resource, settings.loraPath, "LoRA", warnings);
  });

  const positiveId = 2 + loras.length;
  const negativeId = positiveId + 1;
  const latentId = positiveId + 2;
  const samplerId = positiveId + 3;
  const vaeId = positiveId + 4;
  const saveId = positiveId + 5;
  const finalModelNode = loras.length === 0 ? 1 : 1 + loras.length;
  const links: WorkflowLink[] = [];

  const addLink = (
    fromNode: number,
    fromSlot: number,
    toNode: number,
    toSlot: number,
    dataType: string,
  ) => {
    links.push({
      id: links.length + 1,
      fromNode,
      fromSlot,
      toNode,
      toSlot,
      dataType,
    });
  };

  for (let index = 0; index < loras.length; index += 1) {
    addLink(1 + index, 0, 2 + index, 0, "MODEL");
    addLink(1 + index, 1, 2 + index, 1, "CLIP");
  }
  addLink(finalModelNode, 0, samplerId, 0, "MODEL");
  addLink(finalModelNode, 1, positiveId, 0, "CLIP");
  addLink(finalModelNode, 1, negativeId, 0, "CLIP");
  addLink(latentId, 0, samplerId, 3, "LATENT");
  addLink(positiveId, 0, samplerId, 1, "CONDITIONING");
  addLink(negativeId, 0, samplerId, 2, "CONDITIONING");
  addLink(samplerId, 0, vaeId, 0, "LATENT");
  addLink(1, 2, vaeId, 1, "VAE");
  addLink(vaeId, 0, saveId, 0, "IMAGE");

  const outputLinks = (node: number, slot: number) => {
    const ids = links
      .filter((link) => link.fromNode === node && link.fromSlot === slot)
      .map((link) => link.id);
    return ids.length ? ids : null;
  };
  const inputLink = (node: number, slot: number) =>
    links.find((link) => link.toNode === node && link.toSlot === slot)?.id ?? null;

  const nodes: Record<string, unknown>[] = [
    {
      id: 1,
      type: "CheckpointLoaderSimple",
      pos: [-520, 40],
      size: [315, 98],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [
        { name: "MODEL", type: "MODEL", links: outputLinks(1, 0), slot_index: 0 },
        { name: "CLIP", type: "CLIP", links: outputLinks(1, 1), slot_index: 1 },
        { name: "VAE", type: "VAE", links: outputLinks(1, 2), slot_index: 2 },
      ],
      properties: nodeProperties("CheckpointLoaderSimple"),
      widgets_values: [checkpointName],
    },
  ];

  loras.forEach((lora, index) => {
    const id = 2 + index;
    nodes.push({
      id,
      type: "LoraLoader",
      pos: [-160 + index * 350, 40],
      size: [315, 126],
      flags: {},
      order: 1 + index,
      mode: 0,
      inputs: [
        { name: "model", type: "MODEL", link: inputLink(id, 0) },
        { name: "clip", type: "CLIP", link: inputLink(id, 1) },
      ],
      outputs: [
        { name: "MODEL", type: "MODEL", links: outputLinks(id, 0), slot_index: 0, shape: 3 },
        { name: "CLIP", type: "CLIP", links: outputLinks(id, 1), slot_index: 1, shape: 3 },
      ],
      properties: nodeProperties("LoraLoader"),
      widgets_values: [
        loraReferences[index],
        lora.modelStrength,
        lora.clipStrength,
      ],
    });
  });

  const contentX = 240 + loras.length * 350;
  nodes.push(
    {
      id: positiveId,
      type: "CLIPTextEncode",
      pos: [contentX, -120],
      size: [430, 180],
      flags: {},
      order: 1 + loras.length,
      mode: 0,
      inputs: [{ name: "clip", type: "CLIP", link: inputLink(positiveId, 0) }],
      outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: outputLinks(positiveId, 0), slot_index: 0 }],
      title: "Positive Prompt",
      properties: nodeProperties("CLIPTextEncode"),
      widgets_values: [recipe.positivePrompt],
    },
    {
      id: negativeId,
      type: "CLIPTextEncode",
      pos: [contentX, 120],
      size: [430, 180],
      flags: {},
      order: 2 + loras.length,
      mode: 0,
      inputs: [{ name: "clip", type: "CLIP", link: inputLink(negativeId, 0) }],
      outputs: [{ name: "CONDITIONING", type: "CONDITIONING", links: outputLinks(negativeId, 0), slot_index: 0 }],
      title: "Negative Prompt",
      properties: nodeProperties("CLIPTextEncode"),
      widgets_values: [recipe.negativePrompt],
    },
    {
      id: latentId,
      type: "EmptyLatentImage",
      pos: [contentX, 380],
      size: [315, 106],
      flags: {},
      order: 3 + loras.length,
      mode: 0,
      inputs: [],
      outputs: [{ name: "LATENT", type: "LATENT", links: outputLinks(latentId, 0), slot_index: 0 }],
      properties: nodeProperties("EmptyLatentImage"),
      widgets_values: [recipe.params.width ?? 1024, recipe.params.height ?? 1024, 1],
    },
    {
      id: samplerId,
      type: "KSampler",
      pos: [contentX + 520, 40],
      size: [315, 262],
      flags: {},
      order: 4 + loras.length,
      mode: 0,
      inputs: [
        { name: "model", type: "MODEL", link: inputLink(samplerId, 0) },
        { name: "positive", type: "CONDITIONING", link: inputLink(samplerId, 1) },
        { name: "negative", type: "CONDITIONING", link: inputLink(samplerId, 2) },
        { name: "latent_image", type: "LATENT", link: inputLink(samplerId, 3) },
      ],
      outputs: [{ name: "LATENT", type: "LATENT", links: outputLinks(samplerId, 0), slot_index: 0 }],
      properties: nodeProperties("KSampler"),
      widgets_values: samplerWidgets(recipe),
    },
    {
      id: vaeId,
      type: "VAEDecode",
      pos: [contentX + 920, 80],
      size: [210, 46],
      flags: {},
      order: 5 + loras.length,
      mode: 0,
      inputs: [
        { name: "samples", type: "LATENT", link: inputLink(vaeId, 0) },
        { name: "vae", type: "VAE", link: inputLink(vaeId, 1) },
      ],
      outputs: [{ name: "IMAGE", type: "IMAGE", links: outputLinks(vaeId, 0), slot_index: 0 }],
      properties: nodeProperties("VAEDecode"),
      widgets_values: [],
    },
    {
      id: saveId,
      type: "SaveImage",
      pos: [contentX + 1220, 80],
      size: [315, 270],
      flags: {},
      order: 6 + loras.length,
      mode: 0,
      inputs: [{ name: "images", type: "IMAGE", link: inputLink(saveId, 0) }],
      outputs: [],
      properties: nodeProperties("SaveImage"),
      widgets_values: [`PromptNook/${safeFileStem(recipe.title, recipe.id)}`],
    },
  );

  const workflow = {
    last_node_id: saveId,
    last_link_id: links.length ? links[links.length - 1].id : 0,
    nodes,
    links: links.map((link) => [
      link.id,
      link.fromNode,
      link.fromSlot,
      link.toNode,
      link.toSlot,
      link.dataType,
    ]),
    groups: [],
    config: {},
    extra: {
      promptnook: {
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        exportedAt: new Date().toISOString(),
        format: "ComfyUI Workflow JSON 0.4",
      },
    },
    version: 0.4,
  };

  return {
    workflow,
    warnings,
    fileName: `${safeFileStem(recipe.title, recipe.id)}.comfyui.json`,
  };
}

export function downloadBrowserWorkflow(result: BrowserComfyWorkflow): void {
  const blob = new Blob([JSON.stringify(result.workflow, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

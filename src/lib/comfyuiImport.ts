import type {
  GenerationParams,
  Recipe,
  RecipeInput,
  RecipeLora,
  Resource,
  ResourceType,
  SourceWorkflow,
} from "../types";

/** Kept in sync with the desktop exporter in src-tauri/src/comfyui.rs. */
export const DIFFUSION_IMPORT_MARKER = "Imported from a diffusion-model graph";

export const DIFFUSION_IMPORT_NOTE =
  "Imported from a diffusion-model graph. Export the preserved original graph; generating a new graph from recipe edits still needs a FLUX template.";

export const DIFFUSION_EXPORT_ERROR =
  "This recipe uses a diffusion-model resource. The first exporter supports checkpoint workflows only; a FLUX template will be added separately.";

export class ComfyImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComfyImportError";
  }
}

export type CheckpointKind = "checkpoint" | "diffusion_model" | "unknown";

export interface ImportedLora {
  name: string;
  modelStrength: number;
  clipStrength: number;
}

export interface ImportedRecipeDraft {
  title: string;
  positivePrompt: string;
  negativePrompt: string;
  checkpointName: string;
  checkpointKind: CheckpointKind;
  loras: ImportedLora[];
  params: GenerationParams;
  notes: string;
  warnings: string[];
  sourceWorkflow?: SourceWorkflow;
}

interface NormalizedNode {
  id: string;
  type: string;
  title: string;
  values: Record<string, unknown>;
  links: Record<string, string>;
}

const EMPTY_PARAMS: GenerationParams = {
  width: null,
  height: null,
  sampler: null,
  scheduler: null,
  steps: null,
  cfg: null,
  seed: null,
};

const WIDGET_NAMES: Record<string, string[]> = {
  CheckpointLoaderSimple: ["ckpt_name"],
  CheckpointLoader: ["ckpt_name"],
  ImageOnlyCheckpointLoader: ["ckpt_name"],
  unCLIPCheckpointLoader: ["ckpt_name"],
  UNETLoader: ["unet_name", "weight_dtype"],
  UnetLoaderGGUF: ["unet_name"],
  UNETLoaderGGUF: ["unet_name"],
  DiffusionModelLoader: ["unet_name", "weight_dtype"],
  LoraLoader: ["lora_name", "strength_model", "strength_clip"],
  LoraLoaderModelOnly: ["lora_name", "strength_model"],
  CLIPTextEncode: ["text"],
  CLIPTextEncodeFlux: ["clip_l", "t5xxl", "guidance"],
  CLIPTextEncodeSDXL: [
    "width",
    "height",
    "crop_w",
    "crop_h",
    "target_width",
    "target_height",
    "text_g",
    "text_l",
  ],
  CLIPTextEncodeSDXLRefiner: ["width", "height", "ascore", "text"],
  EmptyLatentImage: ["width", "height", "batch_size"],
  EmptySD3LatentImage: ["width", "height", "batch_size"],
  FluxGuidance: ["guidance"],
  BasicScheduler: ["scheduler", "steps", "denoise"],
  KSamplerSelect: ["sampler_name"],
  RandomNoise: ["noise_seed"],
};

const CHECKPOINT_TYPES = new Set([
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "ImageOnlyCheckpointLoader",
  "unCLIPCheckpointLoader",
  "CheckpointLoaderSimpleWithNoiseSelect",
]);

const DIFFUSION_TYPES = new Set([
  "UNETLoader",
  "UnetLoaderGGUF",
  "UNETLoaderGGUF",
  "DiffusionModelLoader",
]);

const CONDITIONING_PASS = new Set([
  "FluxGuidance",
  "ConditioningAverage",
  "ConditioningCombine",
  "ConditioningConcat",
  "ConditioningSetArea",
  "ConditioningSetAreaPercentage",
  "ConditioningSetMask",
  "ConditioningSetTimestepRange",
  "ConditioningZeroOut",
]);

const IMAGE_OUTPUT_TYPES = new Set([
  "SaveImage",
  "PreviewImage",
  "SaveImageWebsocket",
  "VAEDecode",
]);

const SEED_CONTROLS = new Set([
  "fixed",
  "increment",
  "decrement",
  "randomize",
  "random",
]);

const A1111_SAMPLERS: Record<string, { sampler: string; scheduler: string }> = {
  euler: { sampler: "euler", scheduler: "normal" },
  "euler a": { sampler: "euler_ancestral", scheduler: "normal" },
  "dpm++ 2m": { sampler: "dpmpp_2m", scheduler: "karras" },
  "dpm++ 2m karras": { sampler: "dpmpp_2m", scheduler: "karras" },
  "dpm++ sde": { sampler: "dpmpp_sde", scheduler: "karras" },
  "dpm++ sde karras": { sampler: "dpmpp_sde", scheduler: "karras" },
  "dpm++ 2m sde": { sampler: "dpmpp_2m_sde", scheduler: "karras" },
  "dpm++ 2m sde karras": { sampler: "dpmpp_2m_sde", scheduler: "karras" },
  "dpm++ 3m sde": { sampler: "dpmpp_3m_sde", scheduler: "karras" },
  "dpm++ 3m sde karras": { sampler: "dpmpp_3m_sde", scheduler: "karras" },
  unipc: { sampler: "uni_pc", scheduler: "normal" },
  ddim: { sampler: "ddim", scheduler: "normal" },
};

export function recipeExportDeferred(
  recipe: Pick<Recipe, "notes" | "modelId">,
  resources: Resource[],
): boolean {
  if (recipe.notes.includes(DIFFUSION_IMPORT_MARKER)) return true;
  const model = resources.find((item) => item.id === recipe.modelId);
  return model?.resourceType === "diffusion_model";
}

export function importRecipeFromText(
  text: string,
  fileName?: string,
): ImportedRecipeDraft {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    throw new ComfyImportError("The file is empty.");
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new ComfyImportError("This JSON file could not be parsed.");
    }
    return importFromJson(parsed, fileName, trimmed);
  }
  if (/negative prompt\s*:/i.test(trimmed) || /\bsteps\s*:/i.test(trimmed)) {
    return importFromA1111(trimmed, fileName);
  }
  throw new ComfyImportError(
    "This file is not a ComfyUI workflow or an A1111 parameters block.",
  );
}

export async function importRecipeFromPngBytes(
  bytes: Uint8Array,
  fileName?: string,
): Promise<ImportedRecipeDraft> {
  const chunks = await readPngTextChunks(bytes);
  const workflow = chunkValue(chunks, "workflow");
  const prompt = chunkValue(chunks, "prompt");
  const parameters = chunkValue(chunks, "parameters");
  const errors: string[] = [];

  if (workflow) {
    try {
      return importRecipeFromText(workflow, fileName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "workflow");
    }
  }
  if (prompt) {
    try {
      return importRecipeFromText(prompt, fileName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "prompt");
    }
  }
  if (parameters) {
    return importFromA1111(parameters, fileName);
  }
  if (errors.length) {
    throw new ComfyImportError(errors[0] ?? "This PNG could not be imported.");
  }
  throw new ComfyImportError(
    "This PNG has no ComfyUI or A1111 metadata. Save it from ComfyUI with metadata enabled, or drop the workflow JSON.",
  );
}

export async function importRecipeFromFile(
  file: File,
): Promise<ImportedRecipeDraft> {
  const name = file.name || "import";
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) return importRecipeFromPngBytes(bytes, name);
  const text = new TextDecoder().decode(bytes);
  return importRecipeFromText(text, name);
}

export function toRecipeInput(
  draft: ImportedRecipeDraft,
  resources: Resource[],
): RecipeInput {
  const matchedModel = draft.checkpointName
    ? matchModel(resources, draft.checkpointName, draft.checkpointKind)
    : undefined;
  const kind =
    draft.checkpointKind === "unknown" &&
    matchedModel?.resourceType === "diffusion_model"
      ? "diffusion_model"
      : draft.checkpointKind;
  const notes = [draft.notes.trim()];
  if (
    kind === "diffusion_model" &&
    !notes.some((line) => line.includes(DIFFUSION_IMPORT_MARKER))
  ) {
    notes.push(DIFFUSION_IMPORT_NOTE);
  }
  if (draft.checkpointName && !matchedModel && kind !== "diffusion_model") {
    notes.push(
      `Checkpoint ${basename(draft.checkpointName)} is not in the local catalog yet. Export keeps this filename.`,
    );
  }
  for (const warning of draft.warnings) {
    if (!notes.some((line) => line.includes(warning))) notes.push(warning);
  }

  const loras: RecipeLora[] = [];
  for (const lora of draft.loras) {
    if (!lora.name.trim()) continue;
    const resource = matchResource(resources, lora.name, "lora");
    loras.push({
      resourceId: resource?.id ?? `import:${lora.name}`,
      name: resource?.name || lora.name,
      modelStrength: lora.modelStrength,
      clipStrength: lora.clipStrength,
      order: loras.length,
      triggerWords: resource ? [...resource.triggerWords] : [],
      enabledTriggerWords: resource ? [...resource.confirmedTriggerWords] : [],
    });
    if (!resource) {
      notes.push(
        `LoRA ${basename(lora.name)} is not in the local catalog yet. Export keeps this filename.`,
      );
    }
  }

  return {
    id: "",
    title: draft.title,
    status: draft.positivePrompt.trim() ? "reproducible" : "draft",
    modality: "text_to_image",
    positivePrompt: draft.positivePrompt,
    positiveTranslation: "",
    negativePrompt: draft.negativePrompt,
    negativeTranslation: "",
    modelId: matchedModel?.id,
    modelName: matchedModel?.name || draft.checkpointName || undefined,
    loras,
    params: { ...draft.params },
    assets: [],
    tagIds: [],
    notes: notes.filter(Boolean).join("\n"),
    sourceWorkflow: draft.sourceWorkflow,
    favorite: false,
    rating: 0,
    usageCount: 0,
  };
}

function importFromJson(value: unknown, fileName?: string, json?: string): ImportedRecipeDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ComfyImportError("This JSON file is not a ComfyUI workflow.");
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.nodes)) return {
    ...importUiWorkflow(record, fileName),
    sourceWorkflow: { format: "workflow", fileName, graph: structuredClone(record), json },
  };
  if (record.workflow && typeof record.workflow === "object") {
    return importFromJson(record.workflow, fileName, json ? jsonMember(json, "workflow") : undefined);
  }
  if (isApiPrompt(record)) return {
    ...importApiPrompt(record, fileName),
    sourceWorkflow: { format: "api_prompt", fileName, graph: structuredClone(record), json },
  };
  if (record.prompt && typeof record.prompt === "object" && isApiPrompt(record.prompt)) {
    return importFromJson(record.prompt, fileName, json ? jsonMember(json, "prompt") : undefined);
  }
  throw new ComfyImportError("This JSON file has no ComfyUI nodes or prompt graph.");
}

// Extract a value from an already validated JSON envelope without rounding
// large integer seeds by reserializing the parsed JavaScript object.
function jsonMember(json: string, name: string): string | undefined {
  let cursor = json.indexOf("{") + 1;
  let result: string | undefined;
  const whitespace = () => { while (cursor < json.length && /\s/.test(json[cursor])) cursor++; };
  const quoted = () => {
    cursor++;
    while (cursor < json.length) {
      const char = json[cursor++];
      if (char === "\\") cursor++;
      else if (char === '"') break;
    }
  };
  while (cursor < json.length) {
    whitespace();
    if (json[cursor] === "}") break;
    const keyStart = cursor;
    quoted();
    const key = JSON.parse(json.slice(keyStart, cursor));
    whitespace(); cursor++; whitespace();
    const valueStart = cursor;
    if (json[cursor] === '"') quoted();
    else if (json[cursor] === "{" || json[cursor] === "[") {
      let depth = 0;
      do {
        const char = json[cursor];
        if (char === '"') { quoted(); continue; }
        if (char === "{" || char === "[") depth++;
        if (char === "}" || char === "]") depth--;
        cursor++;
      } while (depth > 0 && cursor < json.length);
    } else {
      while (cursor < json.length && !/[,}]/.test(json[cursor])) cursor++;
    }
    if (key === name) result = json.slice(valueStart, cursor).trim();
    whitespace();
    if (json[cursor] === ",") cursor++;
  }
  return result;
}

function importUiWorkflow(
  workflow: Record<string, unknown>,
  fileName?: string,
): ImportedRecipeDraft {
  const uiLinks = parseUiLinks(workflow.links);
  const rawNodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const nodes = rawNodes.flatMap((raw) => normalizeUiNode(raw, uiLinks));
  if (!nodes.length) {
    throw new ComfyImportError("This workflow does not contain any nodes.");
  }
  return recipeFromNodes(nodes, "ComfyUI workflow", fileName);
}

function importApiPrompt(
  prompt: Record<string, unknown>,
  fileName?: string,
): ImportedRecipeDraft {
  const nodes: NormalizedNode[] = [];
  for (const [id, raw] of Object.entries(prompt)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.class_type !== "string") continue;
    const inputs =
      record.inputs && typeof record.inputs === "object"
        ? (record.inputs as Record<string, unknown>)
        : {};
    const values: Record<string, unknown> = {};
    const links: Record<string, string> = {};
    for (const [key, input] of Object.entries(inputs)) {
      if (isLink(input)) links[key] = String(input[0]);
      else values[key] = input;
    }
    const meta = record._meta as { title?: string } | undefined;
    nodes.push({
      id,
      type: record.class_type,
      title: typeof meta?.title === "string" ? meta.title : "",
      values,
      links,
    });
  }
  if (!nodes.length) {
    throw new ComfyImportError("This prompt graph does not contain any nodes.");
  }
  return recipeFromNodes(nodes, "ComfyUI prompt", fileName);
}

function recipeFromNodes(
  nodes: NormalizedNode[],
  source: string,
  fileName?: string,
): ImportedRecipeDraft {
  const warnings: string[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sampler = chooseSampler(nodes, byId);
  if (!sampler && nodes.length > 1) {
    warnings.push("No sampler was found; prompt and model references were still imported.");
  }

  let positiveId = sampler?.links.positive;
  let negativeId = sampler?.links.negative;
  let modelId = sampler?.links.model;
  let latentId = sampler?.links.latent_image;
  let params = sampler ? readSampler(sampler, byId, warnings) : { ...EMPTY_PARAMS };

  if (sampler && (sampler.type === "SamplerCustomAdvanced" || sampler.type === "SamplerCustom")) {
    const guider = byId.get(sampler.links.guider ?? "");
    positiveId = guider?.links.conditioning ?? guider?.links.positive;
    modelId = guider?.links.model ?? modelId;
    const samplerSelect = byId.get(sampler.links.sampler ?? "");
    if (samplerSelect) {
      params = {
        ...params,
        sampler: textValue(samplerSelect.values.sampler_name) || params.sampler,
      };
    }
    const sigmas = byId.get(sampler.links.sigmas ?? "");
    if (sigmas) {
      params = {
        ...params,
        steps: asNumber(sigmas.values.steps) ?? params.steps,
        scheduler: textValue(sigmas.values.scheduler) || params.scheduler,
      };
    }
    warnings.push(
      "This graph uses a custom sampler. Steps, sampler, and guidance were read where the nodes exposed them.",
    );
  }

  const positive = textFromConditioning(positiveId, byId);
  const negative = textFromConditioning(negativeId, byId);
  if (positive.guidance != null && (params.cfg == null || params.cfg === 1)) {
    params = { ...params, cfg: positive.guidance };
  }

  const chain = collectModelChain(modelId, byId, warnings);
  const latent = latentId ? byId.get(latentId) : undefined;
  if (latent) {
    params = {
      ...params,
      width: asNumber(latent.values.width) ?? params.width,
      height: asNumber(latent.values.height) ?? params.height,
    };
  }

  let positivePrompt = positive.text.trim();
  let negativePrompt = negative.text.trim();
  if (!positivePrompt) {
    const fallback = nodes.find(
      (node) =>
        node.type.startsWith("CLIPTextEncode") &&
        !/negative/i.test(node.title) &&
        textValue(node.values.text, node.values.t5xxl, node.values.text_g),
    );
    positivePrompt = fallback
      ? textValue(fallback.values.text, fallback.values.t5xxl, fallback.values.text_g)
      : "";
  }
  if (!negativePrompt) {
    const fallback = nodes.find(
      (node) =>
        node.type.startsWith("CLIPTextEncode") &&
        /negative/i.test(node.title),
    );
    negativePrompt = fallback
      ? textValue(fallback.values.text, fallback.values.text_g, fallback.values.text_l)
      : "";
  }

  const embedded = extractLoraTags(`${positivePrompt}\n${negativePrompt}`);
  if (embedded.loras.length) {
    positivePrompt = stripLoraTags(positivePrompt);
    negativePrompt = stripLoraTags(negativePrompt);
    for (const lora of embedded.loras) {
      if (!chain.loras.some((item) => item.name === lora.name)) chain.loras.push(lora);
    }
  }

  const checkpointName = chain.base ? modelReference(chain.base) : "";
  const checkpointKind: CheckpointKind = chain.base
    ? DIFFUSION_TYPES.has(chain.base.type)
      ? "diffusion_model"
      : CHECKPOINT_TYPES.has(chain.base.type)
        ? "checkpoint"
        : "unknown"
    : "unknown";

  if (
    !positivePrompt &&
    !negativePrompt &&
    !checkpointName &&
    chain.loras.length === 0 &&
    params.steps == null &&
    params.width == null
  ) {
    warnings.push("No standard prompt, model, or sampler settings were found. The original graph is preserved for export; review it in ComfyUI.");
  }

  const notes = [`Imported from a ${source}${fileName ? ` (${fileName})` : ""}.`];
  if (checkpointKind === "diffusion_model") notes.push(DIFFUSION_IMPORT_NOTE);

  return {
    title: titleFromFileName(fileName),
    positivePrompt,
    negativePrompt,
    checkpointName,
    checkpointKind,
    loras: chain.loras,
    params,
    notes: notes.join("\n"),
    warnings,
  };
}

function importFromA1111(text: string, fileName?: string): ImportedRecipeDraft {
  const stepsAt = text.search(/(?:^|\n)Steps:\s*/i);
  const head = stepsAt >= 0 ? text.slice(0, stepsAt) : text;
  const meta = stepsAt >= 0 ? text.slice(stepsAt).replace(/^\n/, "") : "";
  const parts = head.split(/\nNegative prompt:\s*/i);
  const embedded = extractLoraTags(parts[0] ?? "");
  const positivePrompt = stripLoraTags(parts[0] ?? "").trim();
  const negativePrompt = stripLoraTags(parts[1] ?? "").trim();
  const samplerField = metaField(meta, "Sampler");
  const mapped = samplerField
    ? A1111_SAMPLERS[samplerField.toLocaleLowerCase()]
    : undefined;
  const size = metaField(meta, "Size");
  const [width, height] = size?.split("x").map((item) => asNumber(item)) ?? [];
  const warnings: string[] = [];
  if (samplerField && !mapped) {
    warnings.push(`Sampler "${samplerField}" was kept as written.`);
  }
  const model = metaField(meta, "Model") ?? "";
  if (!positivePrompt && !model) {
    throw new ComfyImportError("This parameters block has no prompt or model.");
  }
  return {
    title: titleFromFileName(fileName),
    positivePrompt,
    negativePrompt,
    checkpointName: model,
    checkpointKind: model ? "checkpoint" : "unknown",
    loras: embedded.loras,
    params: {
      width: width ?? null,
      height: height ?? null,
      sampler: mapped?.sampler ?? (samplerField || null),
      scheduler: mapped?.scheduler ?? null,
      steps: asNumber(metaField(meta, "Steps")),
      cfg: asNumber(metaField(meta, "CFG scale")),
      seed: metaField(meta, "Seed"),
    },
    notes: `Imported from an A1111 parameters block${fileName ? ` (${fileName})` : ""}.`,
    warnings,
  };
}

function chooseSampler(
  nodes: NormalizedNode[],
  byId: Map<string, NormalizedNode>,
): NormalizedNode | undefined {
  const samplers = nodes.filter((node) => isSampler(node.type));
  if (samplers.length <= 1) return samplers[0];
  const queue = nodes
    .filter((node) => IMAGE_OUTPUT_TYPES.has(node.type))
    .flatMap((node) => Object.values(node.links));
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (isSampler(node.type)) return node;
    queue.push(...Object.values(node.links));
  }
  return samplers[0];
}

function readSampler(
  sampler: NormalizedNode,
  byId: Map<string, NormalizedNode>,
  warnings: string[],
): GenerationParams {
  if (sampler.type === "SamplerCustomAdvanced" || sampler.type === "SamplerCustom") {
    const noise = byId.get(sampler.links.noise ?? "");
    const seed = asNumber(noise?.values.noise_seed ?? sampler.values.noise_seed);
    const control = textValue(noise?.values.control_after_generate);
    return {
      ...EMPTY_PARAMS,
      seed: control === "randomize" ? "-1" : seed == null ? null : String(seed),
    };
  }
  const control = textValue(sampler.values.control_after_generate).toLocaleLowerCase();
  const seedNumber = asNumber(
    sampler.type === "KSamplerAdvanced"
      ? sampler.values.noise_seed
      : sampler.values.seed,
  );
  if (!sampler.values.sampler_name && !sampler.values.steps) {
    warnings.push("Sampler settings were not in a recognized layout.");
  }
  return {
    width: null,
    height: null,
    sampler: textValue(sampler.values.sampler_name) || null,
    scheduler: textValue(sampler.values.scheduler) || null,
    steps: asNumber(sampler.values.steps),
    cfg: asNumber(sampler.values.cfg),
    seed: control === "randomize" ? "-1" : seedNumber == null ? null : String(seedNumber),
  };
}

function collectModelChain(
  startId: string | undefined,
  byId: Map<string, NormalizedNode>,
  warnings: string[],
): { loras: ImportedLora[]; base?: NormalizedNode } {
  const loras: ImportedLora[] = [];
  let current = startId ? byId.get(startId) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (isLoraNode(current.type)) {
      const name = textValue(current.values.lora_name, current.values.lora);
      const modelStrength = asNumber(current.values.strength_model) ?? 1;
      const clipStrength =
        asNumber(current.values.strength_clip) ?? modelStrength;
      if (name) loras.push({ name, modelStrength, clipStrength });
      else warnings.push(`A ${current.type} node did not include a LoRA filename.`);
      current = byId.get(current.links.model ?? "");
      continue;
    }
    break;
  }
  loras.reverse();
  return { loras, base: current };
}

function textFromConditioning(
  startId: string | undefined,
  byId: Map<string, NormalizedNode>,
  depth = 0,
): { text: string; guidance: number | null } {
  if (!startId || depth > 8) return { text: "", guidance: null };
  const node = byId.get(startId);
  if (!node) return { text: "", guidance: null };
  if (node.type === "CLIPTextEncode" || node.type === "CLIPTextEncodeFlux") {
    return {
      text: textValue(node.values.text, node.values.t5xxl, node.values.clip_l, node.values.text_g),
      guidance: asNumber(node.values.guidance),
    };
  }
  if (node.type === "CLIPTextEncodeSDXL" || node.type === "CLIPTextEncodeSDXLRefiner") {
    const g = textValue(node.values.text_g, node.values.text);
    const l = textValue(node.values.text_l);
    return { text: g && l && g !== l ? `${g}\n${l}` : g || l, guidance: null };
  }
  if (CONDITIONING_PASS.has(node.type) || /conditioning/i.test(node.type)) {
    const next =
      node.links.conditioning ??
      node.links.positive ??
      Object.values(node.links)[0];
    const nested = textFromConditioning(next, byId, depth + 1);
    return {
      text: nested.text,
      guidance: asNumber(node.values.guidance) ?? nested.guidance,
    };
  }
  return { text: "", guidance: null };
}

function normalizeUiNode(raw: unknown, uiLinks: UiLink[]): NormalizedNode[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  if (record.id == null || typeof record.type !== "string") return [];
  const widgets = Array.isArray(record.widgets_values) ? record.widgets_values : [];
  const links: Record<string, string> = {};
  if (Array.isArray(record.inputs)) {
    for (const input of record.inputs) {
      if (!input || typeof input !== "object") continue;
      const item = input as Record<string, unknown>;
      if (typeof item.name !== "string" || item.link == null) continue;
      const found = uiLinks.find((link) => link.id === Number(item.link));
      if (found) links[item.name] = found.from;
    }
  }
  return [
    {
      id: String(record.id),
      type: record.type,
      title: typeof record.title === "string" ? record.title : "",
      values: widgetsToValues(record.type, widgets),
      links,
    },
  ];
}

function widgetsToValues(type: string, widgets: unknown[]): Record<string, unknown> {
  if (type === "KSampler" || type === "RandomNoise") {
    const control =
      typeof widgets[1] === "string" &&
      SEED_CONTROLS.has(widgets[1].toLocaleLowerCase());
    if (control) {
      return type === "RandomNoise"
        ? { noise_seed: widgets[0], control_after_generate: widgets[1] }
        : {
            seed: widgets[0],
            control_after_generate: widgets[1],
            steps: widgets[2],
            cfg: widgets[3],
            sampler_name: widgets[4],
            scheduler: widgets[5],
            denoise: widgets[6],
          };
    }
    if (type === "RandomNoise") return { noise_seed: widgets[0] };
    return {
      seed: widgets[0],
      steps: widgets[1],
      cfg: widgets[2],
      sampler_name: widgets[3],
      scheduler: widgets[4],
      denoise: widgets[5],
    };
  }
  if (type === "KSamplerAdvanced") {
    return {
      noise_seed: widgets[0],
      add_noise: widgets[1],
      steps: widgets[2],
      cfg: widgets[3],
      sampler_name: widgets[4],
      scheduler: widgets[5],
    };
  }
  const names = WIDGET_NAMES[type] ?? [];
  const values: Record<string, unknown> = {};
  names.forEach((name, index) => {
    if (index < widgets.length) values[name] = widgets[index];
  });
  return values;
}

interface UiLink {
  id: number;
  from: string;
}

function parseUiLinks(raw: unknown): UiLink[] {
  if (!Array.isArray(raw)) return [];
  const links: UiLink[] = [];
  for (const link of raw) {
    if (Array.isArray(link) && link.length >= 5) {
      links.push({ id: Number(link[0]), from: String(link[1]) });
      continue;
    }
    if (!link || typeof link !== "object") continue;
    const record = link as Record<string, unknown>;
    const from = record.origin_id ?? record.from_node ?? record.originId;
    if (record.id == null || from == null) continue;
    links.push({ id: Number(record.id), from: String(from) });
  }
  return links;
}

function isApiPrompt(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).some(
    (item) =>
      !!item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { class_type?: unknown }).class_type === "string",
  );
}

function isLink(value: unknown): value is [string | number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    (typeof value[0] === "string" || typeof value[0] === "number") &&
    typeof value[1] === "number"
  );
}

function isSampler(type: string): boolean {
  return (
    type === "KSampler" ||
    type === "KSamplerAdvanced" ||
    type === "SamplerCustom" ||
    type === "SamplerCustomAdvanced"
  );
}

function isLoraNode(type: string): boolean {
  return /lora/i.test(type);
}

function modelReference(node: NormalizedNode): string {
  return textValue(
    node.values.ckpt_name,
    node.values.unet_name,
    node.values.model_name,
  );
}

function extractLoraTags(text: string): { loras: ImportedLora[] } {
  const loras: ImportedLora[] = [];
  const pattern = /<lora:([^:>]+):([^:>]+)(?::([^>]+))?>/gi;
  for (const match of text.matchAll(pattern)) {
    const name = match[1]?.trim() ?? "";
    const modelStrength = asNumber(match[2]) ?? 1;
    const clipStrength = asNumber(match[3]) ?? modelStrength;
    if (name) loras.push({ name, modelStrength, clipStrength });
  }
  return { loras };
}

function stripLoraTags(text: string): string {
  return text
    .replace(/\s*<lora:[^>]+>\s*/gi, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/,\s*(?=,|$)/g, "")
    .trim();
}

function metaField(meta: string, name: string): string | null {
  const match = meta.match(new RegExp(`(?:^|,\\s*)${name}:\\s*([^,\\n]+)`, "i"));
  const value = match?.[1]?.trim();
  return value || null;
}

function titleFromFileName(fileName?: string): string {
  if (!fileName) return "";
  const stemName = fileName.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "").trim();
  if (!stemName || /^(comfyui|workflow|prompt|image|untitled)([_\-\s]?\d+)?$/i.test(stemName)) {
    return "";
  }
  return stemName.replace(/_+/g, " ").slice(0, 80);
}

function basename(value: string): string {
  return value.split(/[/\\]/).pop()?.trim() || value.trim();
}

function fileStem(value: string): string {
  return basename(value).replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
}

export function matchResource(
  resources: Resource[],
  reference: string,
  resourceType?: ResourceType,
): Resource | undefined {
  const base = basename(reference).toLocaleLowerCase();
  const stemName = fileStem(reference).toLocaleLowerCase();
  if (!base) return undefined;
  const candidates = resources.filter((resource) => !resourceType || resource.resourceType === resourceType);
  const normalized = reference.trim().replace(/\\/g, "/").toLocaleLowerCase();
  const exact = candidates.filter((resource) => {
    const path = resource.path.replace(/\\/g, "/").toLocaleLowerCase();
    return path === normalized || path.endsWith(`/${normalized}`);
  });
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  // A subfolder is part of a ComfyUI resource's identity. Do not silently
  // map style/model.safetensors onto another/model.safetensors.
  if (normalized.includes("/")) return undefined;
  const matches = candidates.filter((resource) => {
    if (resourceType && resource.resourceType !== resourceType) return false;
    const pathBase = basename(resource.path).toLocaleLowerCase();
    const name = resource.name.trim().toLocaleLowerCase();
    return pathBase === base || name === base || name === stemName;
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function matchModel(
  resources: Resource[],
  reference: string,
  kind: CheckpointKind,
): Resource | undefined {
  if (kind === "checkpoint" || kind === "diffusion_model") {
    return matchResource(resources, reference, kind);
  }
  return (
    matchResource(resources, reference, "checkpoint") ??
    matchResource(resources, reference, "diffusion_model")
  );
}

function textValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function chunkValue(chunks: Map<string, string>, name: string): string | undefined {
  for (const [key, value] of chunks) {
    if (key.toLocaleLowerCase() === name && value.trim()) return value;
  }
  return undefined;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return signature.every((byte, index) => bytes[index] === byte);
}

async function readPngTextChunks(bytes: Uint8Array): Promise<Map<string, string>> {
  if (!isPng(bytes)) {
    throw new ComfyImportError("This file is not a PNG.");
  }
  const chunks = new Map<string, string>();
  let offset = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new ComfyImportError("This PNG is truncated.");
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "tEXt") {
      const split = data.indexOf(0);
      if (split > 0) {
        chunks.set(decodeLatin1(data.subarray(0, split)), decodeLatin1(data.subarray(split + 1)));
      }
    } else if (type === "iTXt") {
      const parsed = parseItxt(data);
      if (parsed) chunks.set(parsed.keyword, parsed.text);
    } else if (type === "zTXt") {
      const parsed = await parseZtxt(data);
      if (parsed) chunks.set(parsed.keyword, parsed.text);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  return chunks;
}

function parseItxt(data: Uint8Array): { keyword: string; text: string } | undefined {
  const keywordEnd = data.indexOf(0);
  if (keywordEnd <= 0 || keywordEnd + 5 > data.length) return undefined;
  const keyword = decodeLatin1(data.subarray(0, keywordEnd));
  const compression = data[keywordEnd + 1];
  let cursor = keywordEnd + 3;
  const skipString = () => {
    const end = data.indexOf(0, cursor);
    if (end < 0) return false;
    cursor = end + 1;
    return true;
  };
  if (!skipString() || !skipString() || compression !== 0) return undefined;
  return { keyword, text: new TextDecoder().decode(data.subarray(cursor)) };
}

async function parseZtxt(
  data: Uint8Array,
): Promise<{ keyword: string; text: string } | undefined> {
  const split = data.indexOf(0);
  if (split <= 0 || split + 2 > data.length) return undefined;
  const keyword = decodeLatin1(data.subarray(0, split));
  try {
    const inflated = await inflateZlib(data.subarray(split + 2));
    return { keyword, text: new TextDecoder().decode(inflated) };
  } catch {
    return undefined;
  }
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("compressed PNG text is unavailable");
  }
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeLatin1(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

import { invoke } from "@tauri-apps/api/core";
import type {
  AppData,
  AppSettings,
  Asset,
  AssetData,
  AssetImportInput,
  BackupSnapshot,
  Category,
  Dashboard,
  HealthStatus,
  Recipe,
  RecipeInput,
  Revision,
  Resource,
  ResourceScanResult,
  ResourceType,
  ListDownloadLorasResult,
  ImportDownloadLorasResult,
  SearchResult,
  Snippet,
  SnippetInput,
  Tip,
  TipInput,
  TranslationRequest,
  TranslationResponse,
  TranslationProvider,
  TrashItem,
  RecipeTag,
} from "../types";
import { deriveRecipeTitle } from "./recipeTitle";
import {
  DEFAULT_PROMPT_MODEL_PROFILES,
  normalizePromptModelId,
  promptModelOption,
} from "./promptModels";

const now = new Date().toISOString();
// Backend allows up to ~90s for one whole-prompt request; keep UI slightly above that.
const TRANSLATION_UI_TIMEOUT_MS = 100_000;

const recipeTagSeed = [
  ["tag-portrait", "Portrait", "#d6578b", 0],
  ["tag-character", "Character", "#ef7a51", 1],
  ["tag-product", "Product", "#ec9d2d", 2],
  ["tag-landscape", "Landscape", "#35a27f", 3],
  ["tag-illustration", "Illustration", "#8a5cf5", 4],
  ["tag-photography", "Photography", "#2c91b8", 5],
  ["tag-3d", "3D", "#5178dc", 6],
  ["tag-architecture", "Architecture", "#8c6dcc", 7],
  ["tag-other", "Other", "#9aa3b5", 8],
] as const;

const starterCategories: Category[] = [
  ["cat-subject", "Subject", "#5d5fef"],
  ["cat-appearance", "Appearance", "#8a5cf5"],
  ["cat-action", "Action", "#ec9d2d"],
  ["cat-scene", "Scene", "#35a27f"],
  ["cat-composition", "Composition", "#2c91b8"],
  ["cat-camera", "Camera", "#5178dc"],
  ["cat-light", "Lighting", "#8c6dcc"],
  ["cat-style", "Style", "#bd5f9a"],
  ["cat-quality", "Quality", "#687483"],
  ["cat-negative", "Negative", "#d05454"],
].map(([id, name, color], sortOrder) => ({
  id,
  name,
  color,
  sortOrder,
  promptModel: "general" as const,
}));

const starterRecipeTags: RecipeTag[] = [
  ...recipeTagSeed.map(([id, name, color, sortOrder]) => ({
    id,
    name,
    color,
    kind: "general" as const,
    sortOrder,
    recipeCount: 0,
    promptModel: "general" as const,
  })),
];

const starterResources: Resource[] = [
  {
    id: "model-flux",
    name: "FLUX.1-dev-fp8",
    resourceType: "diffusion_model",
    path: "C:\\AI\\ComfyUI\\models\\diffusion_models\\flux1-dev-fp8.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
    baseModel: "FLUX.1",
    fileSize: 11_908_546_560,
  },
  {
    id: "model-sdxl",
    name: "DreamShaper XL Turbo",
    resourceType: "checkpoint",
    path: "C:\\AI\\ComfyUI\\models\\checkpoints\\dreamshaperXL_turbo.safetensors",
    available: true,
    triggerWords: [],
    confirmedTriggerWords: [],
    baseModel: "SDXL",
    fileSize: 6_938_214_400,
  },
  {
    id: "lora-film",
    name: "Cinematic Film Still",
    resourceType: "lora",
    path: "C:\\AI\\ComfyUI\\models\\loras\\cinematic_film_still.safetensors",
    available: true,
    triggerWords: ["cinematic film still", "film grain", "shallow depth of field"],
    confirmedTriggerWords: ["cinematic film still", "film grain"],
    baseModel: "FLUX.1",
    fileSize: 185_340_928,
  },
  {
    id: "lora-pose",
    name: "Natural Hand Poses",
    resourceType: "lora",
    path: "C:\\AI\\ComfyUI\\models\\loras\\natural_hand_poses.safetensors",
    available: true,
    triggerWords: ["natural hand pose", "v-sign"],
    confirmedTriggerWords: ["natural hand pose"],
    baseModel: "FLUX.1 / SDXL",
    fileSize: 92_552_192,
  },
  {
    id: "lora-offline",
    name: "Soft Light Portrait",
    resourceType: "lora",
    path: "C:\\AI\\ComfyUI\\models\\loras\\archive\\soft_light.safetensors",
    available: false,
    triggerWords: ["soft lighting"],
    confirmedTriggerWords: [],
    baseModel: "SDXL",
  },
];

const starterSnippets: Snippet[] = [
  {
    id: "snippet-vsign",
    text: "She made a V-sign at the camera",
    translation: "她对着镜头比出 V 字手势",
    notes: "适合半身人像，手部最好不要离镜头太近。",
    categoryIds: ["cat-subject", "cat-action"],
    favorite: true,
    translationLocked: true,
    usageCount: 12,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "snippet-window",
    text: "soft morning light through the window",
    translation: "清晨柔光透过窗户",
    notes: "",
    categoryIds: ["cat-light", "cat-scene"],
    favorite: true,
    translationLocked: false,
    usageCount: 8,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "snippet-eye",
    text: "looking directly at the camera",
    translation: "直视镜头",
    notes: "",
    categoryIds: ["cat-subject", "cat-camera"],
    favorite: false,
    translationLocked: false,
    usageCount: 17,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "snippet-dress",
    text: "wearing an ivory linen dress",
    translation: "身穿象牙白亚麻连衣裙",
    notes: "",
    categoryIds: ["cat-appearance"],
    favorite: false,
    translationLocked: false,
    usageCount: 4,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "snippet-film",
    text: "cinematic film still",
    translation: "电影胶片剧照",
    notes: "可与 film grain 搭配。",
    categoryIds: ["cat-style"],
    favorite: true,
    translationLocked: false,
    usageCount: 21,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "snippet-quality",
    text: "masterpiece, best quality, highly detailed",
    translation: "杰作、最佳质量、高度细节",
    notes: "",
    categoryIds: ["cat-quality"],
    favorite: false,
    translationLocked: false,
    usageCount: 30,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "snippet-negative",
    text: "blurry, deformed hands, extra fingers",
    translation: "模糊、手部变形、多余手指",
    notes: "",
    categoryIds: ["cat-negative"],
    favorite: false,
    translationLocked: false,
    usageCount: 23,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
];

const starterRecipes: Recipe[] = [
  {
    id: "recipe-window",
    title: "窗边晨光人像",
    status: "reproducible",
    modality: "text_to_image",
    positivePrompt:
      "masterpiece, best quality, cinematic film still, a young woman wearing an ivory linen dress, (soft morning light through the window:1.2), looking directly at the camera",
    positiveTranslation:
      "杰作，最佳质量，电影胶片剧照，一位身穿象牙白亚麻连衣裙的年轻女性，清晨柔光透过窗户，直视镜头",
    negativePrompt: "blurry, deformed hands, extra fingers, watermark",
    negativeTranslation: "模糊，手部变形，多余手指，水印",
    modelId: "model-flux",
    modelName: "FLUX.1-dev-fp8",
    loras: [
      {
        resourceId: "lora-film",
        name: "Cinematic Film Still",
        modelStrength: 0.85,
        clipStrength: 1,
        order: 0,
        triggerWords: ["cinematic film still", "film grain"],
        enabledTriggerWords: ["cinematic film still"],
      },
    ],
    params: {
      width: 1024,
      height: 1365,
      sampler: "euler",
      scheduler: "simple",
      steps: 28,
      cfg: 3.5,
      seed: "42819376",
    },
    assets: [],
    tagIds: ["tag-portrait", "tag-photography"],
    notes: "肤色偏暖时降低电影 LoRA 到 0.75。",
    favorite: true,
    rating: 5,
    usageCount: 9,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "recipe-rain",
    title: "雨夜霓虹街头",
    status: "draft",
    modality: "text_to_image",
    positivePrompt:
      "cinematic night street, neon reflections on wet pavement, lone figure holding a transparent umbrella, teal and amber light",
    positiveTranslation: "电影感夜晚街道，湿润路面的霓虹倒影，独自撑着透明雨伞的人物，青橙色灯光",
    negativePrompt: "daylight, low contrast, text",
    negativeTranslation: "日光、低对比度、文字",
    modelId: "model-sdxl",
    modelName: "DreamShaper XL Turbo",
    loras: [],
    params: {
      width: 1024,
      height: 1024,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      steps: 8,
      cfg: 2,
      seed: "-1",
    },
    assets: [],
    tagIds: ["tag-landscape", "tag-photography"],
    notes: "待测试雨丝的权重。",
    favorite: false,
    rating: 3,
    usageCount: 2,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "recipe-product",
    title: "极简香水产品照",
    status: "reproducible",
    modality: "text_to_image",
    positivePrompt:
      "luxury perfume bottle on travertine pedestal, warm directional sunlight, long geometric shadows, editorial product photography, clean beige background",
    positiveTranslation: "洞石台座上的奢华香水瓶，温暖的方向性阳光，长几何阴影，编辑风产品摄影，干净米色背景",
    negativePrompt: "people, clutter, label errors, warped glass",
    negativeTranslation: "人物、杂乱、标签错误、玻璃变形",
    modelId: "model-sdxl",
    modelName: "DreamShaper XL Turbo",
    loras: [],
    params: {
      width: 1024,
      height: 1024,
      sampler: "dpmpp_sde",
      scheduler: "karras",
      steps: 24,
      cfg: 5,
      seed: "9081251",
    },
    assets: [],
    tagIds: [],
    notes: "",
    favorite: true,
    rating: 4,
    usageCount: 6,
    promptModel: "general",
    createdAt: now,
    updatedAt: now,
  },
];

const starterTips: Tip[] = [
  {
    id: "tip-global-1",
    title: "先锁构图，再补细节",
    content:
      "先用少量关键词确定主体、景别和光线；构图稳定后再加入材质与风格词，定位问题会更容易。",
    scope: "global",
    favorite: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tip-flux-1",
    title: "FLUX 更适合自然语言",
    content:
      "描述人物动作时优先使用完整句子，避免堆叠过多同义短词。CFG 通常从 3.5 左右开始尝试。",
    scope: "model",
    targetId: "model-flux",
    targetName: "FLUX.1-dev-fp8",
    favorite: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tip-lora-1",
    title: "电影感 LoRA 权重",
    content:
      "人物肤色过度偏色时，先把模型权重从 1.0 降至 0.75–0.85，而不是继续增加负面词。",
    scope: "lora",
    targetId: "lora-film",
    targetName: "Cinematic Film Still",
    favorite: false,
    createdAt: now,
    updatedAt: now,
  },
];

const generalDefaults = promptModelOption("general");

const initialSettings: AppSettings = {
  privacyMode: false,
  loraPath: "C:\\AI\\ComfyUI\\models\\loras",
  checkpointPath: "C:\\AI\\ComfyUI\\models\\checkpoints",
  diffusionModelPath: "C:\\AI\\ComfyUI\\models\\diffusion_models",
  backupPath: "",
  translationProvider: "off",
  translationEndpoint: "http://localhost:11434/v1",
  translationModel: "",
  onlineTranslationEnabled: false,
  translationTargetLanguage: "en",
  promptModels: structuredClone(DEFAULT_PROMPT_MODEL_PROFILES),
  activePromptModel: "general",
  defaultPrefix: generalDefaults.defaultPrefix,
  defaultNegative: generalDefaults.defaultNegative,
};

type ModelPromptDefaults = Record<
  string,
  { defaultPrefix: string; defaultNegative: string }
>;

const initialModelDefaults: ModelPromptDefaults = {
  general: {
    defaultPrefix: generalDefaults.defaultPrefix,
    defaultNegative: generalDefaults.defaultNegative,
  },
};

const memory = {
  recipes: structuredClone(starterRecipes),
  snippets: structuredClone(starterSnippets),
  categories: structuredClone(starterCategories),
  recipeTags: structuredClone(starterRecipeTags),
  resources: structuredClone(starterResources),
  tips: structuredClone(starterTips),
  settings: structuredClone(initialSettings),
  modelDefaults: structuredClone(initialModelDefaults),
  trash: [] as TrashItem[],
  backups: [] as BackupSnapshot[],
};

function activeModel(): string {
  return normalizePromptModelId(memory.settings.activePromptModel);
}

function applyActiveModelDefaults() {
  const model = activeModel();
  const defaults = memory.modelDefaults[model] ?? memory.modelDefaults.general;
  memory.settings = {
    ...memory.settings,
    activePromptModel: model,
    defaultPrefix: defaults.defaultPrefix,
    defaultNegative: defaults.defaultNegative,
  };
}

let browserTranslationCredentialConfigured = false;

function isTauriRuntime() {
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    isTauri?: boolean;
  };
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    w.isTauri === true
  );
}

/** True when a prompt still lacks a translation in the user's chosen language. */
export function recipeNeedsTranslation(input: {
  positivePrompt?: string;
  positiveTranslation?: string;
}): boolean {
  const source = (input.positivePrompt ?? "").trim();
  if (!source) return false;
  return !(input.positiveTranslation ?? "").trim();
}

async function call<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (!isTauriRuntime()) return fallback();
  // A desktop command failure must stay visible. Falling back to the volatile
  // browser demo here could make the UI report a successful save that vanishes
  // after restart.
  return invoke<T>(command, args);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof window.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

function stamp<T extends { id: string; createdAt?: string; updatedAt?: string }>(
  input: T,
): T & { createdAt: string; updatedAt: string } {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    id: input.id || crypto.randomUUID(),
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function dashboardFallback(): Dashboard {
  const model = activeModel();
  const recipes = memory.recipes.filter(
    (item) => normalizePromptModelId(item.promptModel) === model,
  );
  const snippets = memory.snippets.filter(
    (item) => normalizePromptModelId(item.promptModel) === model,
  );
  return {
    recipeCount: recipes.length,
    snippetCount: snippets.length,
    resourceCount: memory.resources.length,
    favoriteCount:
      recipes.filter((item) => item.favorite).length +
      snippets.filter((item) => item.favorite).length +
      memory.tips.filter((item) => item.favorite).length,
    backupHealthy: Boolean(memory.settings.backupPath),
    lastBackupAt: memory.backups[0]?.createdAt,
    resourcePathsOnline: memory.resources.some((item) => item.available),
  };
}

export const api = {
  async healthCheck() {
    return call<HealthStatus>("health_check", undefined, () => ({
      status: "ok",
      databasePath: "浏览器演示内存",
      vaultPath: "浏览器演示内存",
      schemaVersion: 1,
      recoveryMode: false,
    }));
  },
  async getDashboard() {
    return call<Dashboard>("get_dashboard", undefined, dashboardFallback);
  },
  async listRecipes() {
    return call<Recipe[]>("list_recipes", { options: { limit: 0 } }, () => {
      const model = activeModel();
      return structuredClone(
        memory.recipes.filter(
          (item) => normalizePromptModelId(item.promptModel) === model,
        ),
      );
    });
  },
  async saveRecipe(input: RecipeInput) {
    // 总 Prompt 不在此强制翻译，避免保存卡很久。
    return call<Recipe>("save_recipe", { input }, () => {
      const timestamp = new Date();
      const existing = memory.recipes.find((item) => item.id === input.id);
      const promptModel = normalizePromptModelId(
        input.promptModel || existing?.promptModel || activeModel(),
      );
      const recipe = stamp({
        ...input,
        promptModel,
        title: deriveRecipeTitle(input.title, input.positivePrompt, timestamp),
        usageCount: input.usageCount ?? 0,
      }) as Recipe;
      const index = memory.recipes.findIndex((item) => item.id === recipe.id);
      if (index >= 0) memory.recipes[index] = recipe;
      else memory.recipes.unshift(recipe);
      return structuredClone(recipe);
    });
  },
  async deleteRecipe(id: string) {
    return call<void>("delete_recipe", { id }, () => {
      const recipe = memory.recipes.find((item) => item.id === id);
      if (recipe) {
        memory.trash.unshift({
          id,
          entityType: "recipe",
          title: recipe.title,
          deletedAt: new Date().toISOString(),
        });
      }
      memory.recipes = memory.recipes.filter((item) => item.id !== id);
    });
  },
  async listSnippets() {
    // limit: 0 = unlimited on the Rust side (default used to be 500 and
    // silently dropped older snippets once the vault grew past that).
    return call<Snippet[]>("list_snippets", { options: { limit: 0 } }, () => {
      const model = activeModel();
      return structuredClone(
        memory.snippets.filter(
          (item) => normalizePromptModelId(item.promptModel) === model,
        ),
      );
    });
  },
  async saveSnippet(input: SnippetInput) {
    // 只翻一次：由后端 save_snippet 在缺译文时翻译，避免前后端各翻一遍拖很久。
    return call<Snippet>("save_snippet", { input }, async () => {
      let payload = input;
      if (
        !(input.translationLocked && input.translation.trim()) &&
        recipeNeedsTranslation({
          positivePrompt: input.text,
          positiveTranslation: input.translation,
        })
      ) {
        try {
          const result = await api.translateText({
            text: input.text.trim(),
            targetLanguage: memory.settings.translationTargetLanguage,
          });
          const translated = (result.text ?? "").trim();
          if (translated) {
            payload = {
              ...input,
              translation: translated,
              translationLocked: true,
            };
          }
        } catch {
          /* keep original */
        }
      }
      const existing = memory.snippets.find((item) => item.id === payload.id);
      const promptModel = normalizePromptModelId(
        payload.promptModel || existing?.promptModel || activeModel(),
      );
      const duplicate = memory.snippets.find(
        (item) =>
          item.id !== payload.id &&
          normalizePromptModelId(item.promptModel) === promptModel &&
          item.text.trim().toLocaleLowerCase() ===
            payload.text.trim().toLocaleLowerCase(),
      );
      if (duplicate) {
        throw new Error(`当前模型下已存在相同的单 Prompt（${duplicate.id}）`);
      }
      const snippet = stamp({
        ...payload,
        promptModel,
        usageCount: payload.usageCount ?? 0,
      }) as Snippet;
      const index = memory.snippets.findIndex((item) => item.id === snippet.id);
      if (index >= 0) memory.snippets[index] = snippet;
      else memory.snippets.unshift(snippet);
      return structuredClone(snippet);
    });
  },
  async incrementSnippetUsage(id: string) {
    return call<void>("increment_snippet_usage", { id }, () => {
      memory.snippets = memory.snippets.map((snippet) =>
        snippet.id === id
          ? {
              ...snippet,
              usageCount: snippet.usageCount + 1,
              updatedAt: new Date().toISOString(),
            }
          : snippet,
      );
    });
  },
  async deleteSnippet(id: string) {
    return call<void>("delete_snippet", { id }, () => {
      const snippet = memory.snippets.find((item) => item.id === id);
      if (snippet) {
        memory.trash.unshift({
          id,
          entityType: "snippet",
          title: snippet.text,
          deletedAt: new Date().toISOString(),
        });
      }
      memory.snippets = memory.snippets.filter((item) => item.id !== id);
    });
  },
  async listCategories() {
    return call<Category[]>("list_categories", undefined, () => {
      const model = activeModel();
      return structuredClone(
        memory.categories.filter(
          (item) => normalizePromptModelId(item.promptModel) === model,
        ),
      );
    });
  },
  async listRecipeTags() {
    return call<RecipeTag[]>("list_recipe_tags", undefined, () => {
      const model = activeModel();
      return structuredClone(
        memory.recipeTags.filter(
          (item) => normalizePromptModelId(item.promptModel) === model,
        ),
      );
    });
  },
  async saveCategory(input: Category) {
    return call<Category>("save_category", { input }, () => {
      const existing = memory.categories.find((item) => item.id === input.id);
      const category = {
        ...input,
        id: input.id || crypto.randomUUID(),
        promptModel: normalizePromptModelId(
          input.promptModel || existing?.promptModel || activeModel(),
        ),
      };
      const index = memory.categories.findIndex(
        (item) => item.id === category.id,
      );
      if (index >= 0) memory.categories[index] = category;
      else memory.categories.push(category);
      return structuredClone(category);
    });
  },
  async deleteCategory(id: string) {
    return call<void>("delete_category", { id }, () => {
      const category = memory.categories.find((item) => item.id === id);
      if (category) {
        memory.trash.unshift({
          id,
          entityType: "category",
          title: category.name,
          deletedAt: new Date().toISOString(),
        });
      }
      memory.categories = memory.categories.filter((item) => item.id !== id);
      memory.snippets = memory.snippets.map((snippet) => ({
        ...snippet,
        categoryIds: snippet.categoryIds.filter(
          (categoryId) => categoryId !== id,
        ),
      }));
    });
  },
  async listResources(resourceType?: ResourceType) {
    return call<Resource[]>(
      "list_resources",
      resourceType ? { resourceType } : undefined,
      () =>
        structuredClone(
          resourceType
            ? memory.resources.filter(
                (item) => item.resourceType === resourceType,
              )
            : memory.resources,
        ),
    );
  },
  async saveResource(input: Resource) {
    return call<Resource>("save_resource", { input }, () => {
      const resource = {
        ...input,
        id: input.id || crypto.randomUUID(),
      };
      const index = memory.resources.findIndex(
        (item) => item.id === resource.id,
      );
      if (index >= 0) memory.resources[index] = resource;
      else memory.resources.unshift(resource);
      return structuredClone(resource);
    });
  },
  async scanResources() {
    return call<ResourceScanResult>("scan_resources", undefined, async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      return {
        resources: structuredClone(memory.resources),
        scanned: memory.resources.length,
        added: 0,
        updated: 2,
        offlinePaths: memory.resources
          .filter((item) => !item.available)
          .map((item) => item.path),
      };
    });
  },
  async listDownloadLoras() {
    return call<ListDownloadLorasResult>(
      "list_download_loras",
      undefined,
      async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        const now = Date.now();
        return {
          downloadsPath: "C:\\Users\\Demo\\Downloads",
          loraPath: memory.settings.loraPath,
          recentDays: 14,
          defaultSelectHours: 6,
          candidates: [
            {
              name: "cinematic_portrait_v1",
              fileName: "cinematic_portrait_v1.safetensors",
              sourcePath:
                "C:\\Users\\Demo\\Downloads\\cinematic_portrait_v1.safetensors",
              destinationPath: `${memory.settings.loraPath}\\cinematic_portrait_v1.safetensors`,
              fileSize: 138_720_752,
              modifiedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
              alreadyExists: false,
              withinDefaultWindow: true,
              companionFiles: [],
            },
            {
              name: "older_lora_demo",
              fileName: "older_lora_demo.safetensors",
              sourcePath:
                "C:\\Users\\Demo\\Downloads\\older_lora_demo.safetensors",
              destinationPath: `${memory.settings.loraPath}\\older_lora_demo.safetensors`,
              fileSize: 80_000_000,
              modifiedAt: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
              alreadyExists: false,
              withinDefaultWindow: false,
              companionFiles: [],
            },
            {
              name: "Natural_Hand_Poses_v2",
              fileName: "Natural_Hand_Poses_v2.safetensors",
              sourcePath:
                "C:\\Users\\Demo\\Downloads\\Natural_Hand_Poses_v2.safetensors",
              destinationPath: `${memory.settings.loraPath}\\Natural_Hand_Poses_v2.safetensors`,
              fileSize: 92_552_192,
              modifiedAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
              alreadyExists: true,
              withinDefaultWindow: false,
              companionFiles: ["Natural_Hand_Poses_v2.preview.png"],
            },
          ],
        };
      },
    );
  },
  async importDownloadLoras(input: {
    sourcePaths: string[];
    overwrite?: boolean;
  }) {
    return call<ImportDownloadLorasResult>(
      "import_download_loras",
      { input },
      async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        const imported = input.sourcePaths.map((sourcePath) => {
          const fileName = sourcePath.split(/[/\\]/).pop() || sourcePath;
          const name = fileName.replace(/\.[^.]+$/, "");
          return {
            name,
            fileName,
            sourcePath,
            destinationPath: `${memory.settings.loraPath}\\${fileName}`,
          };
        });
        for (const item of imported) {
          if (
            !memory.resources.some(
              (resource) =>
                resource.path.toLowerCase() ===
                item.destinationPath.toLowerCase(),
            )
          ) {
            memory.resources.unshift({
              id: `res-import-${item.name}`,
              name: item.name,
              resourceType: "lora",
              path: item.destinationPath,
              available: true,
              triggerWords: [],
              confirmedTriggerWords: [],
              fileSize: 100_000_000,
              modifiedAt: new Date().toISOString(),
            });
          }
        }
        return {
          imported,
          skipped: [],
          failed: [],
          scan: {
            resources: structuredClone(memory.resources),
            scanned: memory.resources.length,
            added: imported.length,
            updated: 0,
            offlinePaths: [],
          },
        };
      },
    );
  },
  async listTips() {
    return call<Tip[]>("list_tips", undefined, () =>
      structuredClone(memory.tips),
    );
  },
  async saveTip(input: TipInput) {
    return call<Tip>("save_tip", { input }, () => {
      const tip = stamp(input) as Tip;
      const index = memory.tips.findIndex((item) => item.id === tip.id);
      if (index >= 0) memory.tips[index] = tip;
      else memory.tips.unshift(tip);
      return structuredClone(tip);
    });
  },
  async deleteTip(id: string) {
    return call<void>("delete_tip", { id }, () => {
      const tip = memory.tips.find((item) => item.id === id);
      if (tip) {
        memory.trash.unshift({
          id,
          entityType: "tip",
          title: tip.title,
          deletedAt: new Date().toISOString(),
        });
      }
      memory.tips = memory.tips.filter((item) => item.id !== id);
    });
  },
  async searchAll(query: string) {
    return call<SearchResult[]>("search_all", { query }, () => {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const model = activeModel();
      const results: SearchResult[] = [];
      memory.recipes.forEach((item) => {
        if (normalizePromptModelId(item.promptModel) !== model) return;
        if (
          [
            item.title,
            item.positivePrompt,
            item.positiveTranslation,
            item.modelName,
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        ) {
          results.push({
            id: item.id,
            entityType: "recipe",
            title: item.title,
            subtitle: item.positivePrompt,
          });
        }
      });
      memory.snippets.forEach((item) => {
        if (normalizePromptModelId(item.promptModel) !== model) return;
        const categoryNames = memory.categories
          .filter((category) => item.categoryIds.includes(category.id))
          .map((category) => category.name);
        if (
          [item.text, item.translation, item.notes, ...categoryNames]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        ) {
          results.push({
            id: item.id,
            entityType: "snippet",
            title: item.text,
            subtitle: item.translation,
          });
        }
      });
      memory.resources.forEach((item) => {
        if (
          [item.name, item.path, item.baseModel, ...item.triggerWords]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        ) {
          results.push({
            id: item.id,
            entityType: "resource",
            title: item.name,
            subtitle: item.resourceType === "lora" ? "LoRA" : "基础模型",
          });
        }
      });
      memory.tips.forEach((item) => {
        if (
          [item.title, item.content, item.targetName]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        ) {
          results.push({
            id: item.id,
            entityType: "tip",
            title: item.title,
            subtitle: item.content,
          });
        }
      });
      return results.slice(0, 30);
    });
  },
  async getSettings() {
    return call<AppSettings>("get_settings", undefined, () =>
      structuredClone(memory.settings),
    );
  },
  async saveSettings(input: Partial<AppSettings>) {
    return call<AppSettings>("save_settings", { input }, () => {
      const previousModel = activeModel();
      if (input.activePromptModel !== undefined) {
        memory.settings.activePromptModel = normalizePromptModelId(
          input.activePromptModel,
        );
      }
      const nextModel = activeModel();
      // Switching models must not copy the previous model's studio defaults.
      if (nextModel !== previousModel) {
        applyActiveModelDefaults();
      }
      if (input.defaultPrefix !== undefined || input.defaultNegative !== undefined) {
        const slot = memory.modelDefaults[nextModel] ?? {
          defaultPrefix: "",
          defaultNegative: "",
        };
        if (input.defaultPrefix !== undefined) {
          slot.defaultPrefix = input.defaultPrefix;
        }
        if (input.defaultNegative !== undefined) {
          slot.defaultNegative = input.defaultNegative;
        }
        memory.modelDefaults[nextModel] = slot;
      }
      memory.settings = {
        ...memory.settings,
        ...input,
        activePromptModel: nextModel,
        defaultPrefix:
          memory.modelDefaults[nextModel]?.defaultPrefix ??
          memory.settings.defaultPrefix,
        defaultNegative:
          memory.modelDefaults[nextModel]?.defaultNegative ??
          memory.settings.defaultNegative,
      };
      // Paths / privacy / translation still apply from the partial patch.
      if (input.privacyMode !== undefined)
        memory.settings.privacyMode = input.privacyMode;
      if (input.loraPath !== undefined) memory.settings.loraPath = input.loraPath;
      if (input.checkpointPath !== undefined)
        memory.settings.checkpointPath = input.checkpointPath;
      if (input.diffusionModelPath !== undefined)
        memory.settings.diffusionModelPath = input.diffusionModelPath;
      if (input.backupPath !== undefined)
        memory.settings.backupPath = input.backupPath;
      if (input.translationProvider !== undefined)
        memory.settings.translationProvider = input.translationProvider;
      if (input.translationEndpoint !== undefined)
        memory.settings.translationEndpoint = input.translationEndpoint;
      if (input.translationModel !== undefined)
        memory.settings.translationModel = input.translationModel;
      if (input.onlineTranslationEnabled !== undefined)
        memory.settings.onlineTranslationEnabled = input.onlineTranslationEnabled;
      return structuredClone(memory.settings);
    });
  },
  async importAsset(input: AssetImportInput) {
    return call<Asset>("import_asset", { input }, () => ({
      id: crypto.randomUUID(),
      name: input.name,
      mimeType: input.mimeType,
      url: `data:${input.mimeType};base64,${input.dataBase64}`,
      size: Math.round((input.dataBase64.length * 3) / 4),
      createdAt: new Date().toISOString(),
    }));
  },
  async getAssetData(id: string) {
    return call<AssetData>("get_asset_data", { id }, () => {
      throw new Error("浏览器演示模式没有持久图片对象");
    });
  },
  async detachAsset(
    entityType: "recipe" | "resource" | "snippet" | "tip",
    entityId: string,
    assetId: string,
  ) {
    return call<void>(
      "detach_asset",
      { entityType, entityId, assetId },
      () => undefined,
    );
  },
  async translateText(request: TranslationRequest) {
    return withTimeout(
      call<TranslationResponse>(
        "translate_text",
        { request },
        async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          const dictionary: Record<string, string> = {
            "best quality": "最佳质量",
            masterpiece: "杰作",
            "highly detailed": "高度细节",
            "cinematic film still": "电影胶片剧照",
            "soft lighting": "柔和光线",
            portrait: "人像",
            "looking at the camera": "看向镜头",
          };
          const translated = request.text
            .split(/([,，;；\n])/)
            .map((part) => dictionary[part.trim().toLowerCase()] ?? part)
            .join("");
          return {
            text:
              translated === request.text
                ? "待翻译 · 请在设置中配置本地翻译服务"
                : translated,
            cached: false,
          };
        },
      ),
      TRANSLATION_UI_TIMEOUT_MS,
      "翻译服务超过 100 秒仍未响应，已停止等待。请在设置中测试 API 地址、模型和密钥。",
    );
  },
  async saveTranslationApiKey(
    provider: Exclude<TranslationProvider, "off">,
    apiKey: string,
  ) {
    return call<void>(
      "save_translation_api_key",
      { provider, apiKey },
      () => {
        browserTranslationCredentialConfigured = Boolean(apiKey);
      },
    );
  },
  async hasTranslationApiKey(provider: Exclude<TranslationProvider, "off">) {
    return call<boolean>(
      "has_translation_api_key",
      { provider },
      () => browserTranslationCredentialConfigured,
    );
  },
  async importGlossaryCsv(csvText: string) {
    return call<number>("import_glossary_csv", { csvText }, () =>
      csvText
        .split(/\r?\n/)
        .filter((line) => line.trim() && line.split(",").length >= 2).length,
    );
  },
  async listTrash() {
    return call<TrashItem[]>("list_trash", undefined, () =>
      structuredClone(memory.trash),
    );
  },
  async restoreItem(entityType: TrashItem["entityType"], id: string) {
    return call<void>("restore_item", { entityType, id }, () => {
      memory.trash = memory.trash.filter(
        (item) => !(item.id === id && item.entityType === entityType),
      );
    });
  },
  async purgeItem(entityType: TrashItem["entityType"], id: string) {
    return call<void>("purge_item", { entityType, id }, () => {
      memory.trash = memory.trash.filter(
        (item) => !(item.id === id && item.entityType === entityType),
      );
    });
  },
  async emptyTrash() {
    return call<number>("empty_trash", undefined, () => {
      const count = memory.trash.length;
      memory.trash = [];
      return count;
    });
  },
  async garbageCollectAssets() {
    return call<number>("garbage_collect_assets", undefined, () => 0);
  },
  async listRevisions(
    entityType: Revision["entityType"],
    entityId: string,
  ) {
    return call<Revision[]>(
      "list_revisions",
      { entityType, entityId },
      () => [],
    );
  },
  async createBackup() {
    return call<BackupSnapshot>("create_backup", undefined, async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const backup: BackupSnapshot = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        size: 3_428_344,
        status: "valid",
        location: memory.settings.backupPath || "尚未选择异盘位置（演示快照）",
      };
      memory.backups.unshift(backup);
      return backup;
    });
  },
  async listBackups() {
    return call<BackupSnapshot[]>("list_backups", undefined, () =>
      structuredClone(memory.backups),
    );
  },
  async restoreBackup(id: string) {
    return call<void>("restore_backup", { id }, () => undefined);
  },
  async importPromptVault(packagePath: string, backupPath?: string) {
    return call<BackupSnapshot>(
      "import_promptvault",
      { packagePath, backupPath },
      () => ({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        size: 0,
        status: "valid",
        location: packagePath,
      }),
    );
  },
  async exportData(format: "promptnook" | "json" | "csv", targetPath?: string) {
    return call<string>("export_data", { format, targetPath }, () =>
      Promise.resolve(`演示模式：已准备 ${format.toUpperCase()} 导出`),
    );
  },
  async loadAll(): Promise<AppData> {
    const [
      dashboard,
      recipes,
      snippets,
      categories,
      recipeTags,
      resources,
      tips,
      settings,
    ] = await Promise.all([
      this.getDashboard(),
      this.listRecipes(),
      this.listSnippets(),
      this.listCategories(),
      this.listRecipeTags(),
      this.listResources(),
      this.listTips(),
      this.getSettings(),
    ]);
    return {
      dashboard,
      recipes,
      snippets,
      categories,
      recipeTags,
      resources,
      tips,
      settings,
    };
  },
};

export function isDesktopRuntime() {
  return isTauriRuntime();
}

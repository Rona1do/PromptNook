import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeInput,
  SnippetInput,
  TipInput,
} from "../types";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

type BrowserApi = typeof import("./api").api;

let api: BrowserApi;
let isDesktopRuntime: typeof import("./api").isDesktopRuntime;
let withTimeout: typeof import("./api").withTimeout;

function makeRecipe(
  overrides: Partial<RecipeInput> = {},
): RecipeInput {
  return {
    id: "recipe-browser-test",
    title: "海边逆光人像",
    status: "draft",
    modality: "text_to_image",
    positivePrompt: "portrait, backlight, seaside",
    positiveTranslation: "人像，逆光，海边",
    negativePrompt: "blurry",
    negativeTranslation: "模糊",
    modelId: "model-flux",
    modelName: "FLUX.1-dev-fp8",
    loras: [],
    params: {
      width: 1024,
      height: 1024,
      sampler: "euler",
      scheduler: "simple",
      steps: 24,
      cfg: 3.5,
      seed: "42",
    },
    assets: [],
    tagIds: [],
    notes: "浏览器回退测试",
    favorite: false,
    rating: 4,
    usageCount: 0,
    ...overrides,
  };
}

function makeSnippet(
  overrides: Partial<SnippetInput> = {},
): SnippetInput {
  return {
    id: "snippet-browser-test",
    text: "standing by the sea at sunset",
    translation: "日落时站在海边",
    notes: "适合逆光人像",
    categoryIds: ["cat-pose", "cat-scene"],
    favorite: false,
    translationLocked: true,
    ...overrides,
  };
}

function makeTip(overrides: Partial<TipInput> = {}): TipInput {
  return {
    id: "tip-browser-test",
    title: "先检查主体轮廓",
    content: "逆光场景先确认主体轮廓清晰，再增加环境细节。",
    scope: "global",
    favorite: false,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  invokeMock.mockReset();
  window.localStorage.clear();
  delete (
    window as Window & {
      __TAURI_INTERNALS__?: unknown;
    }
  ).__TAURI_INTERNALS__;

  ({ api, isDesktopRuntime, withTimeout } = await import("./api"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("browser fallback bootstrap", () => {
  it("loads a complete, internally consistent initial snapshot without Tauri", async () => {
    const data = await api.loadAll();

    expect(isDesktopRuntime()).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(data.dashboard).toMatchObject({
      recipeCount: data.recipes.length,
      snippetCount: data.snippets.length,
      resourceCount: data.resources.length,
      favoriteCount:
        data.recipes.filter((item) => item.favorite).length +
        data.snippets.filter((item) => item.favorite).length +
        data.tips.filter((item) => item.favorite).length,
      backupHealthy: false,
      resourcePathsOnline: true,
    });
    expect(data.recipes).toHaveLength(3);
    expect(data.snippets).toHaveLength(7);
    expect(data.categories).toHaveLength(10);
    expect(data.resources).toHaveLength(5);
    expect(data.tips).toHaveLength(3);
    expect(data.settings.loraPath).toBe(
      "C:\\AI\\ComfyUI\\models\\loras",
    );

    data.recipes[0].title = "不应写回内存";
    expect((await api.listRecipes())[0].title).not.toBe("不应写回内存");
  });

  it("never hides a desktop IPC failure behind the browser workspace", async () => {
    (
      window as Window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__ = {};
    invokeMock.mockRejectedValueOnce(new Error("unknown command: save_recipe"));

    await expect(api.saveRecipe(makeRecipe())).rejects.toThrow(
      "unknown command: save_recipe",
    );
    expect(isDesktopRuntime()).toBe(true);
  });

  it("downloads a real ComfyUI workflow in the browser and still uses desktop IPC", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:promptnook-workflow");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    await expect(api.exportComfyUiWorkflow("recipe-rain")).resolves.toEqual({
      path: "neon-street-in-the-rain.comfyui.json",
      warnings: [],
      format: "ComfyUI Workflow JSON 0.4",
    });
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();

    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();

    (
      window as Window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__ = {};
    const result = {
      path: "C:\\Exports\\Morning-window-portrait.comfyui.json",
      warnings: [],
      format: "ComfyUI Workflow JSON 0.4",
    };
    invokeMock.mockResolvedValueOnce(result);

    await expect(
      api.exportComfyUiWorkflow("recipe-window", result.path),
    ).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("export_comfyui_workflow", {
      recipeId: "recipe-window",
      targetPath: result.path,
    });
  });

  it("restores browser workspace changes after a reload", async () => {
    await api.saveRecipe(makeRecipe({ title: "Persistent browser recipe" }));

    vi.resetModules();
    ({ api } = await import("./api"));

    expect(
      (await api.listRecipes()).some(
        (recipe) => recipe.title === "Persistent browser recipe",
      ),
    ).toBe(true);
  });
});

describe("recipe, snippet, and tip CRUD", () => {
  it("creates, updates, lists, and deletes a recipe", async () => {
    const initialCount = (await api.listRecipes()).length;
    const created = await api.saveRecipe(makeRecipe());

    expect(created).toMatchObject({
      id: "recipe-browser-test",
      title: "海边逆光人像",
      usageCount: 0,
    });
    expect(created.createdAt).toEqual(expect.any(String));
    expect(created.updatedAt).toEqual(expect.any(String));
    expect(await api.listRecipes()).toHaveLength(initialCount + 1);

    const updated = await api.saveRecipe({
      ...created,
      title: "海边逆光人像（精选）",
      status: "reproducible",
      favorite: true,
    });
    const matchingRecipes = (await api.listRecipes()).filter(
      (recipe) => recipe.id === created.id,
    );

    expect(updated).toMatchObject({
      title: "海边逆光人像（精选）",
      status: "reproducible",
      favorite: true,
      createdAt: created.createdAt,
    });
    expect(matchingRecipes).toHaveLength(1);
    expect(matchingRecipes[0].title).toBe("海边逆光人像（精选）");

    await api.deleteRecipe(created.id);

    expect(await api.listRecipes()).toHaveLength(initialCount);
    expect((await api.listRecipes()).some(({ id }) => id === created.id)).toBe(
      false,
    );
  });

  it("persists an automatic recipe title when the browser fallback receives a blank title", async () => {
    const fromPrompt = await api.saveRecipe(
      makeRecipe({
        id: "recipe-auto-title",
        title: "",
        positivePrompt: "(portrait, close-up:1.2), golden hour",
      }),
    );
    expect(fromPrompt.title).toBe("(portrait, close-up:1.2)");

    const withoutPrompt = await api.saveRecipe(
      makeRecipe({
        id: "recipe-auto-date-title",
        title: "",
        positivePrompt: "",
      }),
    );
    expect(withoutPrompt.title).toMatch(/^Untitled recipe · \d{4}-\d{2}-\d{2}$/);
  });

  it("creates, updates, lists, and deletes a bilingual snippet", async () => {
    const initialCount = (await api.listSnippets()).length;
    const created = await api.saveSnippet(makeSnippet());

    expect(created).toMatchObject({
      id: "snippet-browser-test",
      text: "standing by the sea at sunset",
      translation: "日落时站在海边",
      usageCount: 0,
      translationLocked: true,
    });
    expect(await api.listSnippets()).toHaveLength(initialCount + 1);

    const updated = await api.saveSnippet({
      ...created,
      translation: "黄昏时站在海边",
      favorite: true,
      usageCount: 3,
    });
    const matchingSnippets = (await api.listSnippets()).filter(
      (snippet) => snippet.id === created.id,
    );

    expect(updated).toMatchObject({
      translation: "黄昏时站在海边",
      favorite: true,
      usageCount: 3,
    });
    expect(matchingSnippets).toHaveLength(1);
    expect(matchingSnippets[0].translation).toBe("黄昏时站在海边");

    await api.deleteSnippet(created.id);

    expect(await api.listSnippets()).toHaveLength(initialCount);
    expect((await api.listSnippets()).some(({ id }) => id === created.id)).toBe(
      false,
    );
  });

  it("creates, updates, lists, and deletes a scoped tip", async () => {
    const initialCount = (await api.listTips()).length;
    const created = await api.saveTip(makeTip());

    expect(created).toMatchObject({
      id: "tip-browser-test",
      title: "先检查主体轮廓",
      scope: "global",
      favorite: false,
    });
    expect(await api.listTips()).toHaveLength(initialCount + 1);

    const updated = await api.saveTip({
      ...created,
      title: "逆光场景先检查主体轮廓",
      scope: "model",
      targetId: "model-flux",
      targetName: "FLUX.1-dev-fp8",
      favorite: true,
    });
    const matchingTips = (await api.listTips()).filter(
      (tip) => tip.id === created.id,
    );

    expect(updated).toMatchObject({
      title: "逆光场景先检查主体轮廓",
      scope: "model",
      targetId: "model-flux",
      favorite: true,
    });
    expect(matchingTips).toHaveLength(1);

    await api.deleteTip(created.id);

    expect(await api.listTips()).toHaveLength(initialCount);
    expect((await api.listTips()).some(({ id }) => id === created.id)).toBe(
      false,
    );
  });
});

describe("search and translation fallback", () => {
  it("stops waiting when a translation promise exceeds its deadline", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(
      new Promise<string>(() => undefined),
      1_000,
      "翻译请求超时",
    );
    const assertion = expect(pending).rejects.toThrow("翻译请求超时");

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it("passes unsaved Google-compatible test settings to desktop IPC", async () => {
    (
      window as Window & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__ = {};
    invokeMock.mockResolvedValueOnce({ text: "柔和光线", cached: false });
    const request = {
      text: "soft lighting",
      targetLanguage: "zh-CN",
      provider: "openai" as const,
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.1-flash-lite",
      apiKey: "test-only-key",
      testConnection: true,
    };

    await expect(api.translateText(request)).resolves.toEqual({
      text: "柔和光线",
      cached: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("translate_text", { request });
  });

  it("searches translated recipe text, snippet translations/categories, and tips", async () => {
    await api.saveSnippet(makeSnippet());

    const recipeResults = await api.searchAll("清晨柔光");
    const translationResults = await api.searchAll("日落时");
    const categoryResults = await api.searchAll("Subject");
    const tipResults = await api.searchAll("weight");

    expect(recipeResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "recipe-window",
          entityType: "recipe",
        }),
      ]),
    );
    expect(translationResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "snippet-browser-test",
          entityType: "snippet",
        }),
      ]),
    );
    expect(categoryResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "snippet-vsign",
          entityType: "snippet",
        }),
      ]),
    );
    expect(tipResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tip-lora-1",
          entityType: "tip",
        }),
      ]),
    );
    expect(await api.searchAll("   ")).toEqual([]);
  });

  it("uses the built-in dictionary, preserves delimiters, and reports uncached results", async () => {
    vi.useFakeTimers();
    const source =
      "masterpiece, best quality，portrait;soft lighting\nlooking at the camera";

    const firstPromise = api.translateText({ text: source });
    await vi.advanceTimersByTimeAsync(350);
    const first = await firstPromise;

    expect(first).toEqual({
      text: "杰作,最佳质量，人像;柔和光线\n看向镜头",
      cached: false,
    });

    const repeatedPromise = api.translateText({ text: source });
    await vi.advanceTimersByTimeAsync(350);
    const repeated = await repeatedPromise;

    expect(repeated.text).toBe(first.text);
    expect(repeated.cached).toBe(false);

    const unknownPromise = api.translateText({
      text: "an untranslated browser fallback phrase",
    });
    await vi.advanceTimersByTimeAsync(350);

    await expect(unknownPromise).resolves.toEqual({
      text: "Pending translation · Configure a translation service in Settings",
      cached: false,
    });
  });
});

describe("trash and restore index", () => {
  it("adds deleted entities to trash and removes the matching entry on restore", async () => {
    await api.saveRecipe(makeRecipe());
    await api.saveSnippet(makeSnippet());
    await api.saveTip(makeTip());

    await api.deleteRecipe("recipe-browser-test");
    await api.deleteSnippet("snippet-browser-test");
    await api.deleteTip("tip-browser-test");

    expect(await api.listTrash()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "recipe-browser-test",
          entityType: "recipe",
          title: "海边逆光人像",
        }),
        expect.objectContaining({
          id: "snippet-browser-test",
          entityType: "snippet",
          title: "standing by the sea at sunset",
        }),
        expect.objectContaining({
          id: "tip-browser-test",
          entityType: "tip",
          title: "先检查主体轮廓",
        }),
      ]),
    );

    await api.restoreItem("snippet", "snippet-browser-test");

    expect(
      (await api.listTrash()).some(
        ({ id, entityType }) =>
          id === "snippet-browser-test" && entityType === "snippet",
      ),
    ).toBe(false);
    expect(
      (await api.listTrash()).some(
        ({ id, entityType }) =>
          id === "recipe-browser-test" && entityType === "recipe",
      ),
    ).toBe(true);
  });
});

describe("resource scanning", () => {
  it("filters resources and reports scanned, updated, and offline paths", async () => {
    const loras = await api.listResources("lora");

    expect(loras).toHaveLength(3);
    expect(loras.every(({ resourceType }) => resourceType === "lora")).toBe(
      true,
    );

    vi.useFakeTimers();
    const scanPromise = api.scanResources();
    await vi.advanceTimersByTimeAsync(700);
    const scan = await scanPromise;

    expect(scan).toMatchObject({
      scanned: 5,
      added: 0,
      updated: 2,
    });
    expect(scan.resources).toHaveLength(5);
    expect(scan.offlinePaths).toEqual([
      "C:\\AI\\ComfyUI\\models\\loras\\archive\\soft_light.safetensors",
    ]);

    scan.resources[0].name = "不应写回资源缓存";
    expect((await api.listResources())[0].name).not.toBe("不应写回资源缓存");
  });
});

describe("settings and backup fallback", () => {
  it("persists cloned settings and exposes a newly created backup in dashboard state", async () => {
    const defaults = await api.getSettings();
    const saved = await api.saveSettings({
      ...defaults,
      privacyMode: true,
      backupPath: "D:\\PromptNookBackups",
      translationProvider: "ollama",
      translationModel: "qwen2.5:7b",
      onlineTranslationEnabled: true,
    });

    expect(saved).toMatchObject({
      privacyMode: true,
      backupPath: "D:\\PromptNookBackups",
      translationProvider: "ollama",
      translationModel: "qwen2.5:7b",
      onlineTranslationEnabled: true,
    });
    saved.backupPath = "X:\\mutated-return-value";
    expect((await api.getSettings()).backupPath).toBe(
      "D:\\PromptNookBackups",
    );
    expect(await api.getDashboard()).toMatchObject({
      backupHealthy: true,
      lastBackupAt: undefined,
    });

    vi.useFakeTimers();
    const backupPromise = api.createBackup();
    await vi.advanceTimersByTimeAsync(500);
    const backup = await backupPromise;
    const backups = await api.listBackups();

    expect(backup).toMatchObject({
      status: "valid",
      size: 3_428_344,
      location: "D:\\PromptNookBackups",
    });
    expect(backups).toHaveLength(1);
    expect(backups[0]).toEqual(backup);
    expect(await api.getDashboard()).toMatchObject({
      backupHealthy: true,
      lastBackupAt: backup.createdAt,
    });

    await expect(api.restoreBackup(backup.id)).resolves.toBeUndefined();
    await expect(api.exportData("json")).resolves.toBe(
      "Demo mode: JSON export prepared",
    );
  });

  it("isolates recipes, snippets, and studio defaults per custom workspace", async () => {
    const generalRecipes = await api.listRecipes();
    const generalSnippets = await api.listSnippets();
    expect(generalRecipes.length).toBeGreaterThan(0);
    expect(generalSnippets.length).toBeGreaterThan(0);

    await api.saveSettings({
      promptModels: [
        { id: "general", name: "General", description: "General prompts" },
        { id: "portrait", name: "Portrait", description: "Portrait workflows" },
        { id: "product", name: "Product", description: "Product workflows" },
      ],
    });

    await api.saveSettings({
      activePromptModel: "portrait",
    });
    expect((await api.getSettings()).activePromptModel).toBe("portrait");
    expect((await api.listRecipes()).map((item) => item.id)).toEqual([]);
    expect((await api.listSnippets()).map((item) => item.id)).toEqual([]);
    expect(await api.listRecipeTags()).toEqual([]);

    const saved = await api.saveRecipe(
      makeRecipe({
        id: "recipe-portrait-only",
        title: "Portrait only",
        promptModel: "portrait",
      }),
    );
    expect(saved.promptModel).toBe("portrait");
    expect((await api.listRecipes()).map((item) => item.id)).toEqual([
      "recipe-portrait-only",
    ]);

    await api.saveSettings({
      activePromptModel: "portrait",
      defaultPrefix: "portrait prefix unique",
    });
    expect((await api.getSettings()).defaultPrefix).toBe(
      "portrait prefix unique",
    );

    await api.saveSettings({ activePromptModel: "general" });
    const generalSettings = await api.getSettings();
    expect(generalSettings.activePromptModel).toBe("general");
    expect(generalSettings.defaultPrefix).not.toBe("portrait prefix unique");
    expect(
      (await api.listRecipes()).some(
        (item) => item.id === "recipe-portrait-only",
      ),
    ).toBe(false);
    expect((await api.listRecipes()).length).toBe(generalRecipes.length);

    await api.saveSettings({ activePromptModel: "product" });
    expect((await api.getSettings()).activePromptModel).toBe("product");
    expect((await api.listRecipes()).map((item) => item.id)).toEqual([]);
    expect((await api.listSnippets()).map((item) => item.id)).toEqual([]);
    expect(await api.listRecipeTags()).toEqual([]);

    const productRecipe = await api.saveRecipe(
      makeRecipe({
        id: "recipe-product-only",
        title: "Product only",
        promptModel: "product",
      }),
    );
    expect(productRecipe.promptModel).toBe("product");
    expect((await api.listRecipes()).map((item) => item.id)).toEqual([
      "recipe-product-only",
    ]);

    await api.saveSettings({
      activePromptModel: "product",
      defaultPrefix: "product prefix unique",
    });
    expect((await api.getSettings()).defaultPrefix).toBe("product prefix unique");

    await api.saveSettings({ activePromptModel: "portrait" });
    expect((await api.getSettings()).defaultPrefix).toBe(
      "portrait prefix unique",
    );
    expect(
      (await api.listRecipes()).some((item) => item.id === "recipe-product-only"),
    ).toBe(false);

    await api.saveSettings({ activePromptModel: "general" });
    expect((await api.listRecipes()).length).toBe(generalRecipes.length);
  });
});

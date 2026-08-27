import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Dice5,
  FileText,
  GripVertical,
  Layers3,
  Lightbulb,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import {
  dedupePromptValues,
  joinPromptSegments,
  parsePrompt,
  updateSegmentWeight,
} from "../lib/promptParser";
import type {
  AppSettings,
  Category,
  GenerationParams,
  Recipe,
  RecipeInput,
  RecipeLora,
  Resource,
  Snippet,
  Tip,
} from "../types";
import { readableError } from "../lib/errors";
import {
  defaultGenerationParamsForNew,
  saveLastGenerationParams,
} from "../lib/lastGenerationParams";
import { deriveRecipeTitle } from "../lib/recipeTitle";
import { Badge, Button, EmptyState, Field, IconButton, Select } from "./ui";

interface StudioItem {
  id: string;
  text: string;
  translation: string;
  locked: boolean;
  source: "prefix" | "snippet" | "inspiration" | "trigger";
  sourceId?: string;
  categoryIds: string[];
}

const EMPTY_GENERATION_PARAMS: GenerationParams = {
  width: null,
  height: null,
  sampler: null,
  scheduler: null,
  steps: null,
  cfg: null,
  seed: null,
};

const RECOMMENDED_GENERATION_PARAMS: GenerationParams = {
  width: 1024,
  height: 1024,
  sampler: "euler",
  scheduler: "simple",
  steps: 28,
  cfg: 3.5,
  seed: "-1",
};

const SAMPLERS = [
  "euler",
  "euler_ancestral",
  "dpmpp_2m",
  "dpmpp_2m_sde",
  "dpmpp_3m_sde",
  "dpmpp_sde",
  "uni_pc",
];

const SCHEDULERS = [
  "simple",
  "normal",
  "karras",
  "exponential",
  "sgm_uniform",
  "beta",
];

function normalizeLoraOrder(loras: RecipeLora[]) {
  return loras.map((lora, order) => ({ ...lora, order }));
}

function resourceMatches(resource: Resource, query: string) {
  const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
  if (!needle) return true;
  return [
    resource.name,
    resource.path,
    resource.baseModel,
    ...resource.triggerWords,
    ...resource.confirmedTriggerWords,
  ]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .includes(needle);
}

function pickInspirationCandidates(pool: Snippet[]) {
  const addUnique = (target: Snippet[], snippet: Snippet | undefined) => {
    if (snippet && !target.some((item) => item.id === snippet.id)) {
      target.push(snippet);
    }
  };
  const pickFromTop = (values: Snippet[]) => {
    const windowSize = Math.max(1, Math.min(values.length, Math.ceil(values.length / 3)));
    return values[Math.floor(Math.random() * windowSize)];
  };
  const popular = [...pool].sort((a, b) => {
    const scoreA = a.usageCount + (a.favorite ? 5 : 0);
    const scoreB = b.usageCount + (b.favorite ? 5 : 0);
    return scoreB - scoreA || a.text.localeCompare(b.text);
  });
  const underused = [...pool].sort((a, b) => {
    const usageDifference = a.usageCount - b.usageCount;
    if (usageDifference) return usageDifference;
    return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  });
  const discovery = [...pool].sort(() => Math.random() - 0.5);
  const prioritized: Snippet[] = [];

  addUnique(prioritized, pickFromTop(popular));
  addUnique(prioritized, pickFromTop(underused));
  addUnique(prioritized, pickFromTop(discovery));

  const length = Math.max(popular.length, underused.length);
  for (let index = 0; index < length; index += 1) {
    addUnique(prioritized, popular[index]);
    addUnique(prioritized, underused[index]);
  }
  discovery.forEach((snippet) => addUnique(prioritized, snippet));
  return prioritized;
}

function itemsFromText(
  text: string,
  translation: string,
  source: StudioItem["source"],
  sourceId?: string,
  categoryIds: string[] = [],
): StudioItem[] {
  const parsed = parsePrompt(text);
  const translated = parsePrompt(translation);
  return parsed.chips.map((chip, index) => ({
    id: crypto.randomUUID(),
    text: chip.value,
    translation: translated.chips[index]?.value ?? "",
    locked: source === "prefix",
    source,
    sourceId,
    categoryIds,
  }));
}

function formatPrompt(items: StudioItem[], triggers: string[]) {
  const values = dedupePromptValues([
    ...items.map((item) => item.text),
    ...triggers,
  ]);
  const source = values.join(", ");
  const parsed = parsePrompt(source);
  return joinPromptSegments(parsed.segments);
}

export function StudioPage({
  snippets,
  categories,
  recipes,
  resources,
  tips,
  settings,
  queuedSnippet,
  onQueuedSnippetConsumed,
  onSaveRecipe,
  onSnippetUsed,
  onToast,
}: {
  snippets: Snippet[];
  categories: Category[];
  recipes: Recipe[];
  resources: Resource[];
  tips: Tip[];
  settings: AppSettings;
  queuedSnippet?: Snippet;
  onQueuedSnippetConsumed: () => void;
  onSaveRecipe: (recipe: RecipeInput) => Promise<void>;
  onSnippetUsed: (id: string) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [items, setItems] = useState<StudioItem[]>(() =>
    itemsFromText(settings.defaultPrefix, "", "prefix"),
  );
  const [negativePrompt, setNegativePrompt] = useState(settings.defaultNegative);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryCategory, setLibraryCategory] = useState("all");
  const [libraryMode, setLibraryMode] = useState<"snippets" | "recipes">(
    "snippets",
  );
  const [selectedModelId, setSelectedModelId] = useState("");
  const [selectedLoras, setSelectedLoras] = useState<RecipeLora[]>([]);
  const [generationParams, setGenerationParams] = useState<GenerationParams>(
    () => defaultGenerationParamsForNew(),
  );
  const [modelQuery, setModelQuery] = useState("");
  const [loraQuery, setLoraQuery] = useState("");
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [inspirationCategories, setInspirationCategories] = useState<string[]>(
    [],
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recipeTitle, setRecipeTitle] = useState("");
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const queuedRef = useRef<string | null>(null);

  const models = resources.filter((item) => item.resourceType !== "lora");
  const loras = resources.filter((item) => item.resourceType === "lora");
  const selectedModel = models.find((item) => item.id === selectedModelId);
  const filteredModels = useMemo(() => {
    const matches = models.filter((model) => resourceMatches(model, modelQuery));
    const selected = models.find((model) => model.id === selectedModelId);
    if (selected && !matches.some((model) => model.id === selected.id)) {
      return [selected, ...matches];
    }
    return matches;
  }, [modelQuery, models, selectedModelId]);
  const displayedLoras = useMemo(() => {
    const selectedOrder = new Map(
      selectedLoras.map((lora, index) => [lora.resourceId, index]),
    );
    return loras
      .filter((lora) => resourceMatches(lora, loraQuery))
      .sort((a, b) => {
        const orderA = selectedOrder.get(a.id);
        const orderB = selectedOrder.get(b.id);
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
        if (orderA !== undefined) return -1;
        if (orderB !== undefined) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [loraQuery, loras, selectedLoras]);

  useEffect(() => {
    if (!queuedSnippet) {
      queuedRef.current = null;
      return;
    }
    if (queuedRef.current === queuedSnippet.id) return;
    queuedRef.current = queuedSnippet.id;
    addSnippet(queuedSnippet);
    onQueuedSnippetConsumed();
  }, [queuedSnippet]);

  const activeTriggers = useMemo(
    () =>
      dedupePromptValues(
        selectedLoras.flatMap((lora) => lora.enabledTriggerWords),
      ),
    [selectedLoras],
  );

  const output = useMemo(
    () => formatPrompt(items, activeTriggers),
    [activeTriggers, items],
  );

  const canSaveReproducible = Boolean(
    selectedModelId &&
      output.trim() &&
      generationParams.width &&
      generationParams.height &&
      generationParams.sampler &&
      (generationParams.steps ?? 0) > 0 &&
      (generationParams.cfg ?? 0) > 0,
  );

  useEffect(() => {
    setSaveError((current) => (current ? "" : current));
  }, [
    generationParams.cfg,
    generationParams.height,
    generationParams.sampler,
    generationParams.steps,
    generationParams.width,
    output,
    recipeTitle,
    selectedModelId,
  ]);

  const outputTranslation = useMemo(
    () =>
      dedupePromptValues(
        items.map((item) => item.translation).filter(Boolean),
      ).join("，"),
    [items],
  );

  const visibleLibrary = useMemo(() => {
    const needle = libraryQuery.trim().toLowerCase();
    return snippets
      .filter(
        (snippet) =>
          (libraryCategory === "all" ||
            snippet.categoryIds.includes(libraryCategory)) &&
          (!needle ||
            [snippet.text, snippet.translation]
              .join(" ")
              .toLowerCase()
              .includes(needle)),
      )
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
        return b.usageCount - a.usageCount;
      });
  }, [libraryCategory, libraryQuery, snippets]);

  const contextualTips = useMemo(
    () =>
      tips.filter(
        (tip) =>
          tip.scope === "global" ||
          (tip.scope === "model" && tip.targetId === selectedModelId) ||
          (tip.scope === "lora" &&
            selectedLoras.some((lora) => lora.resourceId === tip.targetId)) ||
          (tip.scope === "category" &&
            items.some((item) => item.categoryIds.includes(tip.targetId ?? ""))),
      ),
    [items, selectedLoras, selectedModelId, tips],
  );

  function addSnippet(snippet: Snippet) {
    const next = itemsFromText(
      snippet.text,
      snippet.translation,
      "snippet",
      snippet.id,
      snippet.categoryIds,
    );
    const normalized = new Set(
      items.map((item) => item.text.trim().toLocaleLowerCase()),
    );
    const unique = next.filter((item) => {
      const key = item.text.trim().toLocaleLowerCase();
      if (normalized.has(key)) return false;
      normalized.add(key);
      return true;
    });
    if (!unique.length) {
      onToast("这个词条已经在画布中");
      return;
    }
    setItems((current) => [...current, ...unique]);
    void onSnippetUsed(snippet.id);
  }

  function loadRecipe(recipe: Recipe) {
    const displayTitle = deriveRecipeTitle(
      recipe.title,
      recipe.positivePrompt,
      recipe.updatedAt,
    );
    const next = itemsFromText(
      recipe.positivePrompt,
      recipe.positiveTranslation,
      "snippet",
      recipe.id,
    );
    setItems(next);
    setNegativePrompt(recipe.negativePrompt);
    setSelectedModelId(recipe.modelId ?? "");
    setSelectedLoras(
      normalizeLoraOrder(
        structuredClone(recipe.loras).sort((a, b) => a.order - b.order),
      ),
    );
    setGenerationParams({ ...recipe.params });
    setRecipeTitle(`${displayTitle} · 新版本`);
    onToast(`已载入“${displayTitle}”作为创作底稿`);
  }

  function dropItem(targetId: string) {
    if (!dragId || dragId === targetId) return;
    setItems((current) => {
      const next = [...current];
      const from = next.findIndex((item) => item.id === dragId);
      const to = next.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragId(null);
  }

  function moveItem(id: string, direction: -1 | 1) {
    setItems((current) => {
      const from = current.findIndex((item) => item.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function updateItem(id: string, patch: Partial<StudioItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function applyWeight(item: StudioItem, value: string) {
    const parsed = parsePrompt(item.text);
    if (!parsed.segments.length) return;
    const weight = value === "" ? null : Number(value);
    try {
      const weighted = updateSegmentWeight(parsed.segments, 0, weight);
      updateItem(item.id, { text: joinPromptSegments(weighted) });
    } catch {
      onToast("权重格式无效");
    }
  }

  function toggleLora(resource: Resource) {
    setSelectedLoras((current) => {
      const existing = current.find(
        (item) => item.resourceId === resource.id,
      );
      if (existing) {
        return normalizeLoraOrder(
          current.filter((item) => item.resourceId !== resource.id),
        );
      }
      const triggerWords = dedupePromptValues([
        ...resource.triggerWords,
        ...resource.confirmedTriggerWords,
      ]);
      return [
        ...current,
        {
          resourceId: resource.id,
          name: resource.name,
          modelStrength: 1,
          clipStrength: 1,
          order: current.length,
          triggerWords,
          enabledTriggerWords: dedupePromptValues(
            resource.confirmedTriggerWords,
          ),
        },
      ];
    });
  }

  function toggleTrigger(resourceId: string, trigger: string) {
    setSelectedLoras((current) =>
      current.map((lora) => {
        if (lora.resourceId !== resourceId) return lora;
        const normalizedTrigger = trigger.trim().toLocaleLowerCase();
        const enabled = lora.enabledTriggerWords.some(
          (word) => word.trim().toLocaleLowerCase() === normalizedTrigger,
        );
        return {
          ...lora,
          enabledTriggerWords: enabled
            ? lora.enabledTriggerWords.filter(
                (word) =>
                  word.trim().toLocaleLowerCase() !== normalizedTrigger,
              )
            : dedupePromptValues([...lora.enabledTriggerWords, trigger]),
        };
      }),
    );
  }

  function updateLora(
    resourceId: string,
    patch: Partial<Pick<RecipeLora, "modelStrength" | "clipStrength">>,
  ) {
    setSelectedLoras((current) =>
      current.map((lora) =>
        lora.resourceId === resourceId ? { ...lora, ...patch } : lora,
      ),
    );
  }

  function moveLora(resourceId: string, direction: -1 | 1) {
    setSelectedLoras((current) => {
      const from = current.findIndex((lora) => lora.resourceId === resourceId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return normalizeLoraOrder(next);
    });
  }

  function updateGenerationParam<Key extends keyof GenerationParams>(
    key: Key,
    value: GenerationParams[Key],
  ) {
    setGenerationParams((current) => ({ ...current, [key]: value }));
  }

  function rerollInspiration() {
    const pool = snippets.filter(
      (snippet) =>
        inspirationCategories.length === 0 ||
        snippet.categoryIds.some((id) => inspirationCategories.includes(id)),
    );
    if (!pool.length) {
      onToast("所选分类还没有可用词条");
      return;
    }
    const keep = items.filter(
      (item) => item.source !== "inspiration" || item.locked,
    );
    const used = new Set(
      keep.map((item) => item.text.trim().toLowerCase()),
    );
    const candidates = pickInspirationCandidates(pool);
    const picked: StudioItem[] = [];
    const usedSnippetIds = new Set<string>();
    for (const snippet of candidates) {
      const generated = itemsFromText(
        snippet.text,
        snippet.translation,
        "inspiration",
        snippet.id,
        snippet.categoryIds,
      );
      for (const item of generated) {
        const key = item.text.trim().toLowerCase();
        if (!used.has(key) && picked.length < 3) {
          used.add(key);
          picked.push(item);
          usedSnippetIds.add(snippet.id);
          break;
        }
      }
      if (picked.length >= 3) break;
    }
    setItems([...keep, ...picked]);
    usedSnippetIds.forEach((id) => void onSnippetUsed(id));
    onToast(`已换入 ${picked.length} 个新灵感，固定项保持不变`);
  }

  async function saveRecipe() {
    setSaveError("");
    if (!output.trim()) {
      const message = "画布还是空的";
      setSaveError(message);
      onToast(message);
      return;
    }
    setSaving(true);
    try {
      await onSaveRecipe({
        id: "",
        title: recipeTitle.trim(),
        status: canSaveReproducible ? "reproducible" : "draft",
        modality: "text_to_image",
        positivePrompt: output,
        positiveTranslation: outputTranslation,
        negativePrompt,
        negativeTranslation: "",
        modelId: selectedModelId || undefined,
        modelName: selectedModel?.name,
        loras: normalizeLoraOrder(
          selectedLoras.map((selected) => {
            const resource = loras.find(
              (candidate) => candidate.id === selected.resourceId,
            );
            return {
              ...selected,
              triggerWords: dedupePromptValues([
                ...selected.triggerWords,
                ...(resource?.triggerWords ?? []),
                ...(resource?.confirmedTriggerWords ?? []),
              ]),
              enabledTriggerWords: dedupePromptValues(
                selected.enabledTriggerWords,
              ),
            };
          }),
        ),
        params: { ...generationParams },
        assets: [],
        notes: "由创作台组合生成",
        favorite: false,
        tagIds: [],
        rating: 0,
        usageCount: 0,
      });
      saveLastGenerationParams(generationParams);
      setSavePanelOpen(false);
      setRecipeTitle("");
    } catch (error) {
      const message = `保存失败：${readableError(error)}`;
      setSaveError(message);
      onToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page studio-page">
      <header className="page-header studio-header">
        <div>
          <span className="eyebrow">从收藏到新作品</span>
          <h1>创作台</h1>
          <p>把已有灵感拖进画布，选择模型和 LoRA，随时复制完整 Prompt。</p>
        </div>
        <div className="page-actions">
          <div className="inspiration-wrap">
            <Button
              variant="secondary"
              icon={<Dice5 size={17} />}
              onClick={() => setInspirationOpen((open) => !open)}
            >
              灵感模式
              <ChevronDown size={14} />
            </Button>
            {inspirationOpen ? (
              <div className="inspiration-popover">
                <header>
                  <span><Sparkles size={16} />从哪些分类抽取？</span>
                  <IconButton
                    label="关闭"
                    onClick={() => setInspirationOpen(false)}
                  >
                    <X size={15} />
                  </IconButton>
                </header>
                <div className="inspiration-categories">
                  {categories.map((category) => {
                    const checked = inspirationCategories.includes(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        className={checked ? "is-active" : ""}
                        onClick={() =>
                          setInspirationCategories((current) =>
                            checked
                              ? current.filter((id) => id !== category.id)
                              : [...current, category.id],
                          )
                        }
                      >
                        <i style={{ background: category.color }} />
                        {category.name}
                        {checked ? <Check size={13} /> : null}
                      </button>
                    );
                  })}
                </div>
                <p>
                  每次混合抽取 3 个常用、收藏或长期少用词条；锁定内容不会被替换。
                </p>
                <Button
                  icon={<Dice5 size={16} />}
                  onClick={rerollInspiration}
                >
                  抽取新灵感
                </Button>
              </div>
            ) : null}
          </div>
          <Button
            icon={<Save size={17} />}
            onClick={() => {
              setSaveError("");
              setSavePanelOpen((open) => !open);
            }}
          >
            保存为总 Prompt
          </Button>
          {savePanelOpen ? (
            <div className="studio-save-panel">
              <Field label="配方标题（选填）">
                <input
                  autoFocus
                  value={recipeTitle}
                  placeholder="留空将使用 Prompt 开头自动命名"
                  onChange={(event) => setRecipeTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveRecipe();
                  }}
                />
              </Field>
              <p className="studio-save-status">
                将保存为
                <strong>{canSaveReproducible ? "可复现配方" : "草稿"}</strong>
                {!canSaveReproducible
                  ? "（模型或必要生成参数未填写完整）"
                  : ""}
              </p>
              {saveError ? (
                <p className="save-hint-error" role="alert">
                  {saveError}
                </p>
              ) : null}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSavePanelOpen(false)}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => void saveRecipe()}
                >
                  {saving ? "保存中…" : "确认保存"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div className="studio-workspace">
        <aside className="studio-library studio-panel">
          <div className="studio-panel-head">
            <div>
              <span className="panel-index">01</span>
              <strong>灵感库</strong>
            </div>
          </div>
          <div className="library-tabs">
            <button
              type="button"
              className={libraryMode === "snippets" ? "is-active" : ""}
              onClick={() => setLibraryMode("snippets")}
            >
              单 Prompt
            </button>
            <button
              type="button"
              className={libraryMode === "recipes" ? "is-active" : ""}
              onClick={() => setLibraryMode("recipes")}
            >
              总 Prompt 底稿
            </button>
          </div>
          {libraryMode === "snippets" ? (
            <>
              <label className="inline-search studio-search">
                <Search size={15} />
                <input
                  value={libraryQuery}
                  placeholder="搜索词条"
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
              </label>
              <div className="studio-category-scroll">
                <button
                  type="button"
                  className={libraryCategory === "all" ? "is-active" : ""}
                  onClick={() => setLibraryCategory("all")}
                >
                  全部
                </button>
                {categories.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    className={libraryCategory === category.id ? "is-active" : ""}
                    onClick={() => setLibraryCategory(category.id)}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
              <div className="studio-snippet-list">
                {visibleLibrary.map((snippet) => (
                  <article key={snippet.id}>
                    <div>
                      <strong>{snippet.text}</strong>
                      <span>{snippet.translation || "待翻译"}</span>
                    </div>
                    {snippet.favorite ? (
                      <Star size={13} fill="currentColor" />
                    ) : null}
                    <IconButton
                      label="加入画布"
                      onClick={() => addSnippet(snippet)}
                    >
                      <Plus size={16} />
                    </IconButton>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="studio-recipe-list">
              {recipes.map((recipe) => (
                <button
                  type="button"
                  key={recipe.id}
                  onClick={() => loadRecipe(recipe)}
                >
                  <span className="mini-recipe-icon"><FileText size={16} /></span>
                  <span>
                    <strong>
                      {deriveRecipeTitle(
                        recipe.title,
                        recipe.positivePrompt,
                        recipe.updatedAt,
                      )}
                    </strong>
                    <small>{recipe.modelName || "草稿"}</small>
                  </span>
                  <ChevronDown size={15} />
                </button>
              ))}
            </div>
          )}
        </aside>

        <main className="studio-canvas studio-panel">
          <div className="studio-panel-head">
            <div>
              <span className="panel-index">02</span>
              <strong>Prompt 画布</strong>
              <Badge tone="neutral">{items.length} 个片段</Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={14} />}
              onClick={rerollInspiration}
            >
              只重抽未固定项
            </Button>
          </div>

          {items.length ? (
            <div className="canvas-items">
              {items.map((item, index) => {
                const parsed = parsePrompt(item.text);
                const weight = parsed.chips[0]?.weight;
                return (
                  <article
                    key={item.id}
                    draggable
                    className={clsx(
                      "canvas-item",
                      item.locked && "is-locked",
                      dragId === item.id && "is-dragging",
                    )}
                    onDragStart={() => setDragId(item.id)}
                    onDragOver={(event: DragEvent) => event.preventDefault()}
                    onDrop={() => dropItem(item.id)}
                  >
                    <GripVertical className="canvas-grip" size={17} />
                    <span className="canvas-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div
                      className="canvas-order-controls"
                      aria-label={`调整第 ${index + 1} 个片段顺序`}
                    >
                      <IconButton
                        label="向上移动片段"
                        disabled={index === 0}
                        onClick={() => moveItem(item.id, -1)}
                      >
                        <ArrowUp size={13} />
                      </IconButton>
                      <IconButton
                        label="向下移动片段"
                        disabled={index === items.length - 1}
                        onClick={() => moveItem(item.id, 1)}
                      >
                        <ArrowDown size={13} />
                      </IconButton>
                    </div>
                    <div className="canvas-item-copy">
                      <input
                        value={item.text}
                        onChange={(event) =>
                          updateItem(item.id, { text: event.target.value })
                        }
                      />
                      <input
                        className="canvas-translation"
                        value={item.translation}
                        placeholder="添加中文译文"
                        onChange={(event) =>
                          updateItem(item.id, {
                            translation: event.target.value,
                          })
                        }
                      />
                      <div className="canvas-source">
                        <span>{item.source === "prefix" ? "固定前置" : item.source === "inspiration" ? "灵感抽取" : "词条库"}</span>
                        {item.categoryIds.slice(0, 2).map((id) => (
                          <small key={id}>{categories.find((cat) => cat.id === id)?.name}</small>
                        ))}
                      </div>
                    </div>
                    <label className="weight-control">
                      <span>权重</span>
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.05"
                        value={weight ?? ""}
                        placeholder="—"
                        onChange={(event) => applyWeight(item, event.target.value)}
                      />
                    </label>
                    <IconButton
                      label={item.locked ? "取消固定" : "固定此项"}
                      className={item.locked ? "is-active" : ""}
                      onClick={() => updateItem(item.id, { locked: !item.locked })}
                    >
                      {item.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                    </IconButton>
                    <IconButton
                      label="删除"
                      onClick={() =>
                        setItems((current) =>
                          current.filter((candidate) => candidate.id !== item.id),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Layers3 size={24} />}
              title="画布是空的"
              description="从左侧加入词条，或者用灵感模式抽取一个组合。"
            />
          )}

          <section className="studio-output">
            <header>
              <div>
                <strong>实时输出</strong>
                <span>已自动去除重复词条和触发词</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy size={15} />}
                disabled={!output}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(output)
                    .then(() => onToast("完整 Prompt 已复制"))
                }
              >
                复制
              </Button>
            </header>
            <p>{output || "从左侧添加词条后，这里会生成可直接出图的 Prompt。"}</p>
            {outputTranslation ? <small>{outputTranslation}</small> : null}
            <Field label="负向 Prompt">
              <textarea
                rows={2}
                value={negativePrompt}
                onChange={(event) => setNegativePrompt(event.target.value)}
              />
            </Field>
          </section>
        </main>

        <aside className="studio-context studio-panel">
          <div className="studio-panel-head">
            <div>
              <span className="panel-index">03</span>
              <strong>模型与提示</strong>
            </div>
          </div>
          <section className="context-section">
            <h3>基础模型</h3>
            <div className="resource-picker-search studio-resource-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={modelQuery}
                placeholder="搜索模型"
                aria-label="在创作台搜索模型"
                onChange={(event) => setModelQuery(event.target.value)}
              />
              <small>
                {filteredModels.length}/{models.length}
              </small>
              {modelQuery ? (
                <button
                  type="button"
                  aria-label="清空模型搜索"
                  onClick={() => setModelQuery("")}
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            <Select
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
            >
              <option value="">暂不选择</option>
              {filteredModels.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.available ? "" : "[离线] "}
                  {model.name}
                </option>
              ))}
            </Select>
            {modelQuery && filteredModels.length === 0 ? (
              <div className="picker-empty">没有找到匹配的模型</div>
            ) : null}
            {selectedModel && !selectedModel.available ? (
              <div className="compat-warning">
                <AlertTriangle size={15} />
                模型目录当前离线，仍可继续编辑和保存。
              </div>
            ) : null}
          </section>

          <section className="context-section">
              <div className="context-title">
                <h3>生成参数</h3>
                <span>
                  {generationParams.width || generationParams.height
                    ? `${generationParams.width ?? "—"} × ${generationParams.height ?? "—"}`
                    : "参数未填写"}
                </span>
              </div>
              <div className="compact-parameter-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setGenerationParams({ ...EMPTY_GENERATION_PARAMS })
                  }
                >
                  清空
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setGenerationParams({ ...RECOMMENDED_GENERATION_PARAMS })
                  }
                >
                  推荐值
                </Button>
              </div>
              <div className="generation-params-grid">
                <Field label="宽度">
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={generationParams.width ?? ""}
                  placeholder="不填写"
                  onChange={(event) => {
                    updateGenerationParam(
                      "width",
                      event.currentTarget.value === ""
                        ? null
                        : event.currentTarget.valueAsNumber,
                    );
                  }}
                />
              </Field>
              <Field label="高度">
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={generationParams.height ?? ""}
                  placeholder="不填写"
                  onChange={(event) => {
                    updateGenerationParam(
                      "height",
                      event.currentTarget.value === ""
                        ? null
                        : event.currentTarget.valueAsNumber,
                    );
                  }}
                />
              </Field>
              <Field label="采样器">
                <Select
                  value={generationParams.sampler ?? ""}
                  onChange={(event) =>
                    updateGenerationParam(
                      "sampler",
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">不填写</option>
                  {generationParams.sampler &&
                  !SAMPLERS.includes(generationParams.sampler) ? (
                    <option value={generationParams.sampler}>
                      {generationParams.sampler}
                    </option>
                  ) : null}
                  {SAMPLERS.map((sampler) => (
                    <option value={sampler} key={sampler}>
                      {sampler}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="调度器">
                <Select
                  value={generationParams.scheduler ?? ""}
                  onChange={(event) =>
                    updateGenerationParam(
                      "scheduler",
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">不填写</option>
                  {generationParams.scheduler &&
                  !SCHEDULERS.includes(generationParams.scheduler) ? (
                    <option value={generationParams.scheduler}>
                      {generationParams.scheduler}
                    </option>
                  ) : null}
                  {SCHEDULERS.map((scheduler) => (
                    <option value={scheduler} key={scheduler}>
                      {scheduler}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="步数">
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={generationParams.steps ?? ""}
                  placeholder="不填写"
                  onChange={(event) => {
                    updateGenerationParam(
                      "steps",
                      event.currentTarget.value === ""
                        ? null
                        : event.currentTarget.valueAsNumber,
                    );
                  }}
                />
              </Field>
              <Field label="CFG">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={generationParams.cfg ?? ""}
                  placeholder="不填写"
                  onChange={(event) => {
                    updateGenerationParam(
                      "cfg",
                      event.currentTarget.value === ""
                        ? null
                        : event.currentTarget.valueAsNumber,
                    );
                  }}
                />
              </Field>
              <Field label="Seed" className="generation-seed-field">
                  <input
                    inputMode="numeric"
                    value={generationParams.seed ?? ""}
                    placeholder="不填写"
                    onChange={(event) =>
                      updateGenerationParam(
                        "seed",
                        event.target.value || null,
                      )
                    }
                />
              </Field>
            </div>
          </section>

          <section className="context-section">
            <div className="context-title">
              <h3>LoRA</h3>
              <span>{selectedLoras.length} 已启用</span>
            </div>
            <div className="resource-picker-search studio-resource-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={loraQuery}
                placeholder="搜索 LoRA 或触发词"
                aria-label="在创作台搜索 LoRA"
                onChange={(event) => setLoraQuery(event.target.value)}
              />
              <small>
                {displayedLoras.length}/{loras.length}
              </small>
              {loraQuery ? (
                <button
                  type="button"
                  aria-label="清空 LoRA 搜索"
                  onClick={() => setLoraQuery("")}
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
            {displayedLoras.length ? (
              <div className="studio-lora-list">
                {displayedLoras.map((lora) => {
                const selected = selectedLoras.find(
                  (item) => item.resourceId === lora.id,
                );
                const selectedIndex = selectedLoras.findIndex(
                  (item) => item.resourceId === lora.id,
                );
                const triggerOptions = selected
                  ? dedupePromptValues([
                      ...selected.triggerWords,
                      ...lora.triggerWords,
                      ...lora.confirmedTriggerWords,
                    ])
                  : [];
                const compatible =
                  !selectedModel?.baseModel ||
                  !lora.baseModel ||
                  lora.baseModel.includes(selectedModel.baseModel);
                return (
                  <article
                    key={lora.id}
                    className={clsx(selected && "is-selected")}
                  >
                    <button
                      type="button"
                      className="studio-lora-select"
                      onClick={() => toggleLora(lora)}
                    >
                      <span><Sparkles size={15} /></span>
                      <div>
                        <strong>{lora.name}</strong>
                        <small>{lora.baseModel || "底模未知"}</small>
                      </div>
                      {selected ? <Check size={16} /> : <Plus size={16} />}
                    </button>
                    {!compatible ? (
                      <div className="compat-warning compact">
                        <AlertTriangle size={13} />可能与所选底模不兼容
                      </div>
                    ) : null}
                    {selected ? (
                      <div className="studio-lora-controls">
                        <div className="lora-order-controls">
                          <span>加载顺序 {selectedIndex + 1}</span>
                          <IconButton
                            label={`上移 ${lora.name}`}
                            disabled={selectedIndex === 0}
                            onClick={() => moveLora(lora.id, -1)}
                          >
                            <ArrowUp size={13} />
                          </IconButton>
                          <IconButton
                            label={`下移 ${lora.name}`}
                            disabled={selectedIndex === selectedLoras.length - 1}
                            onClick={() => moveLora(lora.id, 1)}
                          >
                            <ArrowDown size={13} />
                          </IconButton>
                        </div>
                        <div className="lora-strength-grid">
                          <Field label="模型权重">
                            <input
                              type="number"
                              min="-5"
                              max="5"
                              step="0.05"
                              value={selected.modelStrength}
                              onChange={(event) => {
                                if (
                                  Number.isFinite(
                                    event.currentTarget.valueAsNumber,
                                  )
                                ) {
                                  updateLora(lora.id, {
                                    modelStrength:
                                      event.currentTarget.valueAsNumber,
                                  });
                                }
                              }}
                            />
                          </Field>
                          <Field label="CLIP 权重">
                            <input
                              type="number"
                              min="-5"
                              max="5"
                              step="0.05"
                              value={selected.clipStrength}
                              onChange={(event) => {
                                if (
                                  Number.isFinite(
                                    event.currentTarget.valueAsNumber,
                                  )
                                ) {
                                  updateLora(lora.id, {
                                    clipStrength:
                                      event.currentTarget.valueAsNumber,
                                  });
                                }
                              }}
                            />
                          </Field>
                        </div>
                      </div>
                    ) : null}
                    {selected && triggerOptions.length ? (
                      <div className="studio-triggers">
                        {triggerOptions.map((trigger) => {
                          const enabled = selected.enabledTriggerWords.some(
                            (word) =>
                              word.trim().toLocaleLowerCase() ===
                              trigger.trim().toLocaleLowerCase(),
                          );
                          return (
                            <button
                              type="button"
                              key={trigger}
                              className={enabled ? "is-active" : ""}
                              onClick={() =>
                                toggleTrigger(selected.resourceId, trigger)
                              }
                            >
                              {enabled ? <Check size={11} /> : null}
                              {trigger}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
                })}
              </div>
            ) : (
              <div className="picker-empty">
                没有找到匹配的 LoRA，请更换关键词
              </div>
            )}
          </section>

          <section className="context-section context-tips">
            <div className="context-title">
              <h3><Lightbulb size={16} />相关技巧</h3>
              <span>{contextualTips.length}</span>
            </div>
            {contextualTips.length ? (
              contextualTips.slice(0, 4).map((tip) => (
                <article key={tip.id}>
                  <strong>{tip.title}</strong>
                  <p>{tip.content}</p>
                  <span>
                    {tip.scope === "global"
                      ? "通用"
                      : tip.targetName || "当前上下文"}
                  </span>
                </article>
              ))
            ) : (
              <p className="context-empty">选择模型或 LoRA 后显示相关经验。</p>
            )}
          </section>

          <div className="studio-pro-tip">
            <WandSparkles size={17} />
            <p>
              <strong>小提示</strong>
              固定满意的片段，再重抽其它项，通常比一次随机全部更容易找到方向。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

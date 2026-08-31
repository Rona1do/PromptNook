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
      onToast("This snippet is already on the canvas");
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
    setRecipeTitle(`${displayTitle} · New version`);
    onToast(`Loaded “${displayTitle}” as a Studio draft`);
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
      onToast("Invalid weight format");
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
      onToast("The selected categories have no available snippets");
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
    onToast(`Drew ${picked.length} new ideas; pinned items stayed in place`);
  }

  async function saveRecipe() {
    setSaveError("");
    if (!output.trim()) {
      const message = "The canvas is empty";
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
        notes: "Composed in Studio",
        favorite: false,
        tagIds: [],
        rating: 0,
        usageCount: 0,
      });
      saveLastGenerationParams(generationParams);
      setSavePanelOpen(false);
      setRecipeTitle("");
    } catch (error) {
      const message = `Save failed: ${readableError(error)}`;
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
          <span className="eyebrow">From saved ideas to a new work</span>
          <h1>Studio</h1>
          <p>Drag ideas onto the canvas, select a model and LoRAs, then copy the complete prompt.</p>
        </div>
        <div className="page-actions">
          <div className="inspiration-wrap">
            <Button
              variant="secondary"
              icon={<Dice5 size={17} />}
              onClick={() => setInspirationOpen((open) => !open)}
            >
              Inspiration mode
              <ChevronDown size={14} />
            </Button>
            {inspirationOpen ? (
              <div className="inspiration-popover">
                <header>
                  <span><Sparkles size={16} />Draw from which categories?</span>
                  <IconButton
                    label="Close"
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
                  Draw three frequently used, favorite, or long-unused snippets; pinned items stay in place.
                </p>
                <Button
                  icon={<Dice5 size={16} />}
                  onClick={rerollInspiration}
                >
                  Draw new inspiration
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
            Save as recipe
          </Button>
          {savePanelOpen ? (
            <div className="studio-save-panel">
              <Field label="Recipe title (optional)">
                <input
                  autoFocus
                  value={recipeTitle}
                  placeholder="Leave blank to derive a title from the prompt"
                  onChange={(event) => setRecipeTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveRecipe();
                  }}
                />
              </Field>
              <p className="studio-save-status">
                Save as
                <strong>{canSaveReproducible ? "Reproducible recipe" : "Draft"}</strong>
                {!canSaveReproducible
                  ? "(model or generation parameters are incomplete)"
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
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => void saveRecipe()}
                >
                  {saving ? "Saving…" : "Save recipe"}
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
              <strong>Idea library</strong>
            </div>
          </div>
          <div className="library-tabs">
            <button
              type="button"
              className={libraryMode === "snippets" ? "is-active" : ""}
              onClick={() => setLibraryMode("snippets")}
            >
              Snippets
            </button>
            <button
              type="button"
              className={libraryMode === "recipes" ? "is-active" : ""}
              onClick={() => setLibraryMode("recipes")}
            >
              Recipe drafts
            </button>
          </div>
          {libraryMode === "snippets" ? (
            <>
              <label className="inline-search studio-search">
                <Search size={15} />
                <input
                  value={libraryQuery}
                  placeholder="Search snippets"
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
              </label>
              <div className="studio-category-scroll">
                <button
                  type="button"
                  className={libraryCategory === "all" ? "is-active" : ""}
                  onClick={() => setLibraryCategory("all")}
                >
                  All
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
                      <span>{snippet.translation || "Pending translation"}</span>
                    </div>
                    {snippet.favorite ? (
                      <Star size={13} fill="currentColor" />
                    ) : null}
                    <IconButton
                      label="Add to canvas"
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
                    <small>{recipe.modelName || "Draft"}</small>
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
              <strong>Prompt canvas</strong>
              <Badge tone="neutral">{items.length} snippets</Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw size={14} />}
              onClick={rerollInspiration}
            >
              Redraw unpinned items
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
                      aria-label={`Reorder snippet ${index + 1}`}
                    >
                      <IconButton
                        label="Move snippet up"
                        disabled={index === 0}
                        onClick={() => moveItem(item.id, -1)}
                      >
                        <ArrowUp size={13} />
                      </IconButton>
                      <IconButton
                        label="Move snippet down"
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
                        placeholder="Add translation"
                        onChange={(event) =>
                          updateItem(item.id, {
                            translation: event.target.value,
                          })
                        }
                      />
                      <div className="canvas-source">
                        <span>{item.source === "prefix" ? "Pinned prefix" : item.source === "inspiration" ? "Inspiration draw" : "Snippet library"}</span>
                        {item.categoryIds.slice(0, 2).map((id) => (
                          <small key={id}>{categories.find((cat) => cat.id === id)?.name}</small>
                        ))}
                      </div>
                    </div>
                    <label className="weight-control">
                      <span>Weight</span>
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
                      label={item.locked ? "Unpin" : "Pin this item"}
                      className={item.locked ? "is-active" : ""}
                      onClick={() => updateItem(item.id, { locked: !item.locked })}
                    >
                      {item.locked ? <Lock size={16} /> : <LockOpen size={16} />}
                    </IconButton>
                    <IconButton
                      label="Delete"
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
              title="The canvas is empty"
              description="Add snippets from the left or draw a combination in Inspiration mode."
            />
          )}

          <section className="studio-output">
            <header>
              <div>
                <strong>Live output</strong>
                <span>Duplicate snippets and trigger words removed automatically</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy size={15} />}
                disabled={!output}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(output)
                    .then(() => onToast("Complete prompt copied"))
                }
              >
                Copy
              </Button>
            </header>
            <p>{output || "Add snippets from the left to build a generation-ready prompt here."}</p>
            {outputTranslation ? <small>{outputTranslation}</small> : null}
            <Field label="Negative prompt">
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
              <strong>Models & guidance</strong>
            </div>
          </div>
          <section className="context-section">
            <h3>Base model</h3>
            <div className="resource-picker-search studio-resource-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={modelQuery}
                placeholder="Search models"
                aria-label="Search models in Studio"
                onChange={(event) => setModelQuery(event.target.value)}
              />
              <small>
                {filteredModels.length}/{models.length}
              </small>
              {modelQuery ? (
                <button
                  type="button"
                  aria-label="Clear model search"
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
              <option value="">No selection</option>
              {filteredModels.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.available ? "" : "[offline] "}
                  {model.name}
                </option>
              ))}
            </Select>
            {modelQuery && filteredModels.length === 0 ? (
              <div className="picker-empty">No matching model found</div>
            ) : null}
            {selectedModel && !selectedModel.available ? (
              <div className="compat-warning">
                <AlertTriangle size={15} />
                The model folder is offline; you can still edit and save.
              </div>
            ) : null}
          </section>

          <section className="context-section">
              <div className="context-title">
                <h3>Generation parameters</h3>
                <span>
                  {generationParams.width || generationParams.height
                    ? `${generationParams.width ?? "—"} × ${generationParams.height ?? "—"}`
                    : "Parameters not set"}
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
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setGenerationParams({ ...RECOMMENDED_GENERATION_PARAMS })
                  }
                >
                  Recommended values
                </Button>
              </div>
              <div className="generation-params-grid">
                <Field label="Width">
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={generationParams.width ?? ""}
                  placeholder="Not set"
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
              <Field label="Height">
                <input
                  type="number"
                  min="64"
                  step="64"
                  value={generationParams.height ?? ""}
                  placeholder="Not set"
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
              <Field label="Sampler">
                <Select
                  value={generationParams.sampler ?? ""}
                  onChange={(event) =>
                    updateGenerationParam(
                      "sampler",
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">Not set</option>
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
              <Field label="Scheduler">
                <Select
                  value={generationParams.scheduler ?? ""}
                  onChange={(event) =>
                    updateGenerationParam(
                      "scheduler",
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">Not set</option>
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
              <Field label="Steps">
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={generationParams.steps ?? ""}
                  placeholder="Not set"
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
                  placeholder="Not set"
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
                    placeholder="Not set"
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
              <span>{selectedLoras.length} Enabled</span>
            </div>
            <div className="resource-picker-search studio-resource-search">
              <Search size={15} aria-hidden="true" />
              <input
                value={loraQuery}
                placeholder="Search LoRA or trigger word"
                aria-label="Search LoRAs in Studio"
                onChange={(event) => setLoraQuery(event.target.value)}
              />
              <small>
                {displayedLoras.length}/{loras.length}
              </small>
              {loraQuery ? (
                <button
                  type="button"
                  aria-label="Clear LoRA search"
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
                        <small>{lora.baseModel || "Unknown base model"}</small>
                      </div>
                      {selected ? <Check size={16} /> : <Plus size={16} />}
                    </button>
                    {!compatible ? (
                      <div className="compat-warning compact">
                        <AlertTriangle size={13} />May be incompatible with the selected base model
                      </div>
                    ) : null}
                    {selected ? (
                      <div className="studio-lora-controls">
                        <div className="lora-order-controls">
                          <span>Load order {selectedIndex + 1}</span>
                          <IconButton
                            label={`Move ${lora.name} up`}
                            disabled={selectedIndex === 0}
                            onClick={() => moveLora(lora.id, -1)}
                          >
                            <ArrowUp size={13} />
                          </IconButton>
                          <IconButton
                            label={`Move ${lora.name} down`}
                            disabled={selectedIndex === selectedLoras.length - 1}
                            onClick={() => moveLora(lora.id, 1)}
                          >
                            <ArrowDown size={13} />
                          </IconButton>
                        </div>
                        <div className="lora-strength-grid">
                          <Field label="Model weight">
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
                          <Field label="CLIP weight">
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
                No matching LoRA found; try another keyword
              </div>
            )}
          </section>

          <section className="context-section context-tips">
            <div className="context-title">
              <h3><Lightbulb size={16} />Relevant tips</h3>
              <span>{contextualTips.length}</span>
            </div>
            {contextualTips.length ? (
              contextualTips.slice(0, 4).map((tip) => (
                <article key={tip.id}>
                  <strong>{tip.title}</strong>
                  <p>{tip.content}</p>
                  <span>
                    {tip.scope === "global"
                      ? "General"
                      : tip.targetName || "Current context"}
                  </span>
                </article>
              ))
            ) : (
              <p className="context-empty">Select a model or LoRA to show relevant tips.</p>
            )}
          </section>

          <div className="studio-pro-tip">
            <WandSparkles size={17} />
            <p>
              <strong>Tip</strong>
              Pin the snippets you like, then redraw the rest to explore more deliberately.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

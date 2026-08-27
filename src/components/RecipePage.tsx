import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  FileImage,
  Filter,
  FolderPlus,
  GripVertical,
  History,
  ImagePlus,
  Languages,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import type {
  Asset,
  GenerationParams,
  Recipe,
  RecipeInput,
  RecipeLora,
  RecipeStatus,
  RecipeTag,
  Resource,
} from "../types";
import { api } from "../lib/api";
import { readableError } from "../lib/errors";
import { deriveRecipeTitle } from "../lib/recipeTitle";
import {
  detectLorasFromPrompt,
  mergeDetectedLoras,
} from "../lib/loraDetect";
import { Badge, Button, EmptyState, Field, IconButton, Modal, Select } from "./ui";
import {
  defaultGenerationParamsForNew,
  saveLastGenerationParams,
} from "../lib/lastGenerationParams";
import { PromptChipEditor } from "./PromptChipEditor";
import { RevisionHistory } from "./RevisionHistory";

type RecipeFilter = "all" | "favorite" | "reproducible" | "draft";
type EditorTab = "prompt" | "params" | "images";

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

/** Keep in sync with StudioPage sampler list (ComfyUI-style names). */
const SAMPLERS = [
  "euler",
  "euler_ancestral",
  "dpmpp_2m",
  "dpmpp_2m_sde",
  "dpmpp_3m_sde",
  "dpmpp_sde",
  "uni_pc",
] as const;

const SCHEDULERS = [
  "simple",
  "normal",
  "karras",
  "exponential",
  "sgm_uniform",
  "beta",
] as const;

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

function formatUpdated(value: string) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function createRecipe(): RecipeInput {
  return {
    id: "",
    title: "",
    status: "draft",
    modality: "text_to_image",
    positivePrompt: "",
    positiveTranslation: "",
    negativePrompt: "",
    negativeTranslation: "",
    loras: [],
    // After the first successful save, new drafts reuse last generation params.
    params: defaultGenerationParamsForNew(),
    assets: [],
    tagIds: [],
    notes: "",
    favorite: false,
    rating: 0,
    usageCount: 0,
  };
}

function RecipeVisual({
  recipe,
  privacyMode,
  size = "card",
}: {
  recipe: Recipe | RecipeInput;
  privacyMode: boolean;
  size?: "card" | "hero";
}) {
  const displayTitle = deriveRecipeTitle(
    recipe.title,
    recipe.positivePrompt,
    "updatedAt" in recipe ? recipe.updatedAt : new Date(),
  );
  const cover =
    recipe.assets.find((asset) => asset.id === recipe.coverAssetId) ??
    recipe.assets[0];
  const visualIndex =
    Array.from(recipe.id || displayTitle).reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0,
    ) % 6;

  return (
    <div
      className={clsx(
        "recipe-visual",
        `visual-${visualIndex}`,
        `visual-${size}`,
        privacyMode && "is-private",
      )}
    >
      {cover && !privacyMode && cover.url ? (
        <img src={cover.url} alt={`${displayTitle}示例图`} loading="lazy" />
      ) : (
        <div className="visual-placeholder">
          <span className="visual-orb visual-orb-a" />
          <span className="visual-orb visual-orb-b" />
          <Sparkles size={size === "hero" ? 32 : 23} />
          <small>{privacyMode && cover ? "已隐藏" : "示例图"}</small>
        </div>
      )}
      {privacyMode ? (
        <span className="private-label">隐私模式 · 不加载原图</span>
      ) : null}
    </div>
  );
}

function RecipeCard({
  recipe,
  recipeTags,
  privacyMode,
  onOpen,
  onFavorite,
  onDelete,
  onSave,
  onToast,
}: {
  recipe: Recipe;
  recipeTags: RecipeTag[];
  privacyMode: boolean;
  onOpen: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onSave: (recipe: RecipeInput) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [poseOpen, setPoseOpen] = useState(false);
  const [posePopoverStyle, setPosePopoverStyle] = useState<CSSProperties>({});
  const poseRef = useRef<HTMLDivElement>(null);
  const posePillRef = useRef<HTMLButtonElement>(null);
  const posePopoverRef = useRef<HTMLDivElement>(null);
  const displayTitle = deriveRecipeTitle(
    recipe.title,
    recipe.positivePrompt,
    recipe.updatedAt,
  );
  const tags = (recipe.tagIds ?? [])
    .map((id) => recipeTags.find((tag) => tag.id === id))
    .filter(Boolean) as RecipeTag[];
  const primaryTag = tags[0];

  const updatePosePopoverPosition = useCallback(() => {
    const pill = posePillRef.current;
    if (!pill) return;
    const rect = pill.getBoundingClientRect();
    const gap = 8;
    const width = Math.min(320, Math.max(260, window.innerWidth - 24));
    // Prefer opening upward; if not enough room, open downward.
    const estimatedHeight = 220;
    const spaceAbove = rect.top - gap;
    const openUp = spaceAbove >= Math.min(estimatedHeight, 160);
    let left = rect.left;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    const style: CSSProperties = {
      position: "fixed",
      left,
      width,
      zIndex: 12000,
    };
    if (openUp) {
      style.bottom = window.innerHeight - rect.top + gap;
      style.top = "auto";
      style.maxHeight = Math.min(320, Math.max(140, spaceAbove - 8));
    } else {
      style.top = rect.bottom + gap;
      style.bottom = "auto";
      style.maxHeight = Math.min(
        320,
        Math.max(140, window.innerHeight - rect.bottom - gap - 12),
      );
    }
    setPosePopoverStyle(style);
  }, []);

  useLayoutEffect(() => {
    if (!poseOpen) return;
    updatePosePopoverPosition();
  }, [poseOpen, updatePosePopoverPosition, recipeTags.length, tags.length]);

  useEffect(() => {
    if (!poseOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        poseRef.current?.contains(target) ||
        posePopoverRef.current?.contains(target)
      ) {
        return;
      }
      setPoseOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPoseOpen(false);
    }
    function onReposition() {
      updatePosePopoverPosition();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    // capture scroll from any nested scroller
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [poseOpen, updatePosePopoverPosition]);

  async function togglePoseTag(tagId: string) {
    const current = recipe.tagIds ?? [];
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    try {
      await onSave({ ...recipe, tagIds: next });
      onToast(
        next.includes(tagId)
          ? `Tag added: ${recipeTags.find((t) => t.id === tagId)?.name ?? ""}`
          : `Tag removed: ${recipeTags.find((t) => t.id === tagId)?.name ?? ""}`,
      );
    } catch (error) {
      onToast(`Could not save tags: ${readableError(error)}`);
    }
  }

  return (
    <article className="recipe-card" onDoubleClick={onOpen}>
      <div className="recipe-card-visual">
        <RecipeVisual recipe={recipe} privacyMode={privacyMode} />
        <div className="recipe-card-actions">
          <IconButton
            label={recipe.favorite ? "取消收藏" : "收藏"}
            className={recipe.favorite ? "is-favorite" : ""}
            onClick={onFavorite}
          >
            <Star size={17} fill={recipe.favorite ? "currentColor" : "none"} />
          </IconButton>
          <div className="more-menu">
            <IconButton
              label="更多操作"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={18} />
            </IconButton>
            {menuOpen ? (
              <div className="context-menu">
                <button type="button" onClick={onOpen}>
                  <SlidersHorizontal size={15} />编辑配方
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(recipe.positivePrompt)
                  }
                >
                  <Copy size={15} />复制 Prompt
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={onDelete}
                >
                  <Trash2 size={15} />移入回收站
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <span className={`status-pill status-${recipe.status}`}>
          {recipe.status === "reproducible" ? (
            <><Check size={13} />可复现</>
          ) : (
            "草稿"
          )}
        </span>
        <div className="pose-pill-wrap" ref={poseRef}>
          <button
            ref={posePillRef}
            type="button"
            className={clsx("pose-pill", poseOpen && "is-open", !primaryTag && "is-empty")}
            style={
              primaryTag
                ? { background: `${primaryTag.color}dd` }
                : undefined
            }
            title="Edit recipe tags"
            aria-expanded={poseOpen}
            aria-haspopup="listbox"
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              setPoseOpen((open) => !open);
              setMenuOpen(false);
            }}
          >
            {primaryTag ? primaryTag.name : "Tags"}
            {tags.length > 1 ? <i>+{tags.length - 1}</i> : null}
          </button>
        </div>
        {poseOpen
          ? createPortal(
              <div
                ref={posePopoverRef}
                className="pose-pill-popover"
                role="listbox"
                aria-label="Recipe tags"
                style={posePopoverStyle}
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header>
                  <strong>Recipe tags</strong>
                  <span>多选 · 点选即保存</span>
                </header>
                <div className="pose-pill-options">
                  {recipeTags.map((tag) => {
                    const active = (recipe.tagIds ?? []).includes(tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        role="option"
                        aria-selected={active}
                        className={clsx(
                          "recipe-tag-chip",
                          active && "is-active",
                        )}
                        style={
                          active
                            ? { background: tag.color, borderColor: tag.color }
                            : { borderColor: tag.color, color: tag.color }
                        }
                        onClick={() => void togglePoseTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
      <button className="recipe-card-copy" type="button" onClick={onOpen}>
        <div className="recipe-title-line">
          <h3>{displayTitle}</h3>
          <ChevronRight size={17} />
        </div>
        <p>{recipe.positivePrompt}</p>
        {tags.length > 1 ? (
          <div className="recipe-tag-row">
            {tags.slice(1, 4).map((tag) => (
              <span
                key={tag.id}
                className="recipe-tag-chip is-compact"
                style={{ borderColor: tag.color, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="recipe-meta">
          <span>{recipe.modelName || "未选择模型"}</span>
          {recipe.loras.length ? (
            <span>+{recipe.loras.length} LoRA</span>
          ) : null}
          <span className="meta-spacer" />
          <span>{formatUpdated(recipe.updatedAt)}</span>
        </div>
        <div className="rating-row" aria-label={`${recipe.rating} 星`}>
          {Array.from({ length: 5 }, (_, index) => (
            <Star
              size={13}
              key={index}
              fill={index < recipe.rating ? "currentColor" : "none"}
            />
          ))}
        </div>
      </button>
    </article>
  );
}

async function fileToAsset(file: File): Promise<Asset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return api.importAsset({
    name: file.name || `粘贴图片-${Date.now()}.png`,
    mimeType: file.type || "image/png",
    dataBase64,
  });
}

export function RecipeEditor({
  recipe,
  resources,
  recipeTags,
  privacyMode,
  targetLanguage,
  onClose,
  onSave,
  onSaveSnippet,
  onToast,
}: {
  recipe?: Recipe;
  resources: Resource[];
  recipeTags: RecipeTag[];
  privacyMode: boolean;
  targetLanguage: string;
  onClose: () => void;
  onSave: (recipe: RecipeInput) => Promise<void>;
  onSaveSnippet: (
    text: string,
    translation: string,
    sourceTitle: string,
  ) => Promise<boolean>;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<RecipeInput>(() => {
    if (!recipe) return createRecipe();
    const cloned = structuredClone(recipe);
    return {
      ...cloned,
      tagIds: cloned.tagIds ?? [],
    };
  });
  const [tab, setTab] = useState<EditorTab>("prompt");
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<{
    field: "positive" | "negative";
    message: string;
  } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [loraPicker, setLoraPicker] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [loraQuery, setLoraQuery] = useState("");
  const [saveError, setSaveError] = useState("");
  /** Large in-editor status line (not a corner toast) so users always see progress. */
  const [statusLine, setStatusLine] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const models = resources.filter((item) => item.resourceType !== "lora");
  const loras = resources.filter((item) => item.resourceType === "lora");
  const filteredModels = useMemo(() => {
    const matches = models.filter((model) => resourceMatches(model, modelQuery));
    const selected = models.find((model) => model.id === draft.modelId);
    if (selected && !matches.some((model) => model.id === selected.id)) {
      return [selected, ...matches];
    }
    return matches;
  }, [draft.modelId, modelQuery, models]);
  const filteredLoras = useMemo(() => {
    const selectedOrder = new Map(
      draft.loras.map((lora, index) => [lora.resourceId, index]),
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
  }, [draft.loras, loraQuery, loras]);
  // 尺寸/采样器/步数/CFG 允许全局统一、每条留空；可复现只要求有正向 Prompt。
  const canReproduce = Boolean(draft.positivePrompt.trim());

  const setStatus = (status: RecipeStatus) => {
    if (status === "reproducible" && !canReproduce) {
      setTab("prompt");
      const message = "填写正向 Prompt 后才能标记为可复现";
      setSaveError(message);
      onToast(message);
      return;
    }
    setSaveError("");
    setDraft((current) => ({ ...current, status }));
  };

  const addFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith("image/"));
      if (!images.length) {
        onToast("这里只接收图片文件");
        return;
      }
      try {
        const imported = await Promise.all(images.map(fileToAsset));
        setDraft((current) => ({
          ...current,
          assets: [...current.assets, ...imported],
          coverAssetId:
            current.coverAssetId ?? imported[0]?.id ?? current.coverAssetId,
        }));
        onToast(`已加入 ${imported.length} 张示例图`);
      } catch {
        onToast("图片导入失败，请重试");
      }
    },
    [onToast],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData.files);
      if (files.some((file) => file.type.startsWith("image/"))) {
        event.preventDefault();
        void addFiles(files);
      }
    },
    [addFiles],
  );

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  useEffect(() => {
    setSaveError((current) => (current ? "" : current));
    // Clear a stale validation/backend message as soon as the user edits fields
    // that can resolve it.
  }, [
    draft.title,
    draft.status,
    draft.positivePrompt,
    draft.modelId,
    draft.params.width,
    draft.params.height,
    draft.params.sampler,
    draft.params.steps,
    draft.params.cfg,
  ]);

  async function translatePositiveSource(
    sourceRaw: string,
  ): Promise<string | null> {
    const source = sourceRaw.trim();
    if (!source) return null;
    setTranslationError(null);
    setTranslating(true);
    setStatusLine("正在翻译正向 Prompt…");
    try {
      const result = await api.translateText({
        text: source,
        targetLanguage,
      });
      const translated = (result.text ?? "").trim();
      if (!translated) {
        throw new Error("翻译服务返回了空译文");
      }
      setDraft((current) => ({
        ...current,
        positiveTranslation: translated,
      }));
      setStatusLine("翻译完成");
      return translated;
    } catch (error) {
      const message = `翻译失败：${readableError(
        error,
        "服务暂时不可用",
      )}；译文可留空或手工填写，不影响保存`;
      setTranslationError({ field: "positive", message });
      setStatusLine(message);
      return null;
    } finally {
      setTranslating(false);
    }
  }

  async function translate(field: "positive" | "negative") {
    if (field === "positive") {
      await translatePositiveSource(draft.positivePrompt);
      return;
    }
    const source = draft.negativePrompt.trim();
    if (!source) return;
    setTranslationError(null);
    setTranslating(true);
    setStatusLine("正在翻译负向 Prompt…");
    try {
      const result = await api.translateText({
        text: source,
        targetLanguage,
      });
      setDraft((current) => ({
        ...current,
        negativeTranslation: result.text,
      }));
      setStatusLine("负向 Prompt 翻译完成");
    } catch (error) {
      const message = `翻译失败：${readableError(
        error,
        "服务暂时不可用",
      )}；译文可留空或手工填写，不影响保存`;
      setTranslationError({ field, message });
      setStatusLine(message);
    } finally {
      setTranslating(false);
    }
  }

  function importPositivePrompt(text: string) {
    const next = text.replace(/^\uFEFF/, "");
    setDraft((current) => ({
      ...current,
      positivePrompt: next,
      // 粘贴/导入后清空旧译文；总 Prompt 需手动点「自动翻译」。
      positiveTranslation: "",
    }));
    setStatusLine("已导入 Prompt；需要中文时可点「自动翻译」");
  }

  function selectModel(modelId: string) {
    const model = models.find((item) => item.id === modelId);
    setDraft((current) => ({
      ...current,
      modelId: model?.id,
      modelName: model?.name,
    }));
  }

  function applyDetectedLoras(silent = false) {
    const detected = detectLorasFromPrompt(
      draft.positivePrompt,
      resources,
      draft.loras,
    );
    if (!detected.length) {
      if (!silent) onToast("未在 Prompt 中识别到已知 LoRA 或触发词");
      return 0;
    }
    setDraft((current) => ({
      ...current,
      loras: mergeDetectedLoras(current.loras, detected),
    }));
    if (!silent) {
      onToast(`已自动附加 ${detected.length} 个 LoRA`);
    }
    return detected.length;
  }

  useEffect(() => {
    if (!draft.positivePrompt.trim()) return;
    const timer = window.setTimeout(() => {
      const detected = detectLorasFromPrompt(
        draft.positivePrompt,
        resources,
        draft.loras,
      );
      if (!detected.length) return;
      setDraft((current) => {
        const next = mergeDetectedLoras(current.loras, detected);
        if (next.length === current.loras.length) return current;
        return { ...current, loras: next };
      });
    }, 450);
    return () => window.clearTimeout(timer);
    // Only re-run when prompt text changes; resources are read from closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.positivePrompt]);

  function toggleTag(tagId: string) {
    setDraft((current) => {
      const tagIds = current.tagIds ?? [];
      return {
        ...current,
        tagIds: tagIds.includes(tagId)
          ? tagIds.filter((id) => id !== tagId)
          : [...tagIds, tagId],
      };
    });
  }

  function toggleLora(resource: Resource) {
    setDraft((current) => {
      const exists = current.loras.some(
        (item) => item.resourceId === resource.id,
      );
      if (exists) {
        return {
          ...current,
          loras: current.loras
            .filter((item) => item.resourceId !== resource.id)
            .map((item, order) => ({ ...item, order })),
        };
      }
      const item: RecipeLora = {
        resourceId: resource.id,
        name: resource.name,
        modelStrength: 1,
        clipStrength: 1,
        order: current.loras.length,
        triggerWords: [...resource.triggerWords],
        enabledTriggerWords: [...resource.confirmedTriggerWords],
      };
      return { ...current, loras: [...current.loras, item] };
    });
  }

  function updateLora(resourceId: string, patch: Partial<RecipeLora>) {
    setDraft((current) => ({
      ...current,
      loras: current.loras.map((item) =>
        item.resourceId === resourceId ? { ...item, ...patch } : item,
      ),
    }));
  }

  function toggleTrigger(resourceId: string, trigger: string) {
    setDraft((current) => ({
      ...current,
      loras: current.loras.map((item) => {
        if (item.resourceId !== resourceId) return item;
        const enabled = item.enabledTriggerWords.includes(trigger)
          ? item.enabledTriggerWords.filter((word) => word !== trigger)
          : [...item.enabledTriggerWords, trigger];
        return { ...item, enabledTriggerWords: enabled };
      }),
    }));
  }

  function updateGenerationParam<Key extends keyof GenerationParams>(
    key: Key,
    value: GenerationParams[Key],
  ) {
    setDraft((current) => ({
      ...current,
      params: { ...current.params, [key]: value },
    }));
  }

  async function save() {
    setSaveError("");
    setStatusLine("");
    if (draft.status === "reproducible" && !canReproduce) {
      const message = "可复现配方至少需要正向 Prompt；可切换为“草稿”后保存";
      setSaveError(message);
      setStatusLine(message);
      setTab("prompt");
      return;
    }

    // 总 Prompt 不强制自动翻译，保存应立即返回。
    setSaving(true);
    setStatusLine("正在保存…");
    try {
      await onSave(draft);
      saveLastGenerationParams(draft.params);
      setStatusLine("已保存");
      onClose();
    } catch (error) {
      const message = `保存失败：${readableError(error)}`;
      setSaveError(message);
      setStatusLine(message);
    } finally {
      setSaving(false);
    }
  }

  function applyRevision(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== "object") {
      onToast("这个历史版本无法读取");
      return;
    }
    const restored = snapshot as Partial<RecipeInput>;
    if (
      typeof restored.title !== "string" ||
      typeof restored.positivePrompt !== "string"
    ) {
      onToast("历史版本缺少必要的 Prompt 字段");
      return;
    }
    setDraft((current) => {
      const currentAssets = new Map(
        current.assets.map((asset) => [asset.id, asset]),
      );
      const assets = Array.isArray(restored.assets)
        ? restored.assets.map((asset) => ({
            ...asset,
            url: currentAssets.get(asset.id)?.url || asset.url,
          }))
        : current.assets;
      return {
        ...current,
        ...restored,
        id: current.id,
        assets,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
      };
    });
    setHistoryOpen(false);
    onToast("历史版本已载入；检查后点击保存才会生效");
  }

  return (
    <>
    <Modal
      size="xl"
      eyebrow={recipe ? "编辑总 Prompt" : "新建总 Prompt"}
      title={deriveRecipeTitle(draft.title, draft.positivePrompt)}
      onClose={onClose}
      footer={
        <>
          <div
            className={clsx(
              "save-hint",
              (saveError || translationError) && "save-hint-error",
              translating && "save-hint-busy",
            )}
            role={saveError || translationError ? "alert" : "status"}
          >
            {saveError ? (
              saveError
            ) : statusLine ? (
              statusLine
            ) : translationError ? (
              translationError.message
            ) : (
              <>
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 保存
                （总 Prompt 需手动点「自动翻译」）
              </>
            )}
          </div>
          {recipe ? (
            <Button
              variant="ghost"
              icon={<History size={16} />}
              onClick={() => setHistoryOpen(true)}
            >
              修改历史
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            type="button"
            disabled={saving || translating}
            icon={<Check size={16} />}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : translating ? "翻译中…" : "保存"}
          </Button>
        </>
      }
    >
      <div className="recipe-editor">
        <div className="editor-heading-row">
          <Field label="标题（选填）" className="editor-title-field">
            <input
              autoFocus
              value={draft.title}
              placeholder="留空将使用正向 Prompt 开头自动命名"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </Field>
          <div className="status-switch">
            <button
              type="button"
              className={draft.status === "draft" ? "is-active" : ""}
              onClick={() => setStatus("draft")}
            >
              草稿
            </button>
            <button
              type="button"
              className={draft.status === "reproducible" ? "is-active" : ""}
              onClick={() => setStatus("reproducible")}
            >
              <Check size={14} />可复现
            </button>
          </div>
        </div>

        <Field
          label="Recipe tags"
          hint="Select one or more tags to group and filter recipes"
        >
          <div className="pose-tag-picker">
            {recipeTags.map((tag) => {
              const active = (draft.tagIds ?? []).includes(tag.id);
              return (
                <button
                  type="button"
                  key={tag.id}
                  className={clsx("recipe-tag-chip", active && "is-active")}
                  style={
                    active
                      ? { background: tag.color, borderColor: tag.color }
                      : { borderColor: tag.color, color: tag.color }
                  }
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </Field>

        <nav className="editor-tabs">
          <button
            className={tab === "prompt" ? "is-active" : ""}
            type="button"
            onClick={() => setTab("prompt")}
          >
            <WandSparkles size={16} />Prompt 内容
          </button>
          <button
            className={tab === "params" ? "is-active" : ""}
            type="button"
            onClick={() => setTab("params")}
          >
            <SlidersHorizontal size={16} />模型与参数
          </button>
          <button
            className={tab === "images" ? "is-active" : ""}
            type="button"
            onClick={() => setTab("images")}
          >
            <FileImage size={16} />示例图与备注
            {draft.assets.length ? <i>{draft.assets.length}</i> : null}
          </button>
        </nav>

        {tab === "prompt" ? (
          <div className="editor-prompt-pane" onPaste={onPaste}>
            <div className="prompt-field-head">
              <div>
                <strong>正向 Prompt</strong>
                <span>英文原文是可无损复制的权威内容</span>
              </div>
              <div className="prompt-field-head-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Clipboard size={15} />}
                  onClick={() =>
                    void navigator.clipboard.readText().then((text) => {
                      if (!text.trim()) {
                        onToast("剪贴板里没有文本");
                        return;
                      }
                      importPositivePrompt(text);
                    })
                  }
                >
                  粘贴文本
                </Button>
              </div>
            </div>
            <textarea
              className="prompt-textarea"
              rows={6}
              value={draft.positivePrompt}
              placeholder="masterpiece, best quality, a portrait of…"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  positivePrompt: event.target.value,
                }))
              }
              onPaste={(event) => {
                const text = event.clipboardData.getData("text/plain");
                if (!text.trim()) return;
                // 粘贴视为整段导入；不自动翻译，避免长文卡住编辑器。
                event.preventDefault();
                importPositivePrompt(text);
              }}
            />
            <div className="translation-head">
              <span><Languages size={15} />中文译文</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={translating || saving || !draft.positivePrompt.trim()}
                onClick={() => void translate("positive")}
              >
                {translating ? "翻译中…" : "自动翻译"}
              </Button>
            </div>
            <textarea
              className="translation-textarea"
              rows={3}
              value={draft.positiveTranslation}
              placeholder="可手工输入中文译文，便于理解和搜索"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  positiveTranslation: event.target.value,
                }))
              }
            />
            {translationError?.field === "positive" ? (
              <span className="save-hint-error" role="alert">
                {translationError.message}
              </span>
            ) : null}
            <div className="preview-title">
              <span>智能拆卡预览</span>
              <small>仅在顶层分隔，不改动原文</small>
            </div>
            <PromptChipEditor
              prompt={draft.positivePrompt}
              translation={draft.positiveTranslation}
              onChange={(positivePrompt, positiveTranslation) =>
                setDraft((current) => ({
                  ...current,
                  positivePrompt,
                  positiveTranslation,
                }))
              }
              onSaveSnippet={(text, translation) =>
                onSaveSnippet(
                  text,
                  translation,
                  draft.title.trim() || "未命名总 Prompt",
                )
              }
            />

            <div className="prompt-field-head negative-head">
              <div>
                <strong>负向 Prompt</strong>
                <span>不希望出现在画面中的内容</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={<Languages size={15} />}
                disabled={translating || !draft.negativePrompt.trim()}
                onClick={() => void translate("negative")}
              >
                翻译
              </Button>
            </div>
            <textarea
              className="prompt-textarea prompt-textarea-small"
              rows={3}
              value={draft.negativePrompt}
              placeholder="blurry, low quality, watermark…"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  negativePrompt: event.target.value,
                }))
              }
            />
            <textarea
              className="translation-textarea"
              rows={2}
              value={draft.negativeTranslation}
              placeholder="负向 Prompt 中文译文"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  negativeTranslation: event.target.value,
                }))
              }
            />
            {translationError?.field === "negative" ? (
              <span className="save-hint-error" role="alert">
                {translationError.message}
              </span>
            ) : null}
          </div>
        ) : null}

        {tab === "params" ? (
          <div className="editor-params-pane">
            <section className="editor-section-card">
              <div className="section-heading">
                <div>
                  <h3>基础模型</h3>
                  <p>保存模型快照，目录变化不会悄悄改坏旧配方。</p>
                </div>
                <Badge tone={draft.modelId ? "success" : "neutral"}>
                  {draft.modelId ? "已选择" : "可留空（推荐选常用模型）"}
                </Badge>
              </div>
              <div className="resource-picker-search">
                <Search size={16} aria-hidden="true" />
                <input
                  value={modelQuery}
                  placeholder="搜索模型名称、路径或底模"
                  aria-label="搜索基础模型"
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
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <Field label="Checkpoint / Diffusion model">
                <Select
                  value={draft.modelId || ""}
                  onChange={(event) => selectModel(event.target.value)}
                >
                  <option value="">暂不填写模型</option>
                  {filteredModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.available ? "" : "[离线] "}
                      {model.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {modelQuery && filteredModels.length === 0 ? (
                <div className="picker-empty">没有找到匹配的模型</div>
              ) : null}
            </section>

            <section className="editor-section-card">
              <div className="section-heading">
                <div>
                  <h3>LoRA 堆栈</h3>
                  <p>按照下方顺序加载，并独立保存模型与 CLIP 权重。</p>
                </div>
                <div className="lora-picker-wrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Sparkles size={15} />}
                    onClick={() => applyDetectedLoras(false)}
                  >
                    从 Prompt 识别
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={15} />}
                    onClick={() => setLoraPicker((open) => !open)}
                  >
                    添加 LoRA
                  </Button>
                </div>
              </div>
              <p className="field-hint lora-detect-hint">
                会根据 {"<lora:名称>"} 标签与<strong>角色触发词</strong>
                （如 XiaoXunEr IL）自动附加；masterpiece / 3d
                等泛用词不会关联。不会移除你手动添加的项。
              </p>
              {loraPicker ? (
                <div
                  className="lora-picker"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setLoraPicker(false);
                    }
                  }}
                >
                  <div className="lora-picker-head">
                    <div>
                      <strong>选择 LoRA</strong>
                      <small>可连续选择多个，已选项目会固定在最前面</small>
                    </div>
                    <IconButton
                      label="关闭 LoRA 选择器"
                      onClick={() => setLoraPicker(false)}
                    >
                      <X size={16} />
                    </IconButton>
                  </div>
                  <div className="resource-picker-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      autoFocus
                      value={loraQuery}
                      placeholder="搜索 LoRA、底模、路径或触发词"
                      aria-label="搜索 LoRA"
                      onChange={(event) => setLoraQuery(event.target.value)}
                    />
                    <small>
                      {filteredLoras.length}/{loras.length}
                    </small>
                    {loraQuery ? (
                      <button
                        type="button"
                        aria-label="清空 LoRA 搜索"
                        onClick={() => setLoraQuery("")}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>
                  {filteredLoras.length ? (
                    <div className="lora-picker-list">
                      {filteredLoras.map((lora) => {
                        const selected = draft.loras.some(
                          (item) => item.resourceId === lora.id,
                        );
                        return (
                          <button
                            type="button"
                            key={lora.id}
                            className={selected ? "is-selected" : ""}
                            onClick={() => toggleLora(lora)}
                          >
                            <span>
                              <strong>{lora.name}</strong>
                              <small>
                                {lora.available ? "" : "目录离线 · "}
                                {lora.baseModel || "未知底模"}
                              </small>
                            </span>
                            {selected ? <Check size={16} /> : <Plus size={16} />}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="picker-empty">
                      没有找到匹配的 LoRA，请换一个关键词
                    </div>
                  )}
                </div>
              ) : null}
              {draft.loras.length ? (
                <div className="selected-loras">
                  {draft.loras.map((lora) => (
                    <article key={lora.resourceId} className="selected-lora">
                      <GripVertical size={17} className="drag-handle" />
                      <div className="selected-lora-main">
                        <div className="selected-lora-title">
                          <strong>{lora.name}</strong>
                          <small>加载顺序 {lora.order + 1}</small>
                        </div>
                        <div className="lora-weight-row">
                          <Field label="模型权重">
                            <input
                              type="number"
                              min="0"
                              max="2"
                              step="0.05"
                              value={lora.modelStrength}
                              onChange={(event) =>
                                updateLora(lora.resourceId, {
                                  modelStrength: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label="CLIP 权重">
                            <input
                              type="number"
                              min="0"
                              max="2"
                              step="0.05"
                              value={lora.clipStrength}
                              onChange={(event) =>
                                updateLora(lora.resourceId, {
                                  clipStrength: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                        </div>
                        <div className="trigger-list">
                          <span>触发词</span>
                          {lora.triggerWords.length ? (
                            lora.triggerWords.map((trigger) => {
                              const active =
                                lora.enabledTriggerWords.includes(trigger);
                              return (
                                <button
                                  key={trigger}
                                  type="button"
                                  className={active ? "is-active" : ""}
                                  onClick={() =>
                                    toggleTrigger(lora.resourceId, trigger)
                                  }
                                >
                                  {active ? <Check size={12} /> : null}
                                  {trigger}
                                </button>
                              );
                            })
                          ) : (
                            <small>暂无触发词，可在“模型与 LoRA”中补充</small>
                          )}
                        </div>
                      </div>
                      <IconButton
                        label="移除此 LoRA"
                        onClick={() => {
                          const resource = loras.find(
                            (item) => item.id === lora.resourceId,
                          );
                          if (resource) toggleLora(resource);
                        }}
                      >
                        <X size={17} />
                      </IconButton>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Sparkles size={23} />}
                  title="还没有添加 LoRA"
                  description="这是可选项；添加后会一起保存权重与触发词快照。"
                />
              )}
            </section>

            <section className="editor-section-card">
              <div className="section-heading">
                <div>
                  <h3>生成参数</h3>
                  <p>
                    尺寸 / 采样器 / 步数 / CFG
                    可全部留空（你全局同一套设置时不必每条都填）。可复现只要求有正向
                    Prompt。
                  </p>
                </div>
                <div className="parameter-heading-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        params: { ...EMPTY_GENERATION_PARAMS },
                      }))
                    }
                  >
                    全部留空
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        params: { ...RECOMMENDED_GENERATION_PARAMS },
                      }))
                    }
                  >
                    使用推荐值
                  </Button>
                </div>
              </div>
              <div className="parameter-grid">
                <Field label="宽度">
                  <input
                    type="number"
                    min="64"
                    step="64"
                    value={draft.params.width ?? ""}
                    placeholder="不填写"
                    onChange={(event) =>
                      updateGenerationParam(
                        "width",
                        event.currentTarget.value === ""
                          ? null
                          : event.currentTarget.valueAsNumber,
                      )
                    }
                  />
                </Field>
                <Field label="高度">
                  <input
                    type="number"
                    min="64"
                    step="64"
                    value={draft.params.height ?? ""}
                    placeholder="不填写"
                    onChange={(event) =>
                      updateGenerationParam(
                        "height",
                        event.currentTarget.value === ""
                          ? null
                          : event.currentTarget.valueAsNumber,
                      )
                    }
                  />
                </Field>
                <Field label="采样器">
                  <Select
                    value={draft.params.sampler ?? ""}
                    onChange={(event) =>
                      updateGenerationParam(
                        "sampler",
                        event.target.value || null,
                      )
                    }
                  >
                    <option value="">不填写</option>
                    {draft.params.sampler &&
                    !(SAMPLERS as readonly string[]).includes(
                      draft.params.sampler,
                    ) ? (
                      <option value={draft.params.sampler}>
                        {draft.params.sampler}
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
                    value={draft.params.scheduler ?? ""}
                    onChange={(event) =>
                      updateGenerationParam(
                        "scheduler",
                        event.target.value || null,
                      )
                    }
                  >
                    <option value="">不填写</option>
                    {draft.params.scheduler &&
                    !(SCHEDULERS as readonly string[]).includes(
                      draft.params.scheduler,
                    ) ? (
                      <option value={draft.params.scheduler}>
                        {draft.params.scheduler}
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
                    value={draft.params.steps ?? ""}
                    placeholder="不填写"
                    onChange={(event) =>
                      updateGenerationParam(
                        "steps",
                        event.currentTarget.value === ""
                          ? null
                          : event.currentTarget.valueAsNumber,
                      )
                    }
                  />
                </Field>
                <Field label="CFG">
                  <input
                    type="number"
                    min="0"
                    max="30"
                    step="0.1"
                    value={draft.params.cfg ?? ""}
                    placeholder="不填写"
                    onChange={(event) =>
                      updateGenerationParam(
                        "cfg",
                        event.currentTarget.value === ""
                          ? null
                          : event.currentTarget.valueAsNumber,
                      )
                    }
                  />
                </Field>
                <Field label="Seed" className="seed-field">
                  <input
                    value={draft.params.seed ?? ""}
                    placeholder="不填写"
                    onChange={(event) =>
                      updateGenerationParam(
                        "seed",
                        event.target.value || null,
                      )
                    }
                  />
                  <small>留空表示未记录；-1 代表每次随机</small>
                </Field>
              </div>
            </section>
          </div>
        ) : null}

        {tab === "images" ? (
          <div className="editor-images-pane" onPaste={onPaste}>
            <section
              className={clsx("image-drop-zone", dropActive && "is-active")}
              onDragOver={(event: DragEvent) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={() => setDropActive(false)}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                setDropActive(false);
                void addFiles(Array.from(event.dataTransfer.files));
              }}
              onClick={() => fileRef.current?.click()}
            >
              <span className="drop-icon"><ImagePlus size={23} /></span>
              <div>
                <strong>拖入图片，或点击选择</strong>
                <span>也可以在这个窗口任意位置按 Ctrl + V 直接粘贴</span>
              </div>
              <Button variant="secondary" size="sm" type="button">
                选择图片
              </Button>
              <input
                ref={fileRef}
                hidden
                multiple
                accept="image/*"
                type="file"
                onChange={(event) =>
                  void addFiles(Array.from(event.target.files ?? []))
                }
              />
            </section>
            {draft.assets.length ? (
              <div className="asset-grid">
                {draft.assets.map((asset) => (
                  <article
                    key={asset.id}
                    className={clsx(
                      "asset-card",
                      draft.coverAssetId === asset.id && "is-cover",
                    )}
                  >
                    <div className={privacyMode ? "is-private" : ""}>
                      {privacyMode || !asset.url ? (
                        <div className="asset-privacy-placeholder" aria-label="隐私模式已隐藏示例图">
                          已隐藏
                        </div>
                      ) : (
                        <img src={asset.url} alt={asset.name} loading="lazy" />
                      )}
                    </div>
                    <footer>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            coverAssetId: asset.id,
                          }))
                        }
                      >
                        {draft.coverAssetId === asset.id ? (
                          <><Check size={13} />封面</>
                        ) : (
                          "设为封面"
                        )}
                      </button>
                      <IconButton
                        label="移除图片"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            assets: current.assets.filter(
                              (item) => item.id !== asset.id,
                            ),
                            coverAssetId:
                              current.coverAssetId === asset.id
                                ? current.assets.find(
                                    (item) => item.id !== asset.id,
                                  )?.id
                                : current.coverAssetId,
                          }))
                        }
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<FileImage size={23} />}
                title="还没有示例图"
                description="示例图会显著提高以后找到和理解 Prompt 的速度。"
              />
            )}
            <Field label="经验备注" hint="只有你自己能看到">
              <textarea
                rows={5}
                value={draft.notes}
                placeholder="记录权重变化、容易踩坑的地方、适合的出图场景…"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="个人评分">
              <div className="rating-picker">
                {Array.from({ length: 5 }, (_, index) => (
                  <button
                    type="button"
                    aria-label={`${index + 1} 星`}
                    key={index}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        rating: current.rating === index + 1 ? 0 : index + 1,
                      }))
                    }
                  >
                    <Star
                      size={22}
                      fill={index < draft.rating ? "currentColor" : "none"}
                    />
                  </button>
                ))}
              </div>
            </Field>
          </div>
        ) : null}
      </div>
    </Modal>
    {historyOpen && recipe ? (
      <RevisionHistory
        entityType="recipe"
        entityId={recipe.id}
        onClose={() => setHistoryOpen(false)}
        onApply={applyRevision}
        onToast={onToast}
      />
    ) : null}
    </>
  );
}

export function RecipePage({
  recipes,
  resources,
  recipeTags,
  privacyMode,
  targetLanguage,
  requestedRecipeId,
  onClearRequestedRecipe,
  onSave,
  onSaveSnippet,
  onDelete,
  onOpenStudio,
  onToast,
}: {
  recipes: Recipe[];
  resources: Resource[];
  recipeTags: RecipeTag[];
  privacyMode: boolean;
  targetLanguage: string;
  requestedRecipeId?: string;
  onClearRequestedRecipe: () => void;
  onSave: (recipe: RecipeInput) => Promise<void>;
  onSaveSnippet: (
    text: string,
    translation: string,
    sourceTitle: string,
  ) => Promise<boolean>;
  onDelete: (recipe: Recipe) => Promise<void>;
  onOpenStudio: () => void;
  onToast: (message: string) => void;
}) {
  const [filter, setFilter] = useState<RecipeFilter>("all");
  const [poseFilter, setPoseFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "rating" | "usage">("updated");
  const [editing, setEditing] = useState<Recipe | "new" | null>(null);

  useEffect(() => {
    if (!requestedRecipeId) return;
    const recipe = recipes.find((item) => item.id === requestedRecipeId);
    if (recipe) setEditing(recipe);
    onClearRequestedRecipe();
  }, [onClearRequestedRecipe, recipes, requestedRecipeId]);

  useEffect(() => {
    function openNew() {
      setEditing("new");
    }
    window.addEventListener("promptnook:new", openNew);
    return () => window.removeEventListener("promptnook:new", openNew);
  }, []);

  const visibleRecipes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return recipes
      .filter((recipe) => {
        if (filter === "favorite" && !recipe.favorite) return false;
        if (filter === "reproducible" && recipe.status !== "reproducible")
          return false;
        if (filter === "draft" && recipe.status !== "draft") return false;
        if (
          poseFilter !== "all" &&
          !(recipe.tagIds ?? []).includes(poseFilter)
        ) {
          return false;
        }
        if (
          needle &&
          ![
            recipe.title,
            recipe.positivePrompt,
            recipe.positiveTranslation,
            recipe.modelName,
            ...(recipe.tagIds ?? []).map(
              (id) => recipeTags.find((tag) => tag.id === id)?.name ?? "",
            ),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sort === "rating") return b.rating - a.rating;
        if (sort === "usage") return b.usageCount - a.usageCount;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [filter, poseFilter, query, recipeTags, recipes, sort]);

  return (
    <div className="page recipes-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">灵感与成品</span>
          <h1>总 Prompt</h1>
          <p>保存完整配方，带着模型、LoRA 与参数一起回来。</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={<WandSparkles size={16} />}
            onClick={onOpenStudio}
          >
            去创作台组合
          </Button>
          <Button
            icon={<Plus size={17} />}
            onClick={() => setEditing("new")}
          >
            新建总 Prompt
          </Button>
        </div>
      </header>

      <section className="toolbar">
        <div className="segmented-filter" aria-label="总 Prompt 筛选">
          {(
            [
              ["all", "全部", recipes.length],
              [
                "favorite",
                "收藏",
                recipes.filter((item) => item.favorite).length,
              ],
              [
                "reproducible",
                "可复现",
                recipes.filter((item) => item.status === "reproducible").length,
              ],
              [
                "draft",
                "草稿",
                recipes.filter((item) => item.status === "draft").length,
              ],
            ] as const
          ).map(([key, label, count]) => (
            <button
              type="button"
              key={key}
              className={filter === key ? "is-active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}<i>{count}</i>
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <label className="inline-search">
          <Search size={16} />
          <input
            value={query}
            placeholder="筛选当前列表"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          ) : null}
        </label>
        <span className="toolbar-select-icon"><Filter size={15} /></span>
        <Select
          value={poseFilter}
          onChange={(event) => setPoseFilter(event.target.value)}
          aria-label="Filter by tag"
        >
          <option value="all">All tags</option>
          {recipeTags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
              {typeof tag.recipeCount === "number"
                ? ` (${tag.recipeCount})`
                : ""}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(event) =>
            setSort(event.target.value as "updated" | "rating" | "usage")
          }
        >
          <option value="updated">最近修改</option>
          <option value="rating">评分最高</option>
          <option value="usage">最常使用</option>
        </Select>
      </section>

      {visibleRecipes.length ? (
        <div className="card-grid recipe-grid">
          {visibleRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              recipeTags={recipeTags}
              privacyMode={privacyMode}
              onOpen={() => setEditing(recipe)}
              onFavorite={() =>
                void onSave({ ...recipe, favorite: !recipe.favorite }).catch(
                  (error) =>
                    onToast(`收藏状态保存失败：${readableError(error)}`),
                )
              }
              onDelete={() => void onDelete(recipe)}
              onSave={onSave}
              onToast={onToast}
            />
          ))}
          <button
            type="button"
            className="new-recipe-card"
            onClick={() => setEditing("new")}
          >
            <span><FolderPlus size={23} /></span>
            <strong>保存新的灵感</strong>
            <small>从一句 Prompt 开始也可以</small>
          </button>
        </div>
      ) : (
        <EmptyState
          icon={<Search size={24} />}
          title="没有找到符合条件的 Prompt"
          description="调整筛选或搜索词，也可以直接新建一个。"
          action={
            <Button icon={<Plus size={16} />} onClick={() => setEditing("new")}>
              新建总 Prompt
            </Button>
          }
        />
      )}

      {editing ? (
        <RecipeEditor
          recipe={editing === "new" ? undefined : editing}
          resources={resources}
          recipeTags={recipeTags}
          privacyMode={privacyMode}
          targetLanguage={targetLanguage}
          onClose={() => setEditing(null)}
          onSave={onSave}
          onSaveSnippet={onSaveSnippet}
          onToast={onToast}
        />
      ) : null}

    </div>
  );
}

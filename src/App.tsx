import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  ChevronLeft,
  Command,
  Eye,
  EyeOff,
  FileText,
  HardDrive,
  Lightbulb,
  Menu,
  Plus,
  Search,
  ShieldAlert,
  Settings as SettingsIcon,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import "./App.css";
import { api, isDesktopRuntime } from "./lib/api";
import type {
  AppData,
  AppSettings,
  Category,
  HealthStatus,
  PageKey,
  Recipe,
  RecipeInput,
  Resource,
  ResourceScanResult,
  SearchResult,
  Snippet,
  SnippetInput,
  Tip,
  TipInput,
} from "./types";
import { deriveRecipeTitle } from "./lib/recipeTitle";
import {
  normalizePromptModelId,
  promptModelLabel,
  type PromptModelId,
} from "./lib/promptModels";
import { RecipePage } from "./components/RecipePage";
import { SnippetPage } from "./components/SnippetPage";
import { StudioPage } from "./components/StudioPage";
import { ResourcePage } from "./components/ResourcePage";
import { TipsPage } from "./components/TipsPage";
import { SearchPalette } from "./components/SearchPalette";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { IconButton, SkeletonCards } from "./components/ui";

const navigation: {
  key: PageKey;
  label: string;
  description: string;
  icon: typeof FileText;
}[] = [
  {
    key: "recipes",
    label: "Recipes",
    description: "Complete prompts",
    icon: FileText,
  },
  {
    key: "snippets",
    label: "Snippets",
    description: "Reusable phrases",
    icon: Sparkles,
  },
  {
    key: "studio",
    label: "Studio",
    description: "Compose and explore",
    icon: WandSparkles,
  },
  {
    key: "resources",
    label: "Models & LoRA",
    description: "Local resources",
    icon: Boxes,
  },
  {
    key: "tips",
    label: "Notes",
    description: "Knowledge base",
    icon: Lightbulb,
  },
];

type RequestedEntity =
  | { type: "recipe"; id: string }
  | { type: "snippet"; id: string }
  | { type: "resource"; id: string }
  | { type: "tip"; id: string }
  | null;

interface ToastMessage {
  id: number;
  message: string;
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [page, setPage] = useState<PageKey>("recipes");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] =
    useState<"general" | "translation" | "backup" | "trash">("general");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [requested, setRequested] = useState<RequestedEntity>(null);
  const [queuedSnippet, setQueuedSnippet] = useState<Snippet | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((current) => [...current, { id, message }].slice(-3));
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3300);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const nextData = await api.loadAll();
      setData(nextData);
      try {
        setHealth(await api.healthCheck());
      } catch {
        setHealth(null);
      }
    } catch (error) {
      setLoadError(
        `无法打开数据保险箱：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (
      !isDesktopRuntime() ||
      health === null ||
      health.recoveryMode
    )
      return;
    let active = true;
    async function refreshResources(scan: boolean) {
      try {
        const resources = scan
          ? (await api.scanResources()).resources
          : await api.listResources();
        if (!active) return;
        setData((current) =>
          current
            ? {
                ...current,
                resources,
                dashboard: {
                  ...current.dashboard,
                  resourceCount: resources.length,
                  resourcePathsOnline: resources.some(
                    (resource) => resource.available,
                  ),
                },
              }
            : current,
        );
      } catch {
        // A temporarily offline model drive is represented by cached resources;
        // it must not prevent the rest of the vault from opening.
      }
    }
    const initialRefresh = window.setTimeout(
      () => void refreshResources(false),
      1_800,
    );
    const periodicScan = window.setInterval(
      () => void refreshResources(true),
      5 * 60_000,
    );
    return () => {
      active = false;
      window.clearTimeout(initialRefresh);
      window.clearInterval(periodicScan);
    };
  }, [health]);

  useEffect(() => {
    function onKeyboard(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (modifier && event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (page === "studio") {
          showToast("创作台已经是一张新画布");
          return;
        }
        window.dispatchEvent(new CustomEvent("promptnook:new"));
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setSidebarOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyboard);
    return () => window.removeEventListener("keydown", onKeyboard);
  }, [page, showToast]);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
      setSearchResults([]);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api
        .searchAll(searchQuery)
        .then(setSearchResults)
        .finally(() => setSearching(false));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery]);

  const navCounts = useMemo(
    () => ({
      recipes: data?.recipes.length,
      snippets: data?.snippets.length,
      resources: data?.resources.length,
      tips: data?.tips.length,
    }),
    [data],
  );

  function selectPage(nextPage: PageKey) {
    setPage(nextPage);
    setSidebarOpen(false);
  }

  function selectSearchResult(result: SearchResult) {
    const pageByType: Record<SearchResult["entityType"], PageKey> = {
      recipe: "recipes",
      snippet: "snippets",
      resource: "resources",
      tip: "tips",
    };
    setRequested({ type: result.entityType, id: result.id });
    selectPage(pageByType[result.entityType]);
    setSearchOpen(false);
  }

  async function saveRecipe(input: RecipeInput) {
    const recipe = await api.saveRecipe(input);
    setData((current) => {
      if (!current) return current;
      const exists = current.recipes.some((item) => item.id === recipe.id);
      return {
        ...current,
        recipes: exists
          ? current.recipes.map((item) =>
              item.id === recipe.id ? recipe : item,
            )
          : [recipe, ...current.recipes],
        dashboard: {
          ...current.dashboard,
          recipeCount: exists
            ? current.dashboard.recipeCount
            : current.dashboard.recipeCount + 1,
        },
      };
    });
    showToast("总 Prompt 已保存");
  }

  async function deleteRecipe(recipe: Recipe) {
    const displayTitle = deriveRecipeTitle(
      recipe.title,
      recipe.positivePrompt,
      recipe.updatedAt,
    );
    if (!window.confirm(`将“${displayTitle}”移入回收站？`)) return;
    await api.deleteRecipe(recipe.id);
    setData((current) =>
      current
        ? {
            ...current,
            recipes: current.recipes.filter((item) => item.id !== recipe.id),
          }
        : current,
    );
    showToast("已移入回收站，可在设置中恢复");
  }

  async function saveSnippet(input: SnippetInput) {
    const snippet = await api.saveSnippet(input);
    setData((current) => {
      if (!current) return current;
      const exists = current.snippets.some((item) => item.id === snippet.id);
      return {
        ...current,
        snippets: exists
          ? current.snippets.map((item) =>
              item.id === snippet.id ? snippet : item,
            )
          : [snippet, ...current.snippets],
      };
    });
    showToast("单 Prompt 已保存");
  }

  async function deleteSnippet(snippet: Snippet) {
    if (!window.confirm(`将“${snippet.text}”移入回收站？`)) return;
    await api.deleteSnippet(snippet.id);
    setData((current) =>
      current
        ? {
            ...current,
            snippets: current.snippets.filter((item) => item.id !== snippet.id),
          }
        : current,
    );
    showToast("已移入回收站");
  }

  async function incrementSnippetUsage(id: string) {
    try {
      await api.incrementSnippetUsage(id);
      setData((current) =>
        current
          ? {
              ...current,
              snippets: current.snippets.map((snippet) =>
                snippet.id === id
                  ? {
                      ...snippet,
                      usageCount: snippet.usageCount + 1,
                      updatedAt: new Date().toISOString(),
                    }
                  : snippet,
              ),
            }
          : current,
      );
    } catch {
      showToast("词条已加入画布，但使用次数暂未同步");
    }
  }

  async function saveCategory(category: Category) {
    const saved = await api.saveCategory(category);
    setData((current) => {
      if (!current) return current;
      const exists = current.categories.some((item) => item.id === saved.id);
      return {
        ...current,
        categories: exists
          ? current.categories.map((item) =>
              item.id === saved.id ? saved : item,
            )
          : [...current.categories, saved],
      };
    });
  }

  async function deleteCategory(category: Category) {
    if (
      !window.confirm(
        `删除分类“${category.name}”？词条本身不会删除，只会解除这个分类。`,
      )
    )
      return;
    await api.deleteCategory(category.id);
    setData((current) =>
      current
        ? {
            ...current,
            categories: current.categories.filter(
              (item) => item.id !== category.id,
            ),
            snippets: current.snippets.map((snippet) => ({
              ...snippet,
              categoryIds: snippet.categoryIds.filter(
                (id) => id !== category.id,
              ),
            })),
          }
        : current,
    );
    showToast("分类已移入回收站");
  }

  async function saveResource(resource: Resource) {
    const saved = await api.saveResource(resource);
    setData((current) =>
      current
        ? {
            ...current,
            resources: current.resources.map((item) =>
              item.id === saved.id ? saved : item,
            ),
          }
        : current,
    );
    showToast("模型信息已保存");
  }

  function acceptScan(result: ResourceScanResult) {
    setData((current) =>
      current ? { ...current, resources: result.resources } : current,
    );
  }

  async function saveTip(input: TipInput) {
    const tip = await api.saveTip(input);
    setData((current) => {
      if (!current) return current;
      const exists = current.tips.some((item) => item.id === tip.id);
      return {
        ...current,
        tips: exists
          ? current.tips.map((item) => (item.id === tip.id ? tip : item))
          : [tip, ...current.tips],
      };
    });
    showToast("技巧已保存");
  }

  async function deleteTip(tip: Tip) {
    if (!window.confirm(`将“${tip.title}”移入回收站？`)) return;
    await api.deleteTip(tip.id);
    setData((current) =>
      current
        ? {
            ...current,
            tips: current.tips.filter((item) => item.id !== tip.id),
          }
        : current,
    );
    showToast("已移入回收站");
  }

  async function saveSettings(settings: AppSettings | Partial<AppSettings>) {
    const saved = await api.saveSettings(settings);
    setData((current) =>
      current ? { ...current, settings: saved } : current,
    );
  }

  async function switchPromptModel(next: PromptModelId) {
    if (!data) return;
    const current = normalizePromptModelId(data.settings.activePromptModel);
    if (current === next) return;
    try {
      // Only patch the active model so studio defaults stay independent.
      await api.saveSettings({ activePromptModel: next });
      const nextData = await api.loadAll();
      setData(nextData);
      setRequested(null);
      setQueuedSnippet(undefined);
      showToast(
        `Switched to ${promptModelLabel(next, data.settings.promptModels)}. Its recipes and snippets are kept separate.`,
      );
    } catch (error) {
      showToast(
        `Could not switch workspace: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function togglePrivacy() {
    if (!data) return;
    const previous = data;
    const settings = {
      ...data.settings,
      privacyMode: !data.settings.privacyMode,
    };
    setData({ ...data, settings });
    try {
      await api.saveSettings({ privacyMode: settings.privacyMode });
      showToast(
        settings.privacyMode
          ? "Privacy mode enabled: previews are no longer loaded"
          : "Privacy mode disabled",
      );
    } catch {
      setData(previous);
    }
  }

  const requestedId = (type: NonNullable<RequestedEntity>["type"]) =>
    requested?.type === type ? requested.id : undefined;

  return (
    <div
      className={clsx(
        "app-shell",
        sidebarCompact && "sidebar-compact",
        data?.settings.privacyMode && "privacy-mode",
      )}
    >
      <aside className={clsx("app-sidebar", sidebarOpen && "is-mobile-open")}>
        <div className="brand">
          <img src="/promptnook-icon.png" alt="" />
          <div>
            <strong>PromptNook</strong>
            <span>Your local prompt studio</span>
          </div>
          <IconButton
            className="sidebar-collapse"
            label={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCompact((compact) => !compact)}
          >
            <ChevronLeft size={17} />
          </IconButton>
          <IconButton
            className="sidebar-mobile-close"
            label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
          </IconButton>
        </div>

        <button
          type="button"
          className="sidebar-search"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={17} />
          <span>Search everything</span>
          <kbd>Ctrl K</kbd>
        </button>

        {data ? (
          <div className="prompt-model-switch" role="group" aria-label="Prompt workspaces">
            <span className="nav-label">Workspaces</span>
            <div className="prompt-model-switch-buttons">
              {data.settings.promptModels.map((model) => {
                const active =
                  normalizePromptModelId(data.settings.activePromptModel) ===
                  model.id;
                return (
                  <button
                    type="button"
                    key={model.id}
                    className={active ? "is-active" : ""}
                    title={model.description}
                    onClick={() => void switchPromptModel(model.id)}
                  >
                    {model.name}
                  </button>
                );
              })}
            </div>
            <small className="prompt-model-switch-hint">
              Each workspace keeps separate libraries
            </small>
          </div>
        ) : null}

        <nav className="main-navigation">
          <span className="nav-label">Library</span>
          {navigation.map((item) => {
            const NavIcon = item.icon;
            const count =
              item.key === "studio"
                ? undefined
                : navCounts[item.key as keyof typeof navCounts];
            return (
              <button
                type="button"
                key={item.key}
                className={page === item.key ? "is-active" : ""}
                onClick={() => selectPage(item.key)}
              >
                <span className="nav-icon"><NavIcon size={18} /></span>
                <span className="nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                {typeof count === "number" ? <i>{count}</i> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        {data && !data.settings.backupPath ? (
          <button
            type="button"
            className="backup-nudge"
            onClick={() => {
              setSettingsTab("backup");
              setSettingsOpen(true);
            }}
          >
            <span><HardDrive size={17} /></span>
            <div>
              <strong>Set up a second backup</strong>
              <small>Protect against drive failure</small>
            </div>
          </button>
        ) : (
          <div className="backup-ok">
            <CheckCircle2 size={16} />
            <span>Backups configured</span>
          </div>
        )}
        <button
          type="button"
          className="sidebar-settings"
          onClick={() => {
            setSettingsTab("general");
            setSettingsOpen(true);
          }}
        >
          <span className="nav-icon"><SettingsIcon size={18} /></span>
          <span>Settings & safety</span>
        </button>
        <div className="runtime-label">
          <span className={isDesktopRuntime() ? "runtime-dot online" : "runtime-dot"} />
          {isDesktopRuntime() ? "Local desktop storage" : "Browser demo mode"}
          <small style={{ display: "block", marginTop: 4, opacity: 0.75 }}>
            Local-first · open source
          </small>
        </div>
      </aside>

      {sidebarOpen ? (
        <div
          className="mobile-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <section className="app-main">
        <header className="app-topbar">
          <IconButton
            className="mobile-menu-button"
            label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </IconButton>
          <div className="topbar-breadcrumb">
            <span>PromptNook</span>
            <i>/</i>
            <strong>{navigation.find((item) => item.key === page)?.label}</strong>
            {data ? (
              <>
                <i>/</i>
                <em className="topbar-model-badge">
                  {promptModelLabel(
                    data.settings.activePromptModel,
                    data.settings.promptModels,
                  )}
                </em>
              </>
            ) : null}
          </div>
          <span className="topbar-spacer" />
          {data ? (
            <div
              className="topbar-model-switch"
              role="group"
              aria-label="Switch prompt workspace"
            >
              {data.settings.promptModels.map((model) => {
                const active =
                  normalizePromptModelId(data.settings.activePromptModel) ===
                  model.id;
                return (
                  <button
                    type="button"
                    key={model.id}
                    className={active ? "is-active" : ""}
                    title={model.description}
                    onClick={() => void switchPromptModel(model.id)}
                  >
                  {model.name}
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            className="topbar-search"
            onClick={() => setSearchOpen(true)}
          >
            <Search size={15} />
            Search prompts…
            <span><Command size={12} /> K</span>
          </button>
          <IconButton
            label={data?.settings.privacyMode ? "Disable privacy mode" : "Enable privacy mode"}
            className={data?.settings.privacyMode ? "is-active" : ""}
            disabled={!data}
            onClick={() => void togglePrivacy()}
          >
            {data?.settings.privacyMode ? <EyeOff size={18} /> : <Eye size={18} />}
          </IconButton>
          <IconButton
            label="Settings"
            onClick={() => {
              setSettingsTab("general");
              setSettingsOpen(true);
            }}
          >
            <SettingsIcon size={18} />
          </IconButton>
          {page !== "studio" ? (
            <button
              type="button"
              className="quick-new"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("promptnook:new"))
              }
            >
              <Plus size={16} />
              新建
              <kbd>Ctrl N</kbd>
            </button>
          ) : null}
        </header>

        <div className="page-container">
          {health?.recoveryMode ? (
            <div className="recovery-banner" role="alert">
              <span><ShieldAlert size={21} /></span>
              <div>
                <strong>PromptNook entered safe recovery mode</strong>
                <p>
                  原数据库未被改写。当前显示的是临时空库，请从经过校验的快照恢复。
                  {health.recoveryError
                    ? ` 原因：${health.recoveryError}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSettingsTab("backup");
                  setSettingsOpen(true);
                }}
              >
                打开备份与恢复
              </button>
            </div>
          ) : null}
          {loading ? (
            <div className="loading-page">
              <div className="loading-heading">
                <span />
                <span />
              </div>
              <SkeletonCards count={4} />
            </div>
          ) : loadError ? (
            <div className="fatal-state">
              <span><HardDrive size={28} /></span>
              <h1>数据保险箱暂时无法打开</h1>
              <p>{loadError}</p>
              <button type="button" onClick={() => void load()}>
                重试
              </button>
            </div>
          ) : data ? (
            <>
              {page === "recipes" ? (
                <RecipePage
                  key={normalizePromptModelId(data.settings.activePromptModel)}
                  recipes={data.recipes}
                  resources={data.resources}
                  recipeTags={data.recipeTags}
                  privacyMode={data.settings.privacyMode}
                  targetLanguage={data.settings.translationTargetLanguage}
                  requestedRecipeId={requestedId("recipe")}
                  onClearRequestedRecipe={() => setRequested(null)}
                  onSave={saveRecipe}
                  onSaveSnippet={async (text, translation, sourceTitle) => {
                    const activeModel = normalizePromptModelId(
                      data.settings.activePromptModel,
                    );
                    const duplicate = data.snippets.find(
                      (snippet) =>
                        normalizePromptModelId(snippet.promptModel) ===
                          activeModel &&
                        snippet.text.trim().toLocaleLowerCase() ===
                          text.trim().toLocaleLowerCase(),
                    );
                    if (duplicate) {
                      showToast(
                        `单 Prompt 已存在：${duplicate.translation || duplicate.text}`,
                      );
                      return false;
                    }
                    await saveSnippet({
                      id: "",
                      text,
                      translation,
                      notes: `来源总 Prompt：${sourceTitle}`,
                      categoryIds: [],
                      favorite: false,
                      translationLocked: Boolean(translation.trim()),
                      promptModel: activeModel,
                    });
                    return true;
                  }}
                  onDelete={deleteRecipe}
                  onOpenStudio={() => selectPage("studio")}
                  onToast={showToast}
                />
              ) : null}
              {page === "snippets" ? (
                <SnippetPage
                  key={normalizePromptModelId(data.settings.activePromptModel)}
                  snippets={data.snippets}
                  categories={data.categories}
                  targetLanguage={data.settings.translationTargetLanguage}
                  requestedSnippetId={requestedId("snippet")}
                  onClearRequestedSnippet={() => setRequested(null)}
                  onSave={saveSnippet}
                  onDelete={deleteSnippet}
                  onSaveCategory={saveCategory}
                  onDeleteCategory={deleteCategory}
                  onUseInStudio={(snippet) => {
                    setQueuedSnippet(snippet);
                    selectPage("studio");
                  }}
                  onToast={showToast}
                />
              ) : null}
              {page === "studio" ? (
                <StudioPage
                  key={normalizePromptModelId(data.settings.activePromptModel)}
                  snippets={data.snippets}
                  categories={data.categories}
                  recipes={data.recipes}
                  resources={data.resources}
                  tips={data.tips}
                  settings={data.settings}
                  queuedSnippet={queuedSnippet}
                  onQueuedSnippetConsumed={() => setQueuedSnippet(undefined)}
                  onSaveRecipe={saveRecipe}
                  onSnippetUsed={incrementSnippetUsage}
                  onToast={showToast}
                />
              ) : null}
              {page === "resources" ? (
                <ResourcePage
                  resources={data.resources}
                  settings={data.settings}
                  privacyMode={data.settings.privacyMode}
                  requestedResourceId={requestedId("resource")}
                  onClearRequestedResource={() => setRequested(null)}
                  onScanComplete={acceptScan}
                  onSave={saveResource}
                  onOpenSettings={() => {
                    setSettingsTab("general");
                    setSettingsOpen(true);
                  }}
                  onToast={showToast}
                />
              ) : null}
              {page === "tips" ? (
                <TipsPage
                  tips={data.tips}
                  resources={data.resources}
                  categories={data.categories}
                  requestedTipId={requestedId("tip")}
                  onClearRequestedTip={() => setRequested(null)}
                  onSave={saveTip}
                  onDelete={deleteTip}
                  onToast={showToast}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      {searchOpen ? (
        <SearchPalette
          query={searchQuery}
          results={searchResults}
          loading={searching}
          onQueryChange={setSearchQuery}
          onClose={() => setSearchOpen(false)}
          onSelect={selectSearchResult}
        />
      ) : null}

      {settingsOpen && data ? (
        <SettingsDrawer
          key={settingsTab}
          settings={data.settings}
          initialTab={settingsTab}
          onClose={() => setSettingsOpen(false)}
          onSave={saveSettings}
          onDataChanged={load}
          onToast={showToast}
        />
      ) : null}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className="toast" key={toast.id}>
            <CheckCircle2 size={17} />
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() =>
                setToasts((current) =>
                  current.filter((item) => item.id !== toast.id),
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;

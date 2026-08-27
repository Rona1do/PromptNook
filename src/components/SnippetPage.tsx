import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  BookmarkPlus,
  Check,
  ChevronRight,
  Copy,
  Dices,
  FolderTree,
  GripVertical,
  History,
  Languages,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import clsx from "clsx";
import type { Category, Snippet, SnippetInput } from "../types";
import { api } from "../lib/api";
import { readableError } from "../lib/errors";
import { Button, EmptyState, Field, IconButton, Modal, Select, Toggle } from "./ui";
import { RevisionHistory } from "./RevisionHistory";

type SnippetFilter = "all" | "favorite" | "recent" | "least";

const categoryColors = [
  "#5d5fef",
  "#8a5cf5",
  "#d6578b",
  "#ef7a51",
  "#ec9d2d",
  "#35a27f",
  "#2c91b8",
  "#5178dc",
];

function newSnippet(defaultCategoryIds: string[] = []): SnippetInput {
  return {
    id: "",
    text: "",
    translation: "",
    notes: "",
    categoryIds: [...defaultCategoryIds],
    favorite: false,
    translationLocked: false,
  };
}

function SnippetEditor({
  snippet,
  snippets,
  categories,
  defaultCategoryIds = [],
  targetLanguage,
  onClose,
  onSave,
  onToast,
}: {
  snippet?: Snippet;
  snippets: Snippet[];
  categories: Category[];
  /** Pre-check these categories when creating a new snippet (e.g. current sidebar filter). */
  defaultCategoryIds?: string[];
  targetLanguage: string;
  onClose: () => void;
  onSave: (snippet: SnippetInput) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<SnippetInput>(
    snippet ? structuredClone(snippet) : newSnippet(defaultCategoryIds),
  );
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Source string that was translated via the explicit button. */
  const manualTranslatedSource = useRef("");
  const duplicate = snippets.find(
    (item) =>
      item.id !== draft.id &&
      item.text.trim().toLocaleLowerCase() ===
        draft.text.trim().toLocaleLowerCase(),
  );

  function needsTranslation(text: string, translation: string) {
    const source = text.trim();
    if (!source) return false;
    return !translation.trim();
  }

  async function translate(markManual = true) {
    if (!draft.text.trim()) return;
    setTranslationError("");
    setTranslating(true);
    setStatusLine("正在翻译单 Prompt…");
    try {
      const result = await api.translateText({
        text: draft.text,
        targetLanguage,
      });
      const translated = (result.text ?? "").trim();
      if (!translated) throw new Error("翻译服务返回了空译文");
      setDraft((current) => ({
        ...current,
        translation: translated,
        translationLocked: true,
      }));
      if (markManual) {
        manualTranslatedSource.current = draft.text.trim();
      }
      setStatusLine("翻译完成");
    } catch (error) {
      const message = `翻译失败：${readableError(error)}`;
      setTranslationError(message);
      setStatusLine(message);
      onToast(message);
    } finally {
      setTranslating(false);
    }
  }

  async function save() {
    setSaveError("");
    setStatusLine("");
    if (!draft.text.trim()) {
      const message = "英文原文不能为空";
      setSaveError(message);
      onToast(message);
      return;
    }
    if (duplicate) {
      const message = "已存在相同的单 Prompt，请编辑原词条";
      setSaveError(message);
      onToast(message);
      return;
    }

    const source = draft.text.trim();
    const willAuto =
      manualTranslatedSource.current !== source &&
      needsTranslation(source, draft.translation);

    setSaving(true);
    // 只翻一次：交给后端 save_snippet，前端不再先请求一遍。
    if (willAuto) {
      setTranslating(true);
      setStatusLine("正在翻译并保存（仅一次请求）…");
    } else {
      setStatusLine("正在保存…");
    }
    try {
      await onSave(draft);
      setStatusLine("已保存");
      onClose();
    } catch (error) {
      const message = `保存失败：${readableError(error)}`;
      setSaveError(message);
      setStatusLine(message);
      onToast(message);
    } finally {
      setTranslating(false);
      setSaving(false);
    }
  }

  function applyRevision(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== "object") {
      onToast("这个历史版本无法读取");
      return;
    }
    const restored = snapshot as Partial<SnippetInput>;
    if (typeof restored.text !== "string") {
      onToast("历史版本缺少英文原文字段");
      return;
    }
    setDraft((current) => ({
      ...current,
      ...restored,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
    }));
    setHistoryOpen(false);
    onToast("历史版本已载入；检查后点击保存才会生效");
  }

  return (
    <>
    <Modal
      title={snippet ? "编辑单 Prompt" : "新建单 Prompt"}
      eyebrow="灵感词条"
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
            {saveError
              ? saveError
              : statusLine
                ? statusLine
                : translationError
                  ? translationError
                  : "未点「自动翻译」时，保存会先自动翻译"}
          </div>
          {snippet ? (
            <Button
              variant="ghost"
              icon={<History size={15} />}
              onClick={() => setHistoryOpen(true)}
            >
              修改历史
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            icon={<Check size={16} />}
            disabled={saving || translating}
            onClick={() => void save()}
          >
            {saving
              ? translating
                ? "翻译并保存中…"
                : "保存中…"
              : translating
                ? "翻译中…"
                : "保存词条"}
          </Button>
        </>
      }
    >
      <div className="snippet-editor">
        <Field
          label="英文原文"
          hint="可以是一句话、短语或单词；保存时会自动翻译中文"
        >
          <textarea
            autoFocus
            rows={4}
            value={draft.text}
            placeholder="She made a V-sign at the camera"
            onChange={(event) => {
              setTranslationError("");
              manualTranslatedSource.current = "";
              setDraft((current) => ({ ...current, text: event.target.value }));
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text/plain");
              if (!text.trim()) return;
              event.preventDefault();
              manualTranslatedSource.current = "";
              setDraft((current) => ({
                ...current,
                text: text.replace(/^\uFEFF/, ""),
                translation: "",
              }));
              setStatusLine("已粘贴英文，保存时将自动翻译");
            }}
          />
        </Field>
        {duplicate ? (
          <button
            type="button"
            className="duplicate-warning"
            onClick={() => onToast(`重复词条：${duplicate.translation || duplicate.text}`)}
          >
            <Sparkles size={16} />
            已有相同词条，建议合并笔记和分类
            <ChevronRight size={16} />
          </button>
        ) : null}
        <div className="translation-editor-head">
          <span><Languages size={16} />中文译文</span>
          <div>
            <span className={draft.translationLocked ? "lock-state locked" : "lock-state"}>
              {draft.translationLocked ? <Lock size={13} /> : <LockOpen size={13} />}
              {draft.translationLocked ? "已锁定" : "可自动更新"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={translating || !draft.text.trim() || draft.translationLocked}
              onClick={() => void translate()}
            >
              {translating ? "翻译中…" : "自动翻译"}
            </Button>
          </div>
        </div>
        <textarea
          className="translation-input"
          rows={3}
          value={draft.translation}
          placeholder="她对着镜头比出 V 字手势"
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              translation: event.target.value,
            }))
          }
        />
        {translationError ? (
          <span className="save-hint-error" role="alert">
            {translationError}
          </span>
        ) : null}
        <div className="setting-row compact-setting">
          <div>
            <strong>锁定手工译文</strong>
            <p>批量翻译时不会覆盖你确认过的中文。</p>
          </div>
          <Toggle
            label="锁定手工译文"
            checked={draft.translationLocked}
            onChange={(checked) =>
              setDraft((current) => ({
                ...current,
                translationLocked: checked,
              }))
            }
          />
        </div>
        <Field label="分类" hint="一个词条可以属于多个分类">
          <div className="category-check-grid">
            {categories.map((category) => {
              const selected = draft.categoryIds.includes(category.id);
              return (
                <button
                  type="button"
                  key={category.id}
                  className={selected ? "is-selected" : ""}
                  style={{ "--category-color": category.color } as React.CSSProperties}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      categoryIds: selected
                        ? current.categoryIds.filter((id) => id !== category.id)
                        : [...current.categoryIds, category.id],
                    }))
                  }
                >
                  <i />
                  {category.name}
                  {selected ? <Check size={13} /> : null}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="笔记">
          <textarea
            rows={3}
            value={draft.notes}
            placeholder="适用场景、组合建议或容易踩坑的地方…"
            onChange={(event) =>
              setDraft((current) => ({ ...current, notes: event.target.value }))
            }
          />
        </Field>
      </div>
    </Modal>
    {historyOpen && snippet ? (
      <RevisionHistory
        entityType="snippet"
        entityId={snippet.id}
        onClose={() => setHistoryOpen(false)}
        onApply={applyRevision}
        onToast={onToast}
      />
    ) : null}
    </>
  );
}

function CategoryManager({
  categories,
  onClose,
  onSave,
  onDelete,
}: {
  categories: Category[];
  onClose: () => void;
  onSave: (category: Category) => Promise<void>;
  onDelete: (category: Category) => Promise<void>;
}) {
  const [items, setItems] = useState(() =>
    [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);

  async function createCategory() {
    if (!newName.trim()) return;
    const category: Category = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color: categoryColors[items.length % categoryColors.length],
      parentId: newParent || undefined,
      sortOrder: items.length,
    };
    await onSave(category);
    setItems((current) => [...current, category]);
    setNewName("");
  }

  async function renameCategory(category: Category, name: string) {
    if (!name.trim()) return;
    const updated = { ...category, name: name.trim() };
    await onSave(updated);
    setItems((current) =>
      current.map((item) => (item.id === category.id ? updated : item)),
    );
    setEditingId(null);
  }

  async function dropCategory(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...items];
    const from = next.findIndex((item) => item.id === dragId);
    const to = next.findIndex((item) => item.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const ordered = next.map((item, sortOrder) => ({ ...item, sortOrder }));
    setItems(ordered);
    setDragId(null);
    await Promise.all(ordered.map(onSave));
  }

  return (
    <Modal
      title="管理分类"
      eyebrow="单 Prompt"
      size="sm"
      onClose={onClose}
      footer={<Button onClick={onClose}>完成</Button>}
    >
      <div className="category-manager">
        <div className="category-create">
          <input
            value={newName}
            placeholder="新分类名称"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createCategory();
            }}
          />
          <Select value={newParent} onChange={(event) => setNewParent(event.target.value)}>
            <option value="">顶级分类</option>
            {items.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} 的子分类
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            icon={<Plus size={15} />}
            disabled={!newName.trim()}
            onClick={() => void createCategory()}
          >
            添加
          </Button>
        </div>
        <p className="drag-note">拖动可调整分类顺序</p>
        <div className="category-manager-list">
          {items.map((category) => (
            <article
              key={category.id}
              draggable
              onDragStart={() => setDragId(category.id)}
              onDragOver={(event: DragEvent) => event.preventDefault()}
              onDrop={() => void dropCategory(category.id)}
              className={dragId === category.id ? "is-dragging" : ""}
            >
              <GripVertical size={16} />
              <i style={{ background: category.color }} />
              {editingId === category.id ? (
                <input
                  autoFocus
                  defaultValue={category.name}
                  onBlur={(event) =>
                    void renameCategory(category, event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter")
                      void renameCategory(category, event.currentTarget.value);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <div>
                  <strong>{category.name}</strong>
                  {category.parentId ? (
                    <small>
                      {items.find((item) => item.id === category.parentId)?.name}
                      {" "}的子分类
                    </small>
                  ) : null}
                </div>
              )}
              <IconButton
                label="重命名"
                onClick={() => setEditingId(category.id)}
              >
                <Pencil size={15} />
              </IconButton>
              <IconButton
                label="删除分类"
                onClick={async () => {
                  await onDelete(category);
                  setItems((current) =>
                    current.filter((item) => item.id !== category.id),
                  );
                }}
              >
                <Trash2 size={15} />
              </IconButton>
            </article>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function SnippetPage({
  snippets,
  categories,
  targetLanguage,
  requestedSnippetId,
  onClearRequestedSnippet,
  onSave,
  onDelete,
  onSaveCategory,
  onDeleteCategory,
  onUseInStudio,
  onToast,
}: {
  snippets: Snippet[];
  categories: Category[];
  targetLanguage: string;
  requestedSnippetId?: string;
  onClearRequestedSnippet: () => void;
  onSave: (snippet: SnippetInput) => Promise<void>;
  onDelete: (snippet: Snippet) => Promise<void>;
  onSaveCategory: (category: Category) => Promise<void>;
  onDeleteCategory: (category: Category) => Promise<void>;
  onUseInStudio: (snippet: Snippet) => void;
  onToast: (message: string) => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [filter, setFilter] = useState<SnippetFilter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Snippet | "new" | null>(null);
  const [managingCategories, setManagingCategories] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [drawCard, setDrawCard] = useState<Snippet | null>(null);

  useEffect(() => {
    if (!requestedSnippetId) return;
    const snippet = snippets.find((item) => item.id === requestedSnippetId);
    if (snippet) setEditing(snippet);
    onClearRequestedSnippet();
  }, [onClearRequestedSnippet, requestedSnippetId, snippets]);

  useEffect(() => {
    function openNew() {
      setEditing("new");
    }
    window.addEventListener("promptnook:new", openNew);
    return () => window.removeEventListener("promptnook:new", openNew);
  }, []);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = snippets.filter((snippet) => {
      if (
        selectedCategory !== "all" &&
        !snippet.categoryIds.includes(selectedCategory)
      )
        return false;
      if (filter === "favorite" && !snippet.favorite) return false;
      if (
        needle &&
        ![snippet.text, snippet.translation, snippet.notes]
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
        return false;
      return true;
    });
    if (filter === "least") {
      return filtered.sort((a, b) => a.usageCount - b.usageCount);
    }
    if (filter === "recent") {
      return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return filtered.sort((a, b) => b.usageCount - a.usageCount);
  }, [filter, query, selectedCategory, snippets]);

  function drawRandomSnippet() {
    if (!visible.length) {
      onToast("当前筛选下没有可抽的词条");
      return;
    }
    const pick = visible[Math.floor(Math.random() * visible.length)];
    setDrawCard(pick);
  }

  return (
    <div className="page snippets-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">可复用的语言积木</span>
          <h1>单 Prompt</h1>
          <p>收藏一句话、一个词组或一个单词，让灵感随时可取。</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={<Dices size={16} />}
            onClick={drawRandomSnippet}
          >
            抽卡
          </Button>
          <Button
            variant="secondary"
            icon={<FolderTree size={16} />}
            onClick={() => setManagingCategories(true)}
          >
            管理分类
          </Button>
          <Button icon={<Plus size={17} />} onClick={() => setEditing("new")}>
            新建单 Prompt
          </Button>
        </div>
      </header>

      <div className="snippet-layout">
        <aside className="category-sidebar">
          <div className="category-sidebar-title">
            <span>分类</span>
            <IconButton
              label="管理分类"
              onClick={() => setManagingCategories(true)}
            >
              <Pencil size={14} />
            </IconButton>
          </div>
          <button
            type="button"
            className={selectedCategory === "all" ? "is-active" : ""}
            onClick={() => setSelectedCategory("all")}
          >
            <span className="category-all-icon"><Sparkles size={14} /></span>
            全部词条
            <i>{snippets.length}</i>
          </button>
          {sortedCategories.map((category) => {
            // Prefer backend count (full DB). Fall back to in-memory filter
            // when snippetCount is missing (demo mode / older payloads).
            const count =
              typeof category.snippetCount === "number"
                ? category.snippetCount
                : snippets.filter((snippet) =>
                    snippet.categoryIds.includes(category.id),
                  ).length;
            return (
            <button
              type="button"
              key={category.id}
              className={selectedCategory === category.id ? "is-active" : ""}
              onClick={() => setSelectedCategory(category.id)}
            >
              <span
                className="category-dot"
                style={{ background: category.color }}
              />
              {category.name}
              <i>{count}</i>
            </button>
            );
          })}
        </aside>

        <section className="snippet-main">
          <div className="toolbar snippet-toolbar">
            <label className="inline-search snippet-search">
              <Search size={16} />
              <input
                value={query}
                placeholder="搜索英文、中文或笔记"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              ) : null}
            </label>
            <span className="toolbar-spacer" />
            <div className="segmented-filter compact-segmented">
              {(
                [
                  ["all", "常用"],
                  ["favorite", "收藏"],
                  ["recent", "最近"],
                  ["least", "少用"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={filter === key ? "is-active" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {visible.length ? (
            <div className="snippet-list">
              {visible.map((snippet) => (
                <article className="snippet-row" key={snippet.id}>
                  <button
                    type="button"
                    className={clsx(
                      "snippet-favorite",
                      snippet.favorite && "is-favorite",
                    )}
                    onClick={() =>
                      void onSave({
                        ...snippet,
                        favorite: !snippet.favorite,
                      })
                    }
                    aria-label={snippet.favorite ? "取消收藏" : "收藏"}
                  >
                    <Star
                      size={17}
                      fill={snippet.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    type="button"
                    className="snippet-copy"
                    onClick={() => setEditing(snippet)}
                  >
                    <strong>{snippet.text}</strong>
                    <span className="snippet-translation-line">
                      {snippet.translation || (
                        <em><Languages size={14} />待翻译</em>
                      )}
                      {snippet.translationLocked ? (
                        <Lock size={13} aria-label="译文已锁定" />
                      ) : null}
                    </span>
                  </button>
                  <div className="snippet-categories">
                    {snippet.categoryIds.slice(0, 3).map((categoryId) => {
                      const category = categories.find(
                        (item) => item.id === categoryId,
                      );
                      if (!category) return null;
                      return (
                        <span key={categoryId}>
                          <i style={{ background: category.color }} />
                          {category.name}
                        </span>
                      );
                    })}
                    {snippet.categoryIds.length > 3 ? (
                      <small>+{snippet.categoryIds.length - 3}</small>
                    ) : null}
                  </div>
                  <span className="usage-count">使用 {snippet.usageCount} 次</span>
                  <IconButton
                    label="复制英文原文"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(snippet.text)
                        .then(() => onToast("已复制英文原文"))
                    }
                  >
                    <Copy size={17} />
                  </IconButton>
                  <IconButton
                    label="复制中文译文"
                    disabled={!snippet.translation.trim()}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(snippet.translation)
                        .then(() => onToast("已复制中文译文"))
                    }
                  >
                    <Languages size={17} />
                  </IconButton>
                  <IconButton
                    label="加入创作台"
                    onClick={() => onUseInStudio(snippet)}
                  >
                    <BookmarkPlus size={17} />
                  </IconButton>
                  <div className="more-menu">
                    <IconButton
                      label="更多操作"
                      onClick={() =>
                        setMenuId((current) =>
                          current === snippet.id ? null : snippet.id,
                        )
                      }
                    >
                      <MoreHorizontal size={18} />
                    </IconButton>
                    {menuId === snippet.id ? (
                      <div className="context-menu context-menu-right">
                        <button
                          type="button"
                          onClick={() =>
                            void navigator.clipboard
                              .writeText(snippet.text)
                              .then(() => onToast("已复制英文原文"))
                          }
                        >
                          <Copy size={15} />复制原文
                        </button>
                        <button type="button" onClick={() => setEditing(snippet)}>
                          <Pencil size={15} />编辑
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void onDelete(snippet)}
                        >
                          <Trash2 size={15} />移入回收站
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Search size={23} />}
              title="这里还没有词条"
              description="换个分类或筛选条件，也可以创建你的第一条灵感。"
              action={
                <Button
                  icon={<Plus size={16} />}
                  onClick={() => setEditing("new")}
                >
                  新建单 Prompt
                </Button>
              }
            />
          )}
        </section>
      </div>

      {editing ? (
        <SnippetEditor
          snippet={editing === "new" ? undefined : editing}
          snippets={snippets}
          categories={categories}
          targetLanguage={targetLanguage}
          defaultCategoryIds={
            editing === "new" && selectedCategory !== "all"
              ? [selectedCategory]
              : []
          }
          onClose={() => setEditing(null)}
          onSave={onSave}
          onToast={onToast}
        />
      ) : null}

      {managingCategories ? (
        <CategoryManager
          categories={categories}
          onClose={() => setManagingCategories(false)}
          onSave={onSaveCategory}
          onDelete={onDeleteCategory}
        />
      ) : null}

      {drawCard ? (
        <Modal
          title="抽卡结果"
          eyebrow={
            selectedCategory === "all"
              ? `从 ${visible.length} 条中抽取`
              : `从当前分类 ${visible.length} 条中抽取`
          }
          onClose={() => setDrawCard(null)}
          footer={
            <>
              <Button
                variant="ghost"
                icon={<Dices size={15} />}
                onClick={drawRandomSnippet}
              >
                再抽一次
              </Button>
              <Button
                variant="secondary"
                icon={<Copy size={15} />}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(drawCard.text)
                    .then(() => onToast("已复制英文原文"))
                }
              >
                复制英文
              </Button>
              <Button
                variant="secondary"
                icon={<Languages size={15} />}
                disabled={!drawCard.translation.trim()}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(drawCard.translation)
                    .then(() => onToast("已复制中文译文"))
                }
              >
                复制中文
              </Button>
              <Button
                icon={<BookmarkPlus size={15} />}
                onClick={() => {
                  onUseInStudio(drawCard);
                  setDrawCard(null);
                }}
              >
                加入创作台
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(drawCard);
                  setDrawCard(null);
                }}
              >
                打开编辑
              </Button>
            </>
          }
        >
          <div className="draw-card-body">
            <p className="draw-card-en">{drawCard.text}</p>
            <p className="draw-card-zh">
              {drawCard.translation || "（暂无中文译文）"}
            </p>
            {drawCard.categoryIds.length ? (
              <div className="snippet-categories draw-card-cats">
                {drawCard.categoryIds.map((categoryId) => {
                  const category = categories.find((c) => c.id === categoryId);
                  if (!category) return null;
                  return (
                    <span key={categoryId}>
                      <i style={{ background: category.color }} />
                      {category.name}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

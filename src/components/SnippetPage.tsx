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
    setStatusLine("Translating snippet…");
    try {
      const result = await api.translateText({
        text: draft.text,
        targetLanguage,
      });
      const translated = (result.text ?? "").trim();
      if (!translated) throw new Error("The translation service returned an empty result");
      setDraft((current) => ({
        ...current,
        translation: translated,
        translationLocked: true,
      }));
      if (markManual) {
        manualTranslatedSource.current = draft.text.trim();
      }
      setStatusLine("Translation complete");
    } catch (error) {
      const message = `Translation failed: ${readableError(error)}`;
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
      const message = "Source prompt cannot be empty";
      setSaveError(message);
      onToast(message);
      return;
    }
    if (duplicate) {
      const message = "An identical snippet already exists; edit the existing item";
      setSaveError(message);
      onToast(message);
      return;
    }

    const source = draft.text.trim();
    const willAuto =
      manualTranslatedSource.current !== source &&
      needsTranslation(source, draft.translation);

    setSaving(true);
    // Translate only once in save_snippet; the frontend does not make a separate request.
    if (willAuto) {
      setTranslating(true);
      setStatusLine("Translating and saving (one request)…");
    } else {
      setStatusLine("Saving…");
    }
    try {
      await onSave(draft);
      setStatusLine("Saved");
      onClose();
    } catch (error) {
      const message = `Save failed: ${readableError(error)}`;
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
      onToast("This revision cannot be read");
      return;
    }
    const restored = snapshot as Partial<SnippetInput>;
    if (typeof restored.text !== "string") {
      onToast("This revision is missing its source prompt");
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
    onToast("Revision loaded. Review it and click Save to apply it");
  }

  return (
    <>
    <Modal
      title={snippet ? "Edit snippet" : "New snippet"}
      eyebrow="Idea snippet"
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
                  : "Saving will translate first unless Auto translate has already run"}
          </div>
          {snippet ? (
            <Button
              variant="ghost"
              icon={<History size={15} />}
              onClick={() => setHistoryOpen(true)}
            >
              Revision history
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            icon={<Check size={16} />}
            disabled={saving || translating}
            onClick={() => void save()}
          >
            {saving
              ? translating
                ? "Translating and saving…"
                : "Saving…"
              : translating
                ? "Translating…"
                : "Save snippet"}
          </Button>
        </>
      }
    >
      <div className="snippet-editor">
        <Field
          label="Source prompt"
          hint="Use a sentence, phrase, or word; it can be translated automatically when saved"
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
              setStatusLine("Source text pasted; it will be translated when saved");
            }}
          />
        </Field>
        {duplicate ? (
          <button
            type="button"
            className="duplicate-warning"
            onClick={() => onToast(`Duplicate snippet: ${duplicate.translation || duplicate.text}`)}
          >
            <Sparkles size={16} />
            An identical snippet exists; consider merging notes and categories
            <ChevronRight size={16} />
          </button>
        ) : null}
        <div className="translation-editor-head">
          <span><Languages size={16} />Translation</span>
          <div>
            <span className={draft.translationLocked ? "lock-state locked" : "lock-state"}>
              {draft.translationLocked ? <Lock size={13} /> : <LockOpen size={13} />}
              {draft.translationLocked ? "Locked" : "Can update automatically"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={translating || !draft.text.trim() || draft.translationLocked}
              onClick={() => void translate()}
            >
              {translating ? "Translating…" : "Auto translate"}
            </Button>
          </div>
        </div>
        <textarea
          className="translation-input"
          aria-label="Translation"
          rows={3}
          value={draft.translation}
          placeholder="She makes a V sign toward the camera"
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
            <strong>Lock manual translation</strong>
            <p>Batch translation never overwrites a translation you have confirmed.</p>
          </div>
          <Toggle
            label="Lock manual translation"
            checked={draft.translationLocked}
            onChange={(checked) =>
              setDraft((current) => ({
                ...current,
                translationLocked: checked,
              }))
            }
          />
        </div>
        <Field label="Categories" hint="A snippet can belong to multiple categories">
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
        <Field label="Notes">
          <textarea
            rows={3}
            value={draft.notes}
            placeholder="Use cases, combination ideas, or pitfalls…"
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
      title="Manage categories"
      eyebrow="Snippets"
      size="sm"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="category-manager">
        <div className="category-create">
          <input
            value={newName}
            placeholder="New category name"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createCategory();
            }}
          />
          <Select value={newParent} onChange={(event) => setNewParent(event.target.value)}>
            <option value="">Top-level category</option>
            {items.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name} sub-category
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            icon={<Plus size={15} />}
            disabled={!newName.trim()}
            onClick={() => void createCategory()}
          >
            Add
          </Button>
        </div>
        <p className="drag-note">Drag to reorder categories</p>
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
                      {" "}sub-category
                    </small>
                  ) : null}
                </div>
              )}
              <IconButton
                label="Rename"
                onClick={() => setEditingId(category.id)}
              >
                <Pencil size={15} />
              </IconButton>
              <IconButton
                label="Delete category"
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
      onToast("No snippets are available under the current filters");
      return;
    }
    const pick = visible[Math.floor(Math.random() * visible.length)];
    setDrawCard(pick);
  }

  return (
    <div className="page snippets-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Reusable prompt building blocks</span>
          <h1>Snippets</h1>
          <p>Save sentences, phrases, or words as reusable building blocks.</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={<Dices size={16} />}
            onClick={drawRandomSnippet}
          >
            Draw
          </Button>
          <Button
            variant="secondary"
            icon={<FolderTree size={16} />}
            onClick={() => setManagingCategories(true)}
          >
            Manage categories
          </Button>
          <Button icon={<Plus size={17} />} onClick={() => setEditing("new")}>
            New snippet
          </Button>
        </div>
      </header>

      <div className="snippet-layout">
        <aside className="category-sidebar">
          <div className="category-sidebar-title">
            <span>Categories</span>
            <IconButton
              label="Manage categories"
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
            All snippets
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
                placeholder="Search source text, translations, or notes"
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
                  ["all", "Frequently used"],
                  ["favorite", "Favorite"],
                  ["recent", "Recent"],
                  ["least", "Least used"],
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
                    aria-label={snippet.favorite ? "Remove favorite" : "Favorite"}
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
                        <em><Languages size={14} />Pending translation</em>
                      )}
                      {snippet.translationLocked ? (
                        <Lock size={13} aria-label="Translation locked" />
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
                  <span className="usage-count">Used {snippet.usageCount} times</span>
                  <IconButton
                    label="Copy source prompt"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(snippet.text)
                        .then(() => onToast("Source prompt copied"))
                    }
                  >
                    <Copy size={17} />
                  </IconButton>
                  <IconButton
                    label="Copy translation"
                    disabled={!snippet.translation.trim()}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(snippet.translation)
                        .then(() => onToast("Translation copied"))
                    }
                  >
                    <Languages size={17} />
                  </IconButton>
                  <IconButton
                    label="Add to Studio"
                    onClick={() => onUseInStudio(snippet)}
                  >
                    <BookmarkPlus size={17} />
                  </IconButton>
                  <div className="more-menu">
                    <IconButton
                      label="More actions"
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
                              .then(() => onToast("Source prompt copied"))
                          }
                        >
                          <Copy size={15} />Copy source
                        </button>
                        <button type="button" onClick={() => setEditing(snippet)}>
                          <Pencil size={15} />Edit
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void onDelete(snippet)}
                        >
                          <Trash2 size={15} />Move to Trash
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
              title="No snippets here yet"
              description="Try another category or filter, or create your first snippet."
              action={
                <Button
                  icon={<Plus size={16} />}
                  onClick={() => setEditing("new")}
                >
                  New snippet
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
          title="Draw result"
          eyebrow={
            selectedCategory === "all"
              ? `Draw from ${visible.length} snippets`
              : `Draw from ${visible.length} snippets in the current categories`
          }
          onClose={() => setDrawCard(null)}
          footer={
            <>
              <Button
                variant="ghost"
                icon={<Dices size={15} />}
                onClick={drawRandomSnippet}
              >
                Draw again
              </Button>
              <Button
                variant="secondary"
                icon={<Copy size={15} />}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(drawCard.text)
                    .then(() => onToast("Source prompt copied"))
                }
              >
                Copy source
              </Button>
              <Button
                variant="secondary"
                icon={<Languages size={15} />}
                disabled={!drawCard.translation.trim()}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(drawCard.translation)
                    .then(() => onToast("Translation copied"))
                }
              >
                Copy translation
              </Button>
              <Button
                icon={<BookmarkPlus size={15} />}
                onClick={() => {
                  onUseInStudio(drawCard);
                  setDrawCard(null);
                }}
              >
                Add to Studio
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(drawCard);
                  setDrawCard(null);
                }}
              >
                Open editor
              </Button>
            </>
          }
        >
          <div className="draw-card-body">
            <p className="draw-card-en">{drawCard.text}</p>
            <p className="draw-card-zh">
              {drawCard.translation || "(no translation yet)"}
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

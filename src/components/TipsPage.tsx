import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Filter,
  Globe2,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type {
  Category,
  Resource,
  Tip,
  TipInput,
  TipScope,
} from "../types";
import { readableError } from "../lib/errors";
import { Button, EmptyState, Field, IconButton, Modal, Select } from "./ui";

type TipFilter = "all" | TipScope | "favorite";

const scopeCopy: Record<
  TipScope,
  { label: string; icon: typeof Globe2; className: string }
> = {
  global: { label: "General tip", icon: Globe2, className: "scope-global" },
  model: { label: "Model tip", icon: Tag, className: "scope-model" },
  lora: { label: "LoRA tip", icon: Sparkles, className: "scope-lora" },
  category: { label: "Category tip", icon: Filter, className: "scope-category" },
};

function newTip(): TipInput {
  return {
    id: "",
    title: "",
    content: "",
    scope: "global",
    favorite: false,
  };
}

function TipEditor({
  tip,
  resources,
  categories,
  onClose,
  onSave,
  onToast,
}: {
  tip?: Tip;
  resources: Resource[];
  categories: Category[];
  onClose: () => void;
  onSave: (tip: TipInput) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<TipInput>(
    tip ? structuredClone(tip) : newTip(),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const targets = useMemo(() => {
    if (draft.scope === "lora") {
      return resources
        .filter((resource) => resource.resourceType === "lora")
        .map((resource) => ({ id: resource.id, name: resource.name }));
    }
    if (draft.scope === "model") {
      return resources
        .filter((resource) => resource.resourceType !== "lora")
        .map((resource) => ({ id: resource.id, name: resource.name }));
    }
    if (draft.scope === "category") {
      return categories.map((category) => ({
        id: category.id,
        name: category.name,
      }));
    }
    return [];
  }, [categories, draft.scope, resources]);

  function changeScope(scope: TipScope) {
    setDraft((current) => ({
      ...current,
      scope,
      targetId: undefined,
      targetName: undefined,
    }));
  }

  function changeTarget(targetId: string) {
    const target = targets.find((item) => item.id === targetId);
    setDraft((current) => ({
      ...current,
      targetId: target?.id,
      targetName: target?.name,
    }));
  }

  async function save() {
    setSaveError("");
    if (!draft.title.trim() || !draft.content.trim()) {
      const message = "Enter a title and content for the tip";
      setSaveError(message);
      onToast(message);
      return;
    }
    if (draft.scope !== "global" && !draft.targetId) {
      const message = "Choose what this tip applies to";
      setSaveError(message);
      onToast(message);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      const message = `Save failed: ${readableError(error)}`;
      setSaveError(message);
      onToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={tip ? "Edit tip" : "New tip"}
      eyebrow="Save what you learned for your future self"
      onClose={onClose}
      footer={
        <>
          {saveError ? (
            <span className="save-hint-error" role="alert">
              {saveError}
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            icon={<Check size={16} />}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save tip"}
          </Button>
        </>
      }
    >
      <div className="tip-editor">
        <Field label="Title">
          <input
            autoFocus
            value={draft.title}
            placeholder="For example: lower the LoRA weight when skin tones look too warm"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Guidance">
          <textarea
            rows={6}
            value={draft.content}
            placeholder="Record concrete steps, recommended values, and reasoning…"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                content: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Applies to">
          <div className="scope-picker">
            {(Object.keys(scopeCopy) as TipScope[]).map((scope) => {
              const item = scopeCopy[scope];
              const ScopeIcon = item.icon;
              return (
                <button
                  type="button"
                  key={scope}
                  className={draft.scope === scope ? "is-active" : ""}
                  onClick={() => changeScope(scope)}
                >
                  <ScopeIcon size={16} />
                  {item.label}
                  {draft.scope === scope ? <Check size={14} /> : null}
                </button>
              );
            })}
          </div>
        </Field>
        {draft.scope !== "global" ? (
          <Field
            label={
              draft.scope === "model"
                ? "Select model"
                : draft.scope === "lora"
                  ? "Select LoRA"
                  : "Select category"
            }
          >
            <Select
              value={draft.targetId || ""}
              onChange={(event) => changeTarget(event.target.value)}
            >
              <option value="">Select…</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="tip-context-preview">
            <Globe2 size={17} />
            <div>
              <strong>Always show in Studio</strong>
              <span>For general guidance that does not depend on a model or category.</span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function TipsPage({
  tips,
  resources,
  categories,
  requestedTipId,
  onClearRequestedTip,
  onSave,
  onDelete,
  onToast,
}: {
  tips: Tip[];
  resources: Resource[];
  categories: Category[];
  requestedTipId?: string;
  onClearRequestedTip: () => void;
  onSave: (tip: TipInput) => Promise<void>;
  onDelete: (tip: Tip) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [filter, setFilter] = useState<TipFilter>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Tip | "new" | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedTipId) return;
    const tip = tips.find((item) => item.id === requestedTipId);
    if (tip) setEditing(tip);
    onClearRequestedTip();
  }, [onClearRequestedTip, requestedTipId, tips]);

  useEffect(() => {
    function openNew() {
      setEditing("new");
    }
    window.addEventListener("promptnook:new", openNew);
    return () => window.removeEventListener("promptnook:new", openNew);
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tips
      .filter((tip) => {
        if (filter === "favorite" && !tip.favorite) return false;
        if (
          filter !== "all" &&
          filter !== "favorite" &&
          tip.scope !== filter
        )
          return false;
        if (
          needle &&
          ![tip.title, tip.content, tip.targetName]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
          return false;
        return true;
      })
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [filter, query, tips]);

  return (
    <div className="page tips-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Your personal playbook</span>
          <h1>Tips</h1>
          <p>Attach hard-won knowledge to its model so it appears in your next session.</p>
        </div>
        <div className="page-actions">
          <Button
            icon={<Plus size={17} />}
            onClick={() => setEditing("new")}
          >
            New tip
          </Button>
        </div>
      </header>

      <section className="toolbar">
        <div className="segmented-filter">
          {(
            [
              ["all", "All"],
              ["favorite", "Favorite"],
              ["global", "General"],
              ["model", "Model"],
              ["lora", "LoRA"],
              ["category", "Categories"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "is-active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === "all" ? <i>{tips.length}</i> : null}
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <label className="inline-search">
          <Search size={16} />
          <input
            value={query}
            placeholder="Search tips"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          ) : null}
        </label>
      </section>

      {visible.length ? (
        <div className="tips-grid">
          {visible.map((tip) => {
            const scope = scopeCopy[tip.scope];
            const ScopeIcon = scope.icon;
            return (
              <article className="tip-card" key={tip.id}>
                <header>
                  <span className={`tip-scope-icon ${scope.className}`}>
                    <ScopeIcon size={17} />
                  </span>
                  <span className="tip-scope-label">
                    {tip.targetName || scope.label}
                  </span>
                  <button
                    type="button"
                    className={tip.favorite ? "tip-star is-favorite" : "tip-star"}
                    aria-label={tip.favorite ? "Remove favorite" : "Favorite"}
                    onClick={() =>
                      void onSave({ ...tip, favorite: !tip.favorite })
                    }
                  >
                    <Star
                      size={16}
                      fill={tip.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <div className="more-menu">
                    <IconButton
                      label="More actions"
                      onClick={() =>
                        setMenuId((current) =>
                          current === tip.id ? null : tip.id,
                        )
                      }
                    >
                      <MoreHorizontal size={18} />
                    </IconButton>
                    {menuId === tip.id ? (
                      <div className="context-menu context-menu-right">
                        <button type="button" onClick={() => setEditing(tip)}>
                          <Pencil size={15} />Edit
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void onDelete(tip)}
                        >
                          <Trash2 size={15} />Move to Trash
                        </button>
                      </div>
                    ) : null}
                  </div>
                </header>
                <button
                  type="button"
                  className="tip-card-copy"
                  onClick={() => setEditing(tip)}
                >
                  <h3>{tip.title}</h3>
                  <p>{tip.content}</p>
                </button>
              </article>
            );
          })}
          <button
            type="button"
            className="new-tip-card"
            onClick={() => setEditing("new")}
          >
            <span><Lightbulb size={22} /></span>
            <strong>Record what you just learned</strong>
            <small>A few seconds now can prevent repeated trial and error later</small>
          </button>
        </div>
      ) : (
        <EmptyState
          icon={<Lightbulb size={24} />}
          title="No matching tips"
          description="Adjust the filters or record a new tip."
          action={
            <Button
              icon={<Plus size={16} />}
              onClick={() => setEditing("new")}
            >
              New tip
            </Button>
          }
        />
      )}

      {editing ? (
        <TipEditor
          tip={editing === "new" ? undefined : editing}
          resources={resources}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={onSave}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}

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
  global: { label: "通用技巧", icon: Globe2, className: "scope-global" },
  model: { label: "模型技巧", icon: Tag, className: "scope-model" },
  lora: { label: "LoRA 技巧", icon: Sparkles, className: "scope-lora" },
  category: { label: "分类技巧", icon: Filter, className: "scope-category" },
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
      const message = "请填写技巧标题和内容";
      setSaveError(message);
      onToast(message);
      return;
    }
    if (draft.scope !== "global" && !draft.targetId) {
      const message = "请选择这条技巧对应的对象";
      setSaveError(message);
      onToast(message);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      const message = `保存失败：${readableError(error)}`;
      setSaveError(message);
      onToast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={tip ? "编辑技巧" : "记录新技巧"}
      eyebrow="把经验留给未来的自己"
      onClose={onClose}
      footer={
        <>
          {saveError ? (
            <span className="save-hint-error" role="alert">
              {saveError}
            </span>
          ) : null}
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            icon={<Check size={16} />}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存技巧"}
          </Button>
        </>
      }
    >
      <div className="tip-editor">
        <Field label="标题">
          <input
            autoFocus
            value={draft.title}
            placeholder="例如：人物肤色偏暖时先降低 LoRA 权重"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="经验或技巧">
          <textarea
            rows={6}
            value={draft.content}
            placeholder="记录具体做法、推荐数值和判断依据…"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                content: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="适用范围">
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
                ? "选择模型"
                : draft.scope === "lora"
                  ? "选择 LoRA"
                  : "选择分类"
            }
          >
            <Select
              value={draft.targetId || ""}
              onChange={(event) => changeTarget(event.target.value)}
            >
              <option value="">请选择</option>
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
              <strong>创作台始终显示</strong>
              <span>适合不依赖模型或分类的通用经验。</span>
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
          <span className="eyebrow">你的私人方法论</span>
          <h1>技巧</h1>
          <p>把试出来的经验记在对应模型旁边，下次创作时自动出现。</p>
        </div>
        <div className="page-actions">
          <Button
            icon={<Plus size={17} />}
            onClick={() => setEditing("new")}
          >
            记录新技巧
          </Button>
        </div>
      </header>

      <section className="toolbar">
        <div className="segmented-filter">
          {(
            [
              ["all", "全部"],
              ["favorite", "收藏"],
              ["global", "通用"],
              ["model", "模型"],
              ["lora", "LoRA"],
              ["category", "分类"],
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
            placeholder="搜索技巧内容"
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
                    aria-label={tip.favorite ? "取消收藏" : "收藏"}
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
                      label="更多操作"
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
                          <Pencil size={15} />编辑
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => void onDelete(tip)}
                        >
                          <Trash2 size={15} />移入回收站
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
            <strong>记下刚刚学到的技巧</strong>
            <small>几秒钟，省下未来反复试错的时间</small>
          </button>
        </div>
      ) : (
        <EmptyState
          icon={<Lightbulb size={24} />}
          title="没有找到相关技巧"
          description="调整筛选条件，或记录一条新的经验。"
          action={
            <Button
              icon={<Plus size={16} />}
              onClick={() => setEditing("new")}
            >
              记录新技巧
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

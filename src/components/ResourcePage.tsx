import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Box,
  Check,
  CircleOff,
  Download,
  FileBox,
  Folder,
  ImagePlus,
  Info,
  Layers3,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import clsx from "clsx";
import type {
  AppSettings,
  DownloadLoraCandidate,
  ListDownloadLorasResult,
  Resource,
  ResourceScanResult,
  ResourceType,
} from "../types";
import { api } from "../lib/api";
import { readableError } from "../lib/errors";
import { Badge, Button, EmptyState, Field, IconButton, Modal, Select } from "./ui";

type ResourceFilter = "all" | ResourceType | "offline";

function normalizeSearchValue(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function matchesResourceQuery(resource: Resource, query: string) {
  const needle = normalizeSearchValue(query.trim());
  if (!needle) return true;

  return normalizeSearchValue(
    [
      resource.name,
      resource.path,
      resource.baseModel ?? "",
      ...resource.triggerWords,
      ...resource.confirmedTriggerWords,
    ].join("\n"),
  ).includes(needle);
}

function formatBytes(value?: number) {
  if (!value) return "大小未知";
  const gb = value / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function formatRelativeTime(iso?: string) {
  if (!iso) return "时间未知";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "时间未知";
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return "刚刚";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} 天前`;
  return new Date(iso).toLocaleString();
}

function resourceTypeLabel(type: ResourceType) {
  if (type === "lora") return "LoRA";
  if (type === "checkpoint") return "Checkpoint";
  return "Diffusion Model";
}

function ResourceVisual({
  resource,
  privacyMode,
}: {
  resource: Resource;
  privacyMode: boolean;
}) {
  const visualIndex =
    Array.from(resource.name).reduce(
      (sum, char) => sum + char.charCodeAt(0),
      0,
    ) % 6;
  return (
    <div
      className={clsx(
        "resource-visual",
        `visual-${visualIndex}`,
        privacyMode && "is-private",
      )}
    >
      {resource.previewUrl && !privacyMode ? (
        <img
          src={resource.previewUrl}
          alt={`${resource.name} 预览`}
          loading="lazy"
        />
      ) : (
        <div className="resource-placeholder">
          {resource.resourceType === "lora" ? (
            <Sparkles size={24} />
          ) : (
            <Layers3 size={24} />
          )}
          <span>
            {privacyMode && resource.previewUrl
              ? "已隐藏"
              : resource.resourceType === "lora"
                ? "LoRA"
                : "MODEL"}
          </span>
        </div>
      )}
      {!resource.available ? (
        <span className="offline-overlay"><CircleOff size={16} />目录离线</span>
      ) : null}
    </div>
  );
}

function ResourceEditor({
  resource,
  privacyMode,
  onClose,
  onSave,
  onToast,
}: {
  resource: Resource;
  privacyMode: boolean;
  onClose: () => void;
  onSave: (resource: Resource) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => {
    const copy = structuredClone(resource);
    const seen = new Set<string>();
    copy.triggerWords = [
      ...copy.confirmedTriggerWords,
      ...copy.triggerWords,
    ].filter((word) => {
      const key = word.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return copy;
  });
  const [word, setWord] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function addWord() {
    const next = word.trim();
    if (!next) return;
    if (
      draft.triggerWords.some(
        (candidate) =>
          candidate.toLocaleLowerCase() === next.toLocaleLowerCase(),
      )
    ) {
      onToast("这个触发词已经存在");
      return;
    }
    setDraft((current) => ({
      ...current,
      triggerWords: [...current.triggerWords, next],
      confirmedTriggerWords: [...current.confirmedTriggerWords, next],
    }));
    setWord("");
  }

  function toggleConfirmed(trigger: string) {
    setDraft((current) => ({
      ...current,
      confirmedTriggerWords: current.confirmedTriggerWords.includes(trigger)
        ? current.confirmedTriggerWords.filter((word) => word !== trigger)
        : [...current.confirmedTriggerWords, trigger],
    }));
  }

  async function addPreview(file?: File) {
    if (!file || !file.type.startsWith("image/")) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const asset = await api.importAsset({
      name: file.name,
      mimeType: file.type,
      dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      entityType: "resource",
      entityId: draft.id,
      role: "preview",
    });
    setDraft((current) => ({ ...current, previewUrl: asset.url }));
  }

  async function save() {
    setSaveError("");
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
      title={draft.name}
      eyebrow={resourceTypeLabel(draft.resourceType)}
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
            {saving ? "保存中…" : "保存信息"}
          </Button>
        </>
      }
    >
      <div className="resource-editor">
        <div className="resource-editor-hero">
          <ResourceVisual resource={draft} privacyMode={privacyMode} />
          <div>
            <strong>示例图</strong>
            <p>用于快速识别模型，不会写入或修改原模型目录。</p>
            <Button
              size="sm"
              variant="secondary"
              icon={<ImagePlus size={15} />}
              onClick={() => fileRef.current?.click()}
            >
              {draft.previewUrl ? "更换示例图" : "添加示例图"}
            </Button>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => void addPreview(event.target.files?.[0])}
            />
          </div>
        </div>
        <div className="resource-facts">
          <div><span>底模</span><strong>{draft.baseModel || "尚未识别"}</strong></div>
          <div><span>文件大小</span><strong>{formatBytes(draft.fileSize)}</strong></div>
          <div>
            <span>状态</span>
            <strong className={draft.available ? "online" : "offline"}>
              {draft.available ? "目录在线" : "保留的离线记录"}
            </strong>
          </div>
        </div>
        <Field label="文件路径">
          <div className="read-only-path">{draft.path}</div>
        </Field>
        {draft.resourceType === "lora" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>触发词</h3>
                <p>点击候选词确认；创作台默认只启用已确认的触发词。</p>
              </div>
              <Badge tone="accent">
                {draft.confirmedTriggerWords.length} 已确认
              </Badge>
            </div>
            <div className="trigger-editor">
              {draft.triggerWords.map((trigger) => {
                const confirmed = draft.confirmedTriggerWords.includes(trigger);
                return (
                  <button
                    key={trigger}
                    type="button"
                    className={confirmed ? "is-confirmed" : ""}
                    onClick={() => toggleConfirmed(trigger)}
                  >
                    {confirmed ? <Check size={13} /> : <Plus size={13} />}
                    {trigger}
                  </button>
                );
              })}
            </div>
            <div className="add-trigger-row">
              <input
                value={word}
                placeholder="手工输入新的触发词"
                onChange={(event) => setWord(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addWord();
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus size={15} />}
                disabled={!word.trim()}
                onClick={addWord}
              >
                添加
              </Button>
            </div>
          </>
        ) : null}
        <Field label="个人备注">
          <textarea
            rows={3}
            value={draft.notes || ""}
            placeholder="推荐设置、适合画风、兼容性说明…"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
          />
        </Field>
      </div>
    </Modal>
  );
}

function DownloadLoraImportModal({
  settings,
  onClose,
  onImported,
  onToast,
}: {
  settings: AppSettings;
  onClose: () => void;
  onImported: (result: ResourceScanResult) => void;
  onToast: (message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [listing, setListing] = useState<ListDownloadLorasResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await api.listDownloadLoras();
        if (cancelled) return;
        setListing(result);
        // Default: only auto-check new files from the last N hours (6h).
        setSelected(
          new Set(
            result.candidates
              .filter(
                (item) =>
                  !item.alreadyExists && item.withinDefaultWindow,
              )
              .map((item) => item.sourcePath),
          ),
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(`读取下载目录失败：${readableError(loadError)}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCandidates = useMemo(() => {
    if (!listing) return [] as DownloadLoraCandidate[];
    return listing.candidates.filter((item) => selected.has(item.sourcePath));
  }, [listing, selected]);

  function toggle(path: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function selectDefaultWindow() {
    if (!listing) return;
    setSelected(
      new Set(
        listing.candidates
          .filter(
            (item) =>
              item.withinDefaultWindow &&
              (!item.alreadyExists || overwrite),
          )
          .map((item) => item.sourcePath),
      ),
    );
  }

  function selectAllNew() {
    if (!listing) return;
    setSelected(
      new Set(
        listing.candidates
          .filter((item) => !item.alreadyExists || overwrite)
          .map((item) => item.sourcePath),
      ),
    );
  }

  async function confirmImport() {
    if (!selectedCandidates.length) {
      onToast("请先勾选要导入的 LoRA");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const result = await api.importDownloadLoras({
        sourcePaths: selectedCandidates.map((item) => item.sourcePath),
        overwrite,
      });
      onImported(result.scan);

      const importedNames = result.imported.map((item) => item.name);
      const parts: string[] = [];
      if (importedNames.length) {
        parts.push(
          `已移动导入 ${importedNames.length} 个 LoRA：${importedNames.join("、")}`,
        );
      } else {
        parts.push("没有新的 LoRA 被移动导入");
      }
      if (result.skipped.length) {
        parts.push(result.skipped.join("；"));
      }
      if (result.failed.length) {
        parts.push(result.failed.join("；"));
      }
      onToast(parts.join("。"));
      if (!result.failed.length) onClose();
      else setError(result.failed.join("\n"));
    } catch (importError) {
      const message = `导入失败：${readableError(importError)}`;
      setError(message);
      onToast(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      title="从下载目录导入 LoRA"
      eyebrow="一键归档"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="import-lora-footer-summary">
            {selectedCandidates.length ? (
              <>
                <strong>将导入 {selectedCandidates.length} 个：</strong>
                <span title={selectedCandidates.map((item) => item.name).join("、")}>
                  {selectedCandidates.map((item) => item.name).join("、")}
                </span>
              </>
            ) : (
              <span>尚未选择任何 LoRA</span>
            )}
          </div>
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            取消
          </Button>
          <Button
            icon={<Download size={16} />}
            disabled={importing || !selectedCandidates.length}
            onClick={() => void confirmImport()}
          >
            {importing
              ? "正在导入…"
              : `确认导入 ${selectedCandidates.length || ""}`.trim()}
          </Button>
        </>
      }
    >
      <div className="import-lora-modal">
        <div className="import-lora-paths">
          <div>
            <small>来源（近期下载）</small>
            <strong>
              {listing?.downloadsPath || "Downloads"}
            </strong>
          </div>
          <div>
            <small>目标 LoRA 目录</small>
            <strong>{listing?.loraPath || settings.loraPath}</strong>
          </div>
        </div>

        <p className="import-lora-hint">
          仅展示最近 {listing?.recentDays ?? 14} 天、体积不超过 2GB
          的权重文件。默认勾选<strong>
            近 {listing?.defaultSelectHours ?? 6} 小时
          </strong>
          的新文件。导入为<strong>移动</strong>
          （原下载文件会删除）。请核对下方具体名称后再确认。
        </p>

        {loading ? (
          <div className="import-lora-status">正在扫描下载目录…</div>
        ) : error && !listing ? (
          <div className="import-lora-status is-error">{error}</div>
        ) : listing && listing.candidates.length === 0 ? (
          <div className="import-lora-status">
            最近 {listing.recentDays} 天内没有发现可导入的 LoRA 文件。
          </div>
        ) : listing ? (
          <>
            <div className="import-lora-toolbar">
              <Badge tone="accent">
                近期 {listing.candidates.length} 个候选
              </Badge>
              <button type="button" onClick={selectDefaultWindow}>
                全选近 {listing.defaultSelectHours} 小时
              </button>
              <button type="button" onClick={selectAllNew}>
                全选可导入项
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                清空选择
              </button>
              <label className="import-lora-overwrite">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                覆盖目标目录中已存在的同名文件
              </label>
            </div>

            <ul className="import-lora-list" aria-label="近期可导入的 LoRA">
              {listing.candidates.map((item) => {
                const checked = selected.has(item.sourcePath);
                const blocked = item.alreadyExists && !overwrite;
                return (
                  <li
                    key={item.sourcePath}
                    className={clsx(
                      "import-lora-item",
                      checked && "is-selected",
                      blocked && "is-existing",
                    )}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={blocked}
                        onChange={() => toggle(item.sourcePath)}
                      />
                      <div className="import-lora-item-main">
                        <strong className="import-lora-name">{item.name}</strong>
                        <span className="import-lora-filename">
                          {item.fileName}
                        </span>
                        <div className="import-lora-meta">
                          <span>{formatBytes(item.fileSize)}</span>
                          <span>{formatRelativeTime(item.modifiedAt)}</span>
                          {item.withinDefaultWindow ? (
                            <Badge tone="accent">
                              近 {listing.defaultSelectHours} 小时
                            </Badge>
                          ) : null}
                          {item.alreadyExists ? (
                            <Badge tone="warning">目标已存在</Badge>
                          ) : (
                            <Badge tone="success">新文件</Badge>
                          )}
                          {item.companionFiles.length ? (
                            <span>
                              +{item.companionFiles.length} 个附属文件
                            </span>
                          ) : null}
                        </div>
                        <small className="import-lora-dest">
                          → {item.destinationPath}
                        </small>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>

            {selectedCandidates.length ? (
              <div className="import-lora-confirm-box" role="status">
                <AlertTriangle size={16} />
                <div>
                  <strong>即将导入这些 LoRA：</strong>
                  <ol>
                    {selectedCandidates.map((item) => (
                      <li key={item.sourcePath}>
                        <code>{item.name}</code>
                        <span>
                          （{item.fileName} · {formatBytes(item.fileSize)}）
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {error && listing ? (
          <div className="import-lora-status is-error">{error}</div>
        ) : null}
      </div>
    </Modal>
  );
}

export function ResourcePage({
  resources,
  settings,
  privacyMode,
  requestedResourceId,
  onClearRequestedResource,
  onScanComplete,
  onSave,
  onOpenSettings,
  onToast,
}: {
  resources: Resource[];
  settings: AppSettings;
  privacyMode: boolean;
  requestedResourceId?: string;
  onClearRequestedResource: () => void;
  onScanComplete: (result: ResourceScanResult) => void;
  onSave: (resource: Resource) => Promise<void>;
  onOpenSettings: () => void;
  onToast: (message: string) => void;
}) {
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sort, setSort] = useState<"name" | "modified" | "size">("name");
  const hasActiveFilter = Boolean(query.trim()) || filter !== "all";

  useEffect(() => {
    if (!requestedResourceId) return;
    const resource = resources.find((item) => item.id === requestedResourceId);
    if (resource) setEditing(resource);
    onClearRequestedResource();
  }, [onClearRequestedResource, requestedResourceId, resources]);

  const visible = useMemo(() => {
    return resources
      .filter((resource) => {
        if (filter === "offline" && resource.available) return false;
        if (
          filter !== "all" &&
          filter !== "offline" &&
          resource.resourceType !== filter
        )
          return false;
        return matchesResourceQuery(resource, query);
      })
      .sort((a, b) => {
        if (sort === "size") return (b.fileSize ?? 0) - (a.fileSize ?? 0);
        if (sort === "modified")
          return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "");
        return a.name.localeCompare(b.name);
      });
  }, [filter, query, resources, sort]);

  async function scan() {
    setScanning(true);
    try {
      const result = await api.scanResources();
      onScanComplete(result);
      onToast(
        result.offlinePaths.length
          ? `扫描完成：更新 ${result.updated} 项，${result.offlinePaths.length} 个路径离线`
          : `扫描完成：发现 ${result.scanned} 项资源`,
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="page resources-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">只读模型索引</span>
          <h1>模型与 LoRA</h1>
          <p>看得见模型、记得住触发词；原文件始终保持只读。</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={<Download size={16} />}
            onClick={() => setImportOpen(true)}
          >
            导入下载的 LoRA
          </Button>
          <Button
            variant="secondary"
            icon={<Folder size={16} />}
            onClick={onOpenSettings}
          >
            模型目录
          </Button>
          <Button
            icon={<RefreshCw size={16} className={scanning ? "spin" : ""} />}
            disabled={scanning}
            onClick={() => void scan()}
          >
            {scanning ? "正在扫描…" : "扫描更新"}
          </Button>
        </div>
      </header>

      <div className="resource-path-strip">
        <Info size={16} />
        <span>
          LoRA：<strong>{settings.loraPath}</strong>
        </span>
        <span>
          模型：<strong>{settings.checkpointPath}</strong>
        </span>
        <Badge tone="success">只读访问</Badge>
      </div>

      <section className="toolbar">
        <div className="segmented-filter">
          {(
            [
              ["all", "全部", resources.length],
              [
                "lora",
                "LoRA",
                resources.filter((item) => item.resourceType === "lora").length,
              ],
              [
                "checkpoint",
                "Checkpoint",
                resources.filter((item) => item.resourceType === "checkpoint")
                  .length,
              ],
              [
                "diffusion_model",
                "Diffusion Model",
                resources.filter(
                  (item) => item.resourceType === "diffusion_model",
                ).length,
              ],
              [
                "offline",
                "离线",
                resources.filter((item) => !item.available).length,
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
        <label className="inline-search resource-search">
          <Search size={16} />
          <input
            value={query}
            aria-label="搜索模型与 LoRA"
            autoComplete="off"
            placeholder="搜索名称、路径、底模或触发词"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="清除资源搜索"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        <Badge tone={hasActiveFilter ? "accent" : "neutral"}>
          显示 {visible.length} / {resources.length}
        </Badge>
        <Select
          value={sort}
          onChange={(event) =>
            setSort(event.target.value as "name" | "modified" | "size")
          }
        >
          <option value="name">按名称</option>
          <option value="modified">最近修改</option>
          <option value="size">文件大小</option>
        </Select>
      </section>

      {resources.some((resource) => !resource.available) ? (
        <div className="offline-notice">
          <AlertTriangle size={17} />
          <div>
            <strong>部分目录暂时不可访问</strong>
            <span>已保留上次扫描结果，不会因 E 盘离线而删除记录。</span>
          </div>
          <button type="button" onClick={() => setFilter("offline")}>
            查看离线项
          </button>
        </div>
      ) : null}

      {visible.length ? (
        <div className="resource-grid">
          {visible.map((resource) => (
            <article className="resource-card" key={resource.id}>
              <ResourceVisual
                resource={resource}
                privacyMode={privacyMode}
              />
              <div className="resource-card-copy">
                <div className="resource-card-title">
                  <span
                    className={`resource-type-icon resource-type-${resource.resourceType}`}
                  >
                    {resource.resourceType === "lora" ? (
                      <Sparkles size={15} />
                    ) : resource.resourceType === "checkpoint" ? (
                      <FileBox size={15} />
                    ) : (
                      <Box size={15} />
                    )}
                  </span>
                  <div>
                    <h3>{resource.name}</h3>
                    <span>{resourceTypeLabel(resource.resourceType)}</span>
                  </div>
                  <IconButton
                    label="编辑资源信息"
                    onClick={() => setEditing(resource)}
                  >
                    <Pencil size={16} />
                  </IconButton>
                </div>
                <div className="resource-meta-row">
                  <span>{resource.baseModel || "底模未知"}</span>
                  <span>{formatBytes(resource.fileSize)}</span>
                  <Badge tone={resource.available ? "success" : "warning"}>
                    {resource.available ? "在线" : "离线"}
                  </Badge>
                </div>
                {resource.resourceType === "lora" ? (
                  <div className="resource-triggers">
                    {resource.confirmedTriggerWords.slice(0, 3).map((trigger) => (
                      <span key={trigger}>{trigger}</span>
                    ))}
                    {!resource.confirmedTriggerWords.length ? (
                      <button type="button" onClick={() => setEditing(resource)}>
                        <Plus size={13} />补充触发词
                      </button>
                    ) : null}
                    {resource.confirmedTriggerWords.length > 3 ? (
                      <small>+{resource.confirmedTriggerWords.length - 3}</small>
                    ) : null}
                  </div>
                ) : (
                  <p className="resource-path">{resource.path}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Search size={24} />}
          title={hasActiveFilter ? "没有符合条件的资源" : "尚未扫描到模型资源"}
          description={
            hasActiveFilter
              ? "换个关键词，或清除搜索与类型筛选后再试。"
              : "确认目录路径后重新扫描，离线记录仍会安全保留。"
          }
          action={
            hasActiveFilter ? (
              <Button
                variant="secondary"
                icon={<X size={16} />}
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                清除搜索与筛选
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<RefreshCw size={16} />}
                onClick={() => void scan()}
              >
                重新扫描
              </Button>
            )
          }
        />
      )}

      {editing ? (
        <ResourceEditor
          resource={editing}
          privacyMode={privacyMode}
          onClose={() => setEditing(null)}
          onSave={onSave}
          onToast={onToast}
        />
      ) : null}

      {importOpen ? (
        <DownloadLoraImportModal
          settings={settings}
          onClose={() => setImportOpen(false)}
          onImported={onScanComplete}
          onToast={onToast}
        />
      ) : null}
    </div>
  );
}

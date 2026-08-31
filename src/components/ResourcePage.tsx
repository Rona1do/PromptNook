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
  if (!value) return "Unknown size";
  const gb = value / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function formatRelativeTime(iso?: string) {
  if (!iso) return "Unknown time";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "Unknown time";
  const diffMs = Date.now() - time;
  if (diffMs < 60_000) return "Just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} days ago`;
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
          alt={`${resource.name} preview`}
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
              ? "Hidden"
              : resource.resourceType === "lora"
                ? "LoRA"
                : "MODEL"}
          </span>
        </div>
      )}
      {!resource.available ? (
        <span className="offline-overlay"><CircleOff size={16} />Folder offline</span>
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
      onToast("This trigger word already exists");
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
      const message = `Save failed: ${readableError(error)}`;
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            icon={<Check size={16} />}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save details"}
          </Button>
        </>
      }
    >
      <div className="resource-editor">
        <div className="resource-editor-hero">
          <ResourceVisual resource={draft} privacyMode={privacyMode} />
          <div>
            <strong>Preview images</strong>
            <p>Helps identify the model quickly and never writes to the model folder.</p>
            <Button
              size="sm"
              variant="secondary"
              icon={<ImagePlus size={15} />}
              onClick={() => fileRef.current?.click()}
            >
              {draft.previewUrl ? "Replace preview image" : "Add preview image"}
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
          <div><span>Base model</span><strong>{draft.baseModel || "Not detected"}</strong></div>
          <div><span>File size</span><strong>{formatBytes(draft.fileSize)}</strong></div>
          <div>
            <span>Status</span>
            <strong className={draft.available ? "online" : "offline"}>
              {draft.available ? "Folder online" : "Retained offline record"}
            </strong>
          </div>
        </div>
        <Field label="File path">
          <div className="read-only-path">{draft.path}</div>
        </Field>
        {draft.resourceType === "lora" ? (
          <>
            <div className="section-heading">
              <div>
                <h3>Trigger words</h3>
                <p>Confirm suggested words with a click. Studio only enables confirmed trigger words by default.</p>
              </div>
              <Badge tone="accent">
                {draft.confirmedTriggerWords.length} Confirmed
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
                placeholder="Enter a new trigger word"
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
                Add
              </Button>
            </div>
          </>
        ) : null}
        <Field label="Personal notes">
          <textarea
            rows={3}
            value={draft.notes || ""}
            placeholder="Recommended settings, suitable styles, compatibility notes…"
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
          setError(`Could not read Downloads: ${readableError(loadError)}`);
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
      onToast("Select the LoRAs to import");
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
          `Moved ${importedNames.length} LoRAs: ${importedNames.join(", ")}`,
        );
      } else {
        parts.push("No new LoRAs were moved");
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
      const message = `Import failed: ${readableError(importError)}`;
      setError(message);
      onToast(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      title="Import LoRAs from Downloads"
      eyebrow="Quick archive"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <div className="import-lora-footer-summary">
            {selectedCandidates.length ? (
              <>
                <strong>Will import {selectedCandidates.length} items:</strong>
                <span title={selectedCandidates.map((item) => item.name).join(", ")}>
                  {selectedCandidates.map((item) => item.name).join(", ")}
                </span>
              </>
            ) : (
              <span>No LoRAs selected</span>
            )}
          </div>
          <Button variant="secondary" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button
            icon={<Download size={16} />}
            disabled={importing || !selectedCandidates.length}
            onClick={() => void confirmImport()}
          >
            {importing
              ? "Importing…"
              : `Import ${selectedCandidates.length || ""} selected`.trim()}
          </Button>
        </>
      }
    >
      <div className="import-lora-modal">
        <div className="import-lora-paths">
          <div>
            <small>Source (recent downloads)</small>
            <strong>
              {listing?.downloadsPath || "Downloads"}
            </strong>
          </div>
          <div>
            <small>Destination LoRA folder</small>
            <strong>{listing?.loraPath || settings.loraPath}</strong>
          </div>
        </div>

        <p className="import-lora-hint">
          Show only weight files from the last {listing?.recentDays ?? 14} days
          that are under 2 GB. Select by default <strong>
            the last {listing?.defaultSelectHours ?? 6} hours
          </strong>{" "}
          of new files. Import mode: <strong>move</strong>{" "}
          (the original downloaded files are removed). Review the exact names below before confirming.
        </p>

        {loading ? (
          <div className="import-lora-status">Scanning Downloads…</div>
        ) : error && !listing ? (
          <div className="import-lora-status is-error">{error}</div>
        ) : listing && listing.candidates.length === 0 ? (
          <div className="import-lora-status">
            Recent {listing.recentDays} days contain no importable LoRA files.
          </div>
        ) : listing ? (
          <>
            <div className="import-lora-toolbar">
              <Badge tone="accent">
                Recent {listing.candidates.length} candidates
              </Badge>
              <button type="button" onClick={selectDefaultWindow}>
                Select recent {listing.defaultSelectHours} hours
              </button>
              <button type="button" onClick={selectAllNew}>
                Select all importable
              </button>
              <button type="button" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
              <label className="import-lora-overwrite">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                Overwrite files with the same name in the destination
              </label>
            </div>

            <ul className="import-lora-list" aria-label="Recently downloaded LoRAs">
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
                              the last {listing.defaultSelectHours} hours
                            </Badge>
                          ) : null}
                          {item.alreadyExists ? (
                            <Badge tone="warning">Already exists</Badge>
                          ) : (
                            <Badge tone="success">New file</Badge>
                          )}
                          {item.companionFiles.length ? (
                            <span>
                              +{item.companionFiles.length} sidecar files
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
                  <strong>These LoRAs will be imported:</strong>
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
          ? `Scan complete: ${result.updated} updated, ${result.offlinePaths.length} paths offline`
          : `Scan complete: ${result.scanned} resources found`,
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="page resources-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Read-only model index</span>
          <h1>Models & LoRAs</h1>
          <p>Keep models visible and trigger words memorable while source files remain read-only.</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={<Download size={16} />}
            onClick={() => setImportOpen(true)}
          >
            Import downloaded LoRAs
          </Button>
          <Button
            variant="secondary"
            icon={<Folder size={16} />}
            onClick={onOpenSettings}
          >
            Model folders
          </Button>
          <Button
            icon={<RefreshCw size={16} className={scanning ? "spin" : ""} />}
            disabled={scanning}
            onClick={() => void scan()}
          >
            {scanning ? "Scanning…" : "Scan for updates"}
          </Button>
        </div>
      </header>

      <div className="resource-path-strip">
        <Info size={16} />
        <span>
          LoRA: <strong>{settings.loraPath}</strong>
        </span>
        <span>
          Models: <strong>{settings.checkpointPath}</strong>
        </span>
        <Badge tone="success">Read only</Badge>
      </div>

      <section className="toolbar">
        <div className="segmented-filter">
          {(
            [
              ["all", "All", resources.length],
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
                "Offline",
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
            aria-label="Search models & LoRAs"
            autoComplete="off"
            placeholder="Search name, path, base model, or trigger word"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear resource search"
              onClick={() => setQuery("")}
            >
              <X size={14} />
            </button>
          ) : null}
        </label>
        <Badge tone={hasActiveFilter ? "accent" : "neutral"}>
          Show {visible.length} / {resources.length}
        </Badge>
        <Select
          value={sort}
          onChange={(event) =>
            setSort(event.target.value as "name" | "modified" | "size")
          }
        >
          <option value="name">By name</option>
          <option value="modified">Recently updated</option>
          <option value="size">File size</option>
        </Select>
      </section>

      {resources.some((resource) => !resource.available) ? (
        <div className="offline-notice">
          <AlertTriangle size={17} />
          <div>
            <strong>Some folders are temporarily unavailable</strong>
            <span>The previous scan is retained; disconnected drives never cause records to be deleted.</span>
          </div>
          <button type="button" onClick={() => setFilter("offline")}>
            Show offline items
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
                    label="Edit resource details"
                    onClick={() => setEditing(resource)}
                  >
                    <Pencil size={16} />
                  </IconButton>
                </div>
                <div className="resource-meta-row">
                  <span>{resource.baseModel || "Unknown base model"}</span>
                  <span>{formatBytes(resource.fileSize)}</span>
                  <Badge tone={resource.available ? "success" : "warning"}>
                    {resource.available ? "Online" : "Offline"}
                  </Badge>
                </div>
                {resource.resourceType === "lora" ? (
                  <div className="resource-triggers">
                    {resource.confirmedTriggerWords.slice(0, 3).map((trigger) => (
                      <span key={trigger}>{trigger}</span>
                    ))}
                    {!resource.confirmedTriggerWords.length ? (
                      <button type="button" onClick={() => setEditing(resource)}>
                        <Plus size={13} />Add trigger words
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
          title={hasActiveFilter ? "No matching resources" : "No model resources scanned yet"}
          description={
            hasActiveFilter
              ? "Try another keyword or clear the search and type filters."
              : "Check the folder paths and scan again. Offline records remain safely available."
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
                Clear search & filters
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={<RefreshCw size={16} />}
                onClick={() => void scan()}
              >
                Scan again
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

import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  CheckCircle2,
  CloudOff,
  Database,
  Download,
  EyeOff,
  FolderOpen,
  HardDrive,
  Languages,
  KeyRound,
  PackageOpen,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  BackupSnapshot,
  TrashItem,
  TranslationProvider,
} from "../types";
import { api, isDesktopRuntime } from "../lib/api";
import { readableError } from "../lib/errors";
import { Badge, Button, EmptyState, Field, IconButton, Notice, Select, Toggle } from "./ui";

type SettingsTab = "general" | "translation" | "backup" | "trash";

function formatDate(value?: string) {
  if (!value) return "None yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsDrawer({
  settings,
  initialTab = "general",
  onClose,
  onSave,
  onDataChanged,
  onToast,
}: {
  settings: AppSettings;
  initialTab?: SettingsTab;
  onClose: () => void;
  onSave: (settings: AppSettings | Partial<AppSettings>) => Promise<void>;
  onDataChanged: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState<BackupSnapshot[]>([]);
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [working, setWorking] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [testingTranslation, setTestingTranslation] = useState(false);
  const [translationTest, setTranslationTest] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const glossaryInputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (tab === "backup") {
      void api.listBackups().then(setBackups);
    }
    if (tab === "trash") {
      void api.listTrash().then(setTrash);
    }
  }, [tab]);

  useEffect(() => {
    if (
      tab !== "translation" ||
      draft.translationProvider === "off"
    ) {
      setCredentialConfigured(false);
      return;
    }
    void api
      .hasTranslationApiKey(draft.translationProvider)
      .then(setCredentialConfigured)
      .catch(() => setCredentialConfigured(false));
  }, [draft.translationProvider, tab]);

  async function chooseFolder(
    key: "loraPath" | "checkpointPath" | "diffusionModelPath" | "backupPath",
  ) {
    if (!isDesktopRuntime()) {
      onToast("Edit paths directly in the browser preview; the desktop app opens a folder picker");
      return;
    }
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setDraft((current) => ({ ...current, [key]: selected }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      if (draft.translationProvider !== "off" && apiKey) {
        await api.saveTranslationApiKey(
          draft.translationProvider,
          apiKey,
        );
        setCredentialConfigured(true);
        setApiKey("");
      }
      onToast("Settings saved");
    } catch (error) {
      onToast(`Could not save settings: ${readableError(error)}`);
    } finally {
      setSaving(false);
    }
  }

  function addPromptWorkspace() {
    const id = `workspace-${Date.now().toString(36)}`;
    setDraft((current) => ({
      ...current,
      promptModels: [
        ...current.promptModels,
        {
          id,
          name: "New workspace",
          description: "A separate library for this model family or workflow",
        },
      ],
    }));
  }

  async function createBackup() {
    setWorking(true);
    try {
      const backup = await api.createBackup();
      setBackups((items) => [backup, ...items]);
      onToast("Verified snapshot created");
    } finally {
      setWorking(false);
    }
  }

  async function exportData(format: "promptnook" | "json" | "csv") {
    setWorking(true);
    try {
      const message = await api.exportData(format);
      onToast(message || "Export complete");
    } finally {
      setWorking(false);
    }
  }

  async function restoreItem(item: TrashItem) {
    await api.restoreItem(item.entityType, item.id);
    setTrash((items) =>
      items.filter(
        (candidate) =>
          !(
            candidate.id === item.id &&
            candidate.entityType === item.entityType
          ),
      ),
    );
    await onDataChanged();
    onToast("Item restored");
  }

  async function purgeItem(item: TrashItem) {
    if (
      !window.confirm(
        `Permanently delete “${item.title}”? This cannot be undone and unreferenced preview images will also be removed.`,
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      await api.purgeItem(item.entityType, item.id);
      setTrash((items) =>
        items.filter(
          (candidate) =>
            !(
              candidate.id === item.id &&
              candidate.entityType === item.entityType
            ),
        ),
      );
      await onDataChanged();
      onToast("Permanently deleted");
    } catch (error) {
      onToast(readableError(error));
    } finally {
      setWorking(false);
    }
  }

  async function emptyTrash() {
    if (!trash.length) return;
    if (
      !window.confirm(
        `Permanently delete all ${trash.length} Trash items? This cannot be undone and unreferenced images will be removed.`,
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      const count = await api.emptyTrash();
      setTrash([]);
      await onDataChanged();
      onToast(`Permanently deleted ${count} items`);
    } catch (error) {
      onToast(readableError(error));
    } finally {
      setWorking(false);
    }
  }

  async function restoreBackup(backup: BackupSnapshot) {
    if (
      !window.confirm(
        `Restore the snapshot from ${formatDate(backup.createdAt)}? Current data will be backed up first and reloaded after restore.`,
      )
    )
      return;
    setWorking(true);
    try {
      await api.restoreBackup(backup.id);
      await onDataChanged();
      onToast("Snapshot verified and restored");
    } finally {
      setWorking(false);
    }
  }

  async function importPackage() {
    if (!isDesktopRuntime()) {
      onToast("Migration packages can only be imported in the desktop app");
      return;
    }
    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "PromptNook package", extensions: ["promptnook", "promptvault"] }],
    });
    if (typeof selected !== "string") return;
    setWorking(true);
    try {
      const imported = await api.importPromptVault(selected);
      setBackups((items) => [
        imported,
        ...items.filter((item) => item.id !== imported.id),
      ]);
      onToast("Migration package verified and imported; restore it from the latest snapshots");
    } finally {
      setWorking(false);
    }
  }

  async function importGlossary(file?: File) {
    if (!file) return;
    setWorking(true);
    try {
      const count = await api.importGlossaryCsv(await file.text());
      onToast(`Imported ${count} glossary entries`);
    } finally {
      setWorking(false);
      if (glossaryInputRef.current) glossaryInputRef.current.value = "";
    }
  }

  async function clearCredential() {
    if (draft.translationProvider === "off") return;
    await api.saveTranslationApiKey(draft.translationProvider, "");
    setApiKey("");
    setCredentialConfigured(false);
    onToast("Translation API key removed from Windows Credential Manager");
  }

  function applyGooglePreset() {
    setDraft((current) => ({
      ...current,
      translationProvider: "openai",
      translationEndpoint:
        "https://generativelanguage.googleapis.com/v1beta/openai",
      translationModel: "gemini-3.1-flash-lite",
    }));
    setTranslationTest(null);
    onToast("Google Gemini settings applied; enter an API key to test translation");
  }

  async function testTranslation() {
    if (draft.translationProvider === "off") return;
    setTestingTranslation(true);
    setTranslationTest(null);
    try {
      const result = await api.translateText({
        text: "cinematic film still",
        targetLanguage: draft.translationTargetLanguage || "en",
        provider: draft.translationProvider,
        endpoint: draft.translationEndpoint,
        model: draft.translationModel,
        apiKey: apiKey.trim() || undefined,
        testConnection: true,
      });
      if (!result.text.trim()) {
        throw new Error("The service returned an empty translation");
      }
      setTranslationTest({
        ok: true,
        message: `Connection successful. Test translation: ${result.text}`,
      });
    } catch (error) {
      setTranslationTest({
        ok: false,
        message: `Test failed: ${readableError(error)}`,
      });
    } finally {
      setTestingTranslation(false);
    }
  }

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <aside
        ref={drawerRef}
        tabIndex={-1}
        className="settings-drawer"
        aria-label="Settings"
        role="dialog"
        aria-modal="true"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div className="header-title">
            <span className="header-icon"><Settings size={18} /></span>
            <div>
              <span className="eyebrow">PromptNook</span>
              <h2>Settings & safety</h2>
            </div>
          </div>
          <IconButton label="Close settings" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>

        <nav className="drawer-tabs">
          <button
            type="button"
            className={tab === "general" ? "is-active" : ""}
            onClick={() => setTab("general")}
          >
            <HardDrive size={16} />General
          </button>
          <button
            type="button"
            className={tab === "translation" ? "is-active" : ""}
            onClick={() => setTab("translation")}
          >
            <Languages size={16} />Translation
          </button>
          <button
            type="button"
            className={tab === "backup" ? "is-active" : ""}
            onClick={() => setTab("backup")}
          >
            <Database size={16} />Backup & export
          </button>
          <button
            type="button"
            className={tab === "trash" ? "is-active" : ""}
            onClick={() => setTab("trash")}
          >
            <Trash2 size={16} />Trash
            {trash.length ? <i>{trash.length}</i> : null}
          </button>
        </nav>

        <div className="drawer-content">
          {tab === "general" ? (
            <div className="settings-section">
              <div className="section-heading">
                <div>
                  <h3>Prompt workspaces</h3>
                  <p>
                    Create a separate recipe and snippet library for every model
                    family, client, or workflow you use.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={15} />}
                  onClick={addPromptWorkspace}
                >
                  Add workspace
                </Button>
              </div>
              <div className="workspace-settings-list">
                {draft.promptModels.map((profile, index) => (
                  <div className="workspace-settings-row" key={profile.id}>
                    <Field label="Name">
                      <input
                        value={profile.name}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            promptModels: current.promptModels.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                    </Field>
                    <Field label="Description">
                      <input
                        value={profile.description}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            promptModels: current.promptModels.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, description: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                    </Field>
                    <code>{profile.id}</code>
                  </div>
                ))}
              </div>
              <p className="settings-hint">
                Workspace ids stay stable when you rename them, so existing data
                never loses its association.
              </p>

              <hr />
              <div className="section-heading">
                <div>
                  <h3>Model folders</h3>
                  <p>Read-only scanning never moves, edits, or deletes model files.</p>
                </div>
                <Badge tone="success">Read only</Badge>
              </div>
              {(
                [
                  ["loraPath", "LoRA folder"],
                  ["checkpointPath", "Checkpoint folder"],
                  ["diffusionModelPath", "Diffusion model folder"],
                ] as const
              ).map(([key, label]) => (
                <Field label={label} key={key}>
                  <span className="path-input">
                    <input
                      value={draft[key]}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                    <IconButton
                      label={`Choose ${label}`}
                      onClick={() => void chooseFolder(key)}
                    >
                      <FolderOpen size={17} />
                    </IconButton>
                  </span>
                </Field>
              ))}

              <hr />
              <div className="setting-row">
                <div>
                  <strong>
                    <EyeOff size={17} />
                    Privacy mode
                  </strong>
                  <p>
                    Hides image and model previews from the interface. This is a
                    shoulder-surfing safeguard, not disk encryption.
                  </p>
                </div>
                <Toggle
                  label="Privacy mode"
                  checked={draft.privacyMode}
                  onChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      privacyMode: checked,
                    }))
                  }
                />
              </div>

              <hr />
              <Field
                label={`Default positive prefix (${draft.promptModels.find((item) => item.id === draft.activePromptModel)?.name ?? draft.activePromptModel})`}
              >
                <textarea
                  rows={3}
                  value={draft.defaultPrefix}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultPrefix: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field
                label={`Default negative prompt (${draft.promptModels.find((item) => item.id === draft.activePromptModel)?.name ?? draft.activePromptModel})`}
              >
                <textarea
                  rows={3}
                  value={draft.defaultNegative}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      defaultNegative: event.target.value,
                    }))
                  }
                />
              </Field>
              <p className="settings-hint">
                Defaults are stored independently for the active workspace and
                only affect its Studio.
              </p>
            </div>
          ) : null}

          {tab === "translation" ? (
            <div className="settings-section">
              <div className="section-heading">
                <div>
                  <h3>Translation</h3>
                  <p>Choose any target language. A glossary runs before an optional local or compatible service.</p>
                </div>
                <Languages size={21} />
              </div>
              <Field label="Target language">
                <input
                  value={draft.translationTargetLanguage}
                  placeholder="e.g. en, zh-CN, Japanese, Français"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      translationTargetLanguage: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Translation service">
                <Select
                  value={draft.translationProvider}
                  onChange={(event) => {
                    setTranslationTest(null);
                    setDraft((current) => ({
                      ...current,
                      translationProvider: event.target
                        .value as TranslationProvider,
                    }));
                  }}
                >
                  <option value="off">Built-in glossary only (offline)</option>
                  <option value="ollama">Local Ollama service</option>
                  <option value="openai">OpenAI-compatible endpoint</option>
                </Select>
              </Field>
              <div className="export-row">
                <span>Use the Google Gemini API</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={applyGooglePreset}
                >
                  Apply Google preset
                </Button>
              </div>
              {draft.translationProvider !== "off" ? (
                <>
                  <Field
                    label="API endpoint"
                    hint={
                      draft.translationEndpoint.includes(
                        "generativelanguage.googleapis.com",
                      )
                        ? "Recommended: apply the Google preset, enter a Gemini key, and enable automatic translation. Long prompts are translated in chunks. Free web translation endpoints often rate-limit requests."
                        : undefined
                    }
                  >
                    <input
                      value={draft.translationEndpoint}
                      onChange={(event) => {
                        setTranslationTest(null);
                        setDraft((current) => ({
                          ...current,
                          translationEndpoint: event.target.value,
                        }));
                      }}
                      placeholder="http://localhost:11434/v1"
                    />
                  </Field>
                  <Field label="Model name">
                    <input
                      value={draft.translationModel}
                      onChange={(event) => {
                        setTranslationTest(null);
                        setDraft((current) => ({
                          ...current,
                          translationModel: event.target.value,
                        }));
                      }}
                      placeholder="qwen2.5:7b"
                    />
                  </Field>
                  <Field
                    label={
                      credentialConfigured
                        ? "API key (stored securely)"
                        : "API key (optional)"
                    }
                    hint="Stored only in Windows Credential Manager, never in the database, backups, or exports."
                  >
                    <span className="path-input">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={apiKey}
                        onChange={(event) => {
                          setApiKey(event.target.value);
                          setTranslationTest(null);
                        }}
                        placeholder={
                          credentialConfigured
                            ? "Enter a new key to replace the stored credential"
                            : "sk-…"
                        }
                      />
                      {credentialConfigured ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void clearCredential()}
                        >
                          Remove
                        </Button>
                      ) : (
                        <KeyRound size={17} aria-hidden="true" />
                      )}
                    </span>
                  </Field>
                  <div className="setting-row">
                    <div>
                      <strong>Allow automatic translation</strong>
                      <p>Text is sent to the configured service only after you explicitly enable this option.</p>
                    </div>
                    <Toggle
                      label="Allow automatic translation"
                      checked={draft.onlineTranslationEnabled}
                      onChange={(checked) =>
                        setDraft((current) => ({
                          ...current,
                          onlineTranslationEnabled: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="export-row">
                    <span>Run a real translation with the current values without saving first.</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        testingTranslation ||
                        !draft.translationEndpoint.trim() ||
                        !draft.translationModel.trim()
                      }
                      onClick={() => void testTranslation()}
                    >
                      {testingTranslation ? "Testing…" : "Test translation"}
                    </Button>
                  </div>
                  {translationTest ? (
                    <Notice tone={translationTest.ok ? "success" : "warning"}>
                      {translationTest.message}
                    </Notice>
                  ) : null}
                </>
              ) : (
                <Notice>
                  Text not found in the offline glossary is marked Pending translation and can still be saved.
                </Notice>
              )}
              <Notice tone="success">
                Manually edited and locked translations are never overwritten.
              </Notice>
              <div className="export-row">
                <span>Custom glossary</span>
                <input
                  ref={glossaryInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(event) =>
                    void importGlossary(event.target.files?.[0])
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Upload size={15} />}
                  disabled={working}
                  onClick={() => glossaryInputRef.current?.click()}
                >
                  Import a two-column glossary CSV
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "backup" ? (
            <div className="settings-section">
              <div className="section-heading">
                <div>
                  <h3>Data vault</h3>
                  <p>Your live library stays on this device. Keep backups on another drive or synced folder.</p>
                </div>
                <ShieldCheck size={22} />
              </div>
              <Field label="Secondary backup location">
                <span className="path-input">
                  <input
                    value={draft.backupPath}
                    placeholder="Choose another drive, removable storage, or a synced folder"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        backupPath: event.target.value,
                      }))
                    }
                  />
                  <IconButton
                    label="Choose backup folder"
                    onClick={() => void chooseFolder("backupPath")}
                  >
                    <FolderOpen size={17} />
                  </IconButton>
                </span>
              </Field>
              {!draft.backupPath ? (
                <Notice tone="warning">
                  No secondary backup is configured. A disk failure could also destroy local snapshots.
                </Notice>
              ) : (
                <Notice tone="success">
                  A secondary backup location is configured; automatic backups run after changes while idle.
                </Notice>
              )}
              <div className="button-row">
                <Button
                  variant="secondary"
                  icon={<Database size={16} />}
                  disabled={working}
                  onClick={() => void createBackup()}
                >
                  Create snapshot now
                </Button>
                <Button
                  variant="ghost"
                  icon={<Download size={16} />}
                  disabled={working}
                  onClick={() => void exportData("promptnook")}
                >
                  Export migration package
                </Button>
                <Button
                  variant="ghost"
                  icon={<PackageOpen size={16} />}
                  disabled={working}
                  onClick={() => void importPackage()}
                >
                  Import migration package
                </Button>
              </div>
              <div className="subsection-title">
                <strong>Recent snapshots</strong>
                <span>Database integrity, foreign keys, and file hashes are verified before restore</span>
              </div>
              {backups.length ? (
                <div className="backup-list">
                  {backups.map((backup) => (
                    <article key={backup.id}>
                      <span className="backup-icon"><Database size={17} /></span>
                      <div>
                        <strong>{formatDate(backup.createdAt)}</strong>
                        <small>
                          {formatBytes(backup.size)} · {backup.location}
                        </small>
                      </div>
                      <Badge
                        tone={backup.status === "valid" ? "success" : "danger"}
                      >
                        {backup.status === "valid" ? "Valid" : "Invalid"}
                      </Badge>
                      <IconButton
                        label="Restore this snapshot"
                        disabled={working || backup.status !== "valid"}
                        onClick={() => void restoreBackup(backup)}
                      >
                        <RotateCcw size={16} />
                      </IconButton>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Database size={23} />}
                  title="No snapshots yet"
                  description="Snapshots are created automatically after changes, or you can create one now."
                />
              )}
              <div className="export-row">
                <span>Human-readable exports</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void exportData("json")}
                >
                  Export JSON
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void exportData("csv")}
                >
                  Export CSV
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "trash" ? (
            <div className="settings-section">
              <div className="section-heading">
                <div>
                  <h3>Trash</h3>
                  <p>
                    Items are moved to Trash by default. Permanent deletion removes records and unreferenced preview images.
                  </p>
                </div>
                <ArchiveRestore size={22} />
              </div>
              {trash.length ? (
                <>
                  <div className="export-row">
                    <span>{trash.length} items can be restored or permanently deleted</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={working}
                      onClick={() => void emptyTrash()}
                    >
                      Empty Trash
                    </Button>
                  </div>
                  <div className="trash-list">
                    {trash.map((item) => (
                      <article key={`${item.entityType}-${item.id}`}>
                        <span className="trash-icon">
                          <Trash2 size={17} />
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>
                            {formatDate(item.deletedAt)} Move to Trash
                          </small>
                        </div>
                        <div className="button-row">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<ArchiveRestore size={15} />}
                            disabled={working}
                            onClick={() => void restoreItem(item)}
                          >
                            Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={working}
                            onClick={() => void purgeItem(item)}
                          >
                            Delete permanently
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<CheckCircle2 size={23} />}
                  title="Trash is empty"
                  description="Deleted recipes, snippets, categories, and tips appear here first."
                />
              )}
            </div>
          ) : null}
        </div>

        <footer className="drawer-footer">
          <div className="local-only">
            <CloudOff size={15} />
            <span>Local first · No account required</span>
          </div>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            icon={<Save size={16} />}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </footer>
      </aside>
    </div>
  );
}

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
      onToast("浏览器预览中可直接编辑路径；桌面版会打开目录选择器");
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
      onToast("设置已保存");
    } catch (error) {
      onToast(`设置保存失败：${readableError(error)}`);
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
      onToast("已创建一致性快照");
    } finally {
      setWorking(false);
    }
  }

  async function exportData(format: "promptnook" | "json" | "csv") {
    setWorking(true);
    try {
      const message = await api.exportData(format);
      onToast(message || "导出已完成");
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
    onToast("项目已恢复");
  }

  async function purgeItem(item: TrashItem) {
    if (
      !window.confirm(
        `彻底删除“${item.title}”？此操作不可恢复，关联示例图若不再被引用也会一并清理。`,
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
      onToast("已彻底删除");
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
        `清空回收站中的 ${trash.length} 项？此操作不可恢复，并会清理不再引用的图片文件。`,
      )
    ) {
      return;
    }
    setWorking(true);
    try {
      const count = await api.emptyTrash();
      setTrash([]);
      await onDataChanged();
      onToast(`已彻底删除 ${count} 项`);
    } catch (error) {
      onToast(readableError(error));
    } finally {
      setWorking(false);
    }
  }

  async function restoreBackup(backup: BackupSnapshot) {
    if (
      !window.confirm(
        `恢复 ${formatDate(backup.createdAt)} 的快照？当前资料会先自动备份，恢复完成后重新载入。`,
      )
    )
      return;
    setWorking(true);
    try {
      await api.restoreBackup(backup.id);
      await onDataChanged();
      onToast("快照校验并恢复完成");
    } finally {
      setWorking(false);
    }
  }

  async function importPackage() {
    if (!isDesktopRuntime()) {
      onToast("迁移包导入需要在桌面版中使用");
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
      onToast("迁移包已校验导入；可从最近快照中恢复");
    } finally {
      setWorking(false);
    }
  }

  async function importGlossary(file?: File) {
    if (!file) return;
    setWorking(true);
    try {
      const count = await api.importGlossaryCsv(await file.text());
      onToast(`已导入 ${count} 条双语词表记录`);
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
    onToast("翻译 API 密钥已从 Windows 凭据管理器移除");
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
    onToast("已套用 Google Gemini 参数；输入 API 密钥后可先测试翻译");
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
        throw new Error("服务返回了空译文");
      }
      setTranslationTest({
        ok: true,
        message: `连接成功，测试译文：${result.text}`,
      });
    } catch (error) {
      setTranslationTest({
        ok: false,
        message: `测试失败：${readableError(error)}`,
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
        aria-label="设置"
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
                  <option value="off">仅使用内置词表（离线）</option>
                  <option value="ollama">Ollama 本地服务</option>
                  <option value="openai">OpenAI-compatible 接口</option>
                </Select>
              </Field>
              <div className="export-row">
                <span>使用 Google Gemini API</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={applyGooglePreset}
                >
                  一键套用 Google 参数
                </Button>
              </div>
              {draft.translationProvider !== "off" ? (
                <>
                  <Field
                    label="API 地址"
                    hint={
                      draft.translationEndpoint.includes(
                        "generativelanguage.googleapis.com",
                      )
                        ? "推荐：一键套用 Google + 填写 Gemini 密钥并开启「允许自动翻译」。单句走 Gemini；长总 Prompt 会分段翻译。勿依赖免费网页翻译接口（易 429）。"
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
                  <Field label="模型名称">
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
                        ? "API 密钥（已安全保存）"
                        : "API 密钥（可选）"
                    }
                    hint="只写入 Windows 凭据管理器，不进入数据库、备份或导出包。"
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
                            ? "输入新密钥可替换现有凭据"
                            : "sk-…"
                        }
                      />
                      {credentialConfigured ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void clearCredential()}
                        >
                          移除
                        </Button>
                      ) : (
                        <KeyRound size={17} aria-hidden="true" />
                      )}
                    </span>
                  </Field>
                  <div className="setting-row">
                    <div>
                      <strong>允许自动翻译</strong>
                      <p>仅在你明确开启后，才会向配置的服务发送文本。</p>
                    </div>
                    <Toggle
                      label="允许自动翻译"
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
                    <span>使用当前填写内容发起一次真实翻译，不必先保存。</span>
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
                      {testingTranslation ? "测试中…" : "测试翻译"}
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
                  离线词表未命中的内容会标记为“待翻译”，不会影响保存。
                </Notice>
              )}
              <Notice tone="success">
                手工修改并锁定的译文永远不会被自动翻译覆盖。
              </Notice>
              <div className="export-row">
                <span>自己的双语词表</span>
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
                  导入英中两列 CSV
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "backup" ? (
            <div className="settings-section">
              <div className="section-heading">
                <div>
                  <h3>数据保险箱</h3>
                  <p>活库保存在本机；建议把备份放到另一块磁盘或同步盘。</p>
                </div>
                <ShieldCheck size={22} />
              </div>
              <Field label="第二备份位置">
                <span className="path-input">
                  <input
                    value={draft.backupPath}
                    placeholder="建议选择 D 盘、移动硬盘或 OneDrive"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        backupPath: event.target.value,
                      }))
                    }
                  />
                  <IconButton
                    label="选择备份目录"
                    onClick={() => void chooseFolder("backupPath")}
                  >
                    <FolderOpen size={17} />
                  </IconButton>
                </span>
              </Field>
              {!draft.backupPath ? (
                <Notice tone="warning">
                  尚未设置异盘备份。单块硬盘损坏时，本机快照也可能丢失。
                </Notice>
              ) : (
                <Notice tone="success">
                  已配置第二备份位置，自动备份会在修改后空闲时运行。
                </Notice>
              )}
              <div className="button-row">
                <Button
                  variant="secondary"
                  icon={<Database size={16} />}
                  disabled={working}
                  onClick={() => void createBackup()}
                >
                  立即创建快照
                </Button>
                <Button
                  variant="ghost"
                  icon={<Download size={16} />}
                  disabled={working}
                  onClick={() => void exportData("promptnook")}
                >
                  导出完整包
                </Button>
                <Button
                  variant="ghost"
                  icon={<PackageOpen size={16} />}
                  disabled={working}
                  onClick={() => void importPackage()}
                >
                  导入迁移包
                </Button>
              </div>
              <div className="subsection-title">
                <strong>最近快照</strong>
                <span>恢复前会完整校验数据库、外键与文件哈希</span>
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
                        {backup.status === "valid" ? "结构正常" : "结构异常"}
                      </Badge>
                      <IconButton
                        label="恢复此快照"
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
                  title="还没有快照"
                  description="保存修改后会自动创建，也可以现在手动创建。"
                />
              )}
              <div className="export-row">
                <span>面向人工查看</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void exportData("json")}
                >
                  导出 JSON
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void exportData("csv")}
                >
                  导出 CSV
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "trash" ? (
            <div className="settings-section">
              <div className="section-heading">
                <div>
                  <h3>回收站</h3>
                  <p>
                    默认只软删除。彻底删除会抹除记录并清理无人引用的示例图文件。
                  </p>
                </div>
                <ArchiveRestore size={22} />
              </div>
              {trash.length ? (
                <>
                  <div className="export-row">
                    <span>共 {trash.length} 项可恢复或彻底删除</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={working}
                      onClick={() => void emptyTrash()}
                    >
                      清空回收站
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
                            {formatDate(item.deletedAt)} 移入回收站
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
                            恢复
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={working}
                            onClick={() => void purgeItem(item)}
                          >
                            彻底删除
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<CheckCircle2 size={23} />}
                  title="回收站是空的"
                  description="删除的 Prompt、分类和技巧会先来到这里。"
                />
              )}
            </div>
          ) : null}
        </div>

        <footer className="drawer-footer">
          <div className="local-only">
            <CloudOff size={15} />
            <span>本地优先 · 不登录也能使用</span>
          </div>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            icon={<Save size={16} />}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存设置"}
          </Button>
        </footer>
      </aside>
    </div>
  );
}

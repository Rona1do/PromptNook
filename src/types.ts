export type EntityId = string;

export type PageKey =
  | "recipes"
  | "snippets"
  | "studio"
  | "resources"
  | "tips";

export type RecipeStatus = "draft" | "reproducible";
export type ResourceType = "lora" | "checkpoint" | "diffusion_model";
export type TipScope = "global" | "model" | "lora" | "category";
export type TranslationProvider = "off" | "ollama" | "openai";
/** Stable id for a user-defined prompt workspace (not a checkpoint filename). */
export type PromptModelId = string;

export interface PromptModelProfile {
  id: PromptModelId;
  name: string;
  description: string;
}

export interface Asset {
  id: EntityId;
  name: string;
  mimeType: string;
  url: string;
  sha256?: string;
  size?: number;
  createdAt?: string;
}

export interface GenerationParams {
  width: number | null;
  height: number | null;
  sampler: string | null;
  scheduler: string | null;
  steps: number | null;
  cfg: number | null;
  seed: string | null;
}

export interface ComfyWorkflowExportResult {
  path: string;
  warnings: string[];
  format: "ComfyUI Workflow JSON 0.4" | string;
}

export interface RecipeLora {
  resourceId: EntityId;
  name: string;
  modelStrength: number;
  clipStrength: number;
  order: number;
  triggerWords: string[];
  enabledTriggerWords: string[];
}

export interface RecipeTag {
  id: EntityId;
  name: string;
  color: string;
  kind: "pose" | "general" | string;
  sortOrder: number;
  recipeCount?: number;
  /** Pose/general tags are isolated per prompt model family. */
  promptModel?: PromptModelId | string;
}

export interface Recipe {
  id: EntityId;
  title: string;
  status: RecipeStatus;
  modality: "text_to_image" | "image_to_video";
  positivePrompt: string;
  positiveTranslation: string;
  negativePrompt: string;
  negativeTranslation: string;
  modelId?: EntityId;
  modelName?: string;
  loras: RecipeLora[];
  params: GenerationParams;
  assets: Asset[];
  coverAssetId?: EntityId;
  tagIds: EntityId[];
  notes: string;
  favorite: boolean;
  rating: number;
  usageCount: number;
  /** Which base-model prompt library this recipe belongs to. */
  promptModel: PromptModelId | string;
  createdAt: string;
  updatedAt: string;
}

export interface Snippet {
  id: EntityId;
  text: string;
  translation: string;
  notes: string;
  categoryIds: EntityId[];
  favorite: boolean;
  translationLocked: boolean;
  usageCount: number;
  /** Which base-model prompt library this snippet belongs to. */
  promptModel: PromptModelId | string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: EntityId;
  name: string;
  color: string;
  parentId?: EntityId;
  sortOrder: number;
  snippetCount?: number;
  /** Categories are isolated per prompt model family. Omitted on create → active model. */
  promptModel?: PromptModelId | string;
}

export interface Resource {
  id: EntityId;
  name: string;
  resourceType: ResourceType;
  path: string;
  available: boolean;
  previewUrl?: string;
  triggerWords: string[];
  confirmedTriggerWords: string[];
  fileSize?: number;
  modifiedAt?: string;
  baseModel?: string;
  notes?: string;
}

export interface Tip {
  id: EntityId;
  title: string;
  content: string;
  scope: TipScope;
  targetId?: EntityId;
  targetName?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  privacyMode: boolean;
  loraPath: string;
  checkpointPath: string;
  diffusionModelPath: string;
  backupPath: string;
  translationProvider: TranslationProvider;
  translationEndpoint: string;
  translationModel: string;
  onlineTranslationEnabled: boolean;
  /** Language tag or plain-language name accepted by the configured translator. */
  translationTargetLanguage: string;
  /** User-defined prompt workspaces. */
  promptModels: PromptModelProfile[];
  /** Active workspace; recipes, snippets, categories and tags are isolated by it. */
  activePromptModel: PromptModelId | string;
  /** Default studio prefix for the active prompt model. */
  defaultPrefix: string;
  /** Default studio negative for the active prompt model. */
  defaultNegative: string;
}

export interface Dashboard {
  recipeCount: number;
  snippetCount: number;
  resourceCount: number;
  favoriteCount: number;
  lastBackupAt?: string;
  backupHealthy: boolean;
  resourcePathsOnline: boolean;
}

export interface HealthStatus {
  status: "ok";
  databasePath: string;
  vaultPath: string;
  schemaVersion: number;
  recoveryMode: boolean;
  recoveryError?: string;
}

export interface BackupSnapshot {
  id: EntityId;
  createdAt: string;
  size: number;
  status: "valid" | "invalid";
  location: string;
}

export interface Revision {
  id: EntityId;
  entityType: "recipe" | "snippet" | "category" | "tip";
  entityId: EntityId;
  snapshot: unknown;
  createdAt: string;
}

export interface AssetData {
  id: EntityId;
  mimeType: string;
  dataBase64: string;
}

export interface TrashItem {
  id: EntityId;
  entityType: "recipe" | "snippet" | "category" | "tip";
  title: string;
  deletedAt: string;
}

export interface SearchResult {
  id: EntityId;
  entityType: "recipe" | "snippet" | "resource" | "tip";
  title: string;
  subtitle: string;
}

export interface PromptSegment {
  id: string;
  text: string;
  separator: string;
  translation?: string;
  locked?: boolean;
}

export interface RecipeInput
  extends Omit<Recipe, "createdAt" | "updatedAt" | "promptModel"> {
  createdAt?: string;
  updatedAt?: string;
  /** Defaults to the currently active prompt model when omitted. */
  promptModel?: PromptModelId | string;
}

export interface SnippetInput
  extends Omit<
    Snippet,
    "createdAt" | "updatedAt" | "usageCount" | "promptModel"
  > {
  createdAt?: string;
  updatedAt?: string;
  usageCount?: number;
  /** Defaults to the currently active prompt model when omitted. */
  promptModel?: PromptModelId | string;
}

export interface TipInput extends Omit<Tip, "createdAt" | "updatedAt"> {
  createdAt?: string;
  updatedAt?: string;
}

export interface AssetImportInput {
  name: string;
  mimeType: string;
  dataBase64: string;
  entityType?: "recipe" | "resource" | "snippet" | "tip";
  entityId?: EntityId;
  role?: "example" | "cover" | "preview";
  sortOrder?: number;
}

export interface TranslationRequest {
  text: string;
  targetLanguage?: string;
  provider?: Exclude<TranslationProvider, "off">;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  testConnection?: boolean;
}

export interface TranslationResponse {
  text: string;
  cached?: boolean;
}

export interface ResourceScanResult {
  resources: Resource[];
  scanned: number;
  added: number;
  updated: number;
  offlinePaths: string[];
  warnings?: string[];
}

export interface DownloadLoraCandidate {
  name: string;
  fileName: string;
  sourcePath: string;
  destinationPath: string;
  fileSize: number;
  modifiedAt: string;
  alreadyExists: boolean;
  /** True when modified within the default auto-select window (last N hours). */
  withinDefaultWindow: boolean;
  companionFiles: string[];
}

export interface ListDownloadLorasResult {
  downloadsPath: string;
  loraPath: string;
  candidates: DownloadLoraCandidate[];
  recentDays: number;
  /** Hours used for default checkbox selection. */
  defaultSelectHours: number;
}

export interface ImportedDownloadLora {
  name: string;
  fileName: string;
  sourcePath: string;
  destinationPath: string;
}

export interface ImportDownloadLorasResult {
  imported: ImportedDownloadLora[];
  skipped: string[];
  failed: string[];
  scan: ResourceScanResult;
}

export interface AppData {
  dashboard: Dashboard;
  recipes: Recipe[];
  snippets: Snippet[];
  categories: Category[];
  recipeTags: RecipeTag[];
  resources: Resource[];
  tips: Tip[];
  settings: AppSettings;
}

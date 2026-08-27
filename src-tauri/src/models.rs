use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub parent_id: Option<String>,
    pub sort_order: i64,
    #[serde(default = "default_prompt_model")]
    pub prompt_model: String,
    pub snippet_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveCategoryInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default = "default_category_color")]
    pub color: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub prompt_model: Option<String>,
}

fn default_prompt_model() -> String {
    "general".into()
}

fn default_category_color() -> String {
    "#687483".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub text: String,
    pub translation: String,
    pub notes: String,
    pub favorite: bool,
    pub usage_count: i64,
    pub translation_locked: bool,
    pub category_ids: Vec<String>,
    #[serde(default = "default_prompt_model")]
    pub prompt_model: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveSnippetInput {
    #[serde(default)]
    pub id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub translation: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub usage_count: Option<i64>,
    #[serde(default)]
    pub translation_locked: bool,
    #[serde(default)]
    pub category_ids: Vec<String>,
    #[serde(default)]
    pub prompt_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListOptions {
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub include_deleted: bool,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
    /// When set, only return rows for this prompt model family.
    /// When omitted, list commands use the active model from settings.
    #[serde(default)]
    pub prompt_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSnapshot {
    pub resource_id: String,
    pub name: String,
    #[serde(default = "default_strength")]
    pub model_strength: f64,
    #[serde(default = "default_strength")]
    pub clip_strength: f64,
    #[serde(default)]
    pub trigger_words: Vec<String>,
    #[serde(default)]
    pub enabled_trigger_words: Vec<String>,
    #[serde(default)]
    pub order: i64,
}

fn default_strength() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeTag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub kind: String,
    pub sort_order: i64,
    #[serde(default = "default_prompt_model")]
    pub prompt_model: String,
    pub recipe_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub title: String,
    pub status: String,
    pub modality: String,
    pub positive_prompt: String,
    pub negative_prompt: String,
    pub positive_translation: String,
    pub negative_translation: String,
    pub model_id: Option<String>,
    pub model_name: Option<String>,
    pub notes: String,
    pub favorite: bool,
    pub rating: i64,
    pub loras: Vec<ResourceSnapshot>,
    pub params: GenerationParams,
    pub cover_asset_id: Option<String>,
    pub assets: Vec<Asset>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    pub usage_count: i64,
    #[serde(default = "default_prompt_model")]
    pub prompt_model: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRecipeInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default = "default_recipe_status")]
    pub status: String,
    #[serde(default = "default_modality")]
    pub modality: String,
    #[serde(default)]
    pub positive_prompt: String,
    #[serde(default)]
    pub negative_prompt: String,
    #[serde(default)]
    pub positive_translation: String,
    #[serde(default)]
    pub negative_translation: String,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub model_name: Option<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub rating: i64,
    #[serde(default)]
    pub loras: Vec<ResourceSnapshot>,
    #[serde(default)]
    pub params: GenerationParams,
    #[serde(default)]
    pub cover_asset_id: Option<String>,
    #[serde(default)]
    pub assets: Vec<Asset>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub usage_count: i64,
    #[serde(default)]
    pub prompt_model: Option<String>,
}

impl Default for SaveRecipeInput {
    fn default() -> Self {
        Self {
            id: None,
            title: String::new(),
            status: default_recipe_status(),
            modality: default_modality(),
            positive_prompt: String::new(),
            negative_prompt: String::new(),
            positive_translation: String::new(),
            negative_translation: String::new(),
            model_id: None,
            model_name: None,
            notes: String::new(),
            favorite: false,
            rating: 0,
            loras: Vec::new(),
            params: GenerationParams::default(),
            cover_asset_id: None,
            assets: Vec::new(),
            tag_ids: Vec::new(),
            usage_count: 0,
            prompt_model: None,
        }
    }
}

fn default_recipe_status() -> String {
    "draft".into()
}

fn default_modality() -> String {
    "text_to_image".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct GenerationParams {
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub sampler: Option<String>,
    pub scheduler: Option<String>,
    pub steps: Option<i64>,
    pub cfg: Option<f64>,
    pub seed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tip {
    pub id: String,
    pub title: String,
    pub content: String,
    pub scope: String,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveTipInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    pub content: String,
    #[serde(default = "default_tip_scope")]
    pub scope: String,
    #[serde(default)]
    pub target_id: Option<String>,
    #[serde(default)]
    pub target_name: Option<String>,
    #[serde(default)]
    pub favorite: bool,
}

fn default_tip_scope() -> String {
    "global".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub resource_type: String,
    pub name: String,
    pub path: String,
    pub file_size: i64,
    pub modified_at: String,
    pub available: bool,
    pub trigger_words: Vec<String>,
    pub confirmed_trigger_words: Vec<String>,
    pub preview_url: Option<String>,
    pub base_model: Option<String>,
    pub notes: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveResourceInput {
    pub id: String,
    #[serde(default)]
    pub confirmed_trigger_words: Vec<String>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub preview_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub resources: Vec<Resource>,
    pub scanned: usize,
    pub added: usize,
    pub updated: usize,
    pub offline_paths: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadLoraCandidate {
    pub name: String,
    pub file_name: String,
    pub source_path: String,
    pub destination_path: String,
    pub file_size: i64,
    pub modified_at: String,
    pub already_exists: bool,
    /// True when modified within the default auto-select window (last N hours).
    pub within_default_window: bool,
    pub companion_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDownloadLorasResult {
    pub downloads_path: String,
    pub lora_path: String,
    pub candidates: Vec<DownloadLoraCandidate>,
    pub recent_days: u32,
    /// Hours used for default checkbox selection (not the list filter).
    pub default_select_hours: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDownloadLorasInput {
    pub source_paths: Vec<String>,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedDownloadLora {
    pub name: String,
    pub file_name: String,
    pub source_path: String,
    pub destination_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDownloadLorasResult {
    pub imported: Vec<ImportedDownloadLora>,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
    pub scan: ScanResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub sha256: String,
    pub mime_type: String,
    pub url: String,
    pub size: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAssetInput {
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub entity_id: Option<String>,
    pub data_base64: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default = "default_asset_role")]
    pub role: String,
    #[serde(default)]
    pub sort_order: i64,
}

fn default_asset_role() -> String {
    "example".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetData {
    pub id: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub recipe_count: i64,
    pub snippet_count: i64,
    pub resource_count: i64,
    pub favorite_count: i64,
    pub last_backup_at: Option<String>,
    pub backup_healthy: bool,
    pub resource_paths_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub entity_type: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub matched_text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub entity_type: String,
    pub id: String,
    pub title: String,
    pub deleted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub snapshot: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptModelProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub lora_path: String,
    pub checkpoint_path: String,
    pub diffusion_model_path: String,
    pub backup_path: String,
    pub translation_provider: String,
    pub translation_endpoint: String,
    pub translation_model: String,
    pub online_translation_enabled: bool,
    pub translation_target_language: String,
    pub privacy_mode: bool,
    pub prompt_models: Vec<PromptModelProfile>,
    #[serde(default = "default_prompt_model")]
    pub active_prompt_model: String,
    pub default_prefix: String,
    pub default_negative: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsInput {
    #[serde(default)]
    pub lora_path: Option<String>,
    #[serde(default)]
    pub checkpoint_path: Option<String>,
    #[serde(default)]
    pub diffusion_model_path: Option<String>,
    #[serde(default)]
    pub backup_path: Option<String>,
    #[serde(default)]
    pub translation_provider: Option<String>,
    #[serde(default)]
    pub translation_endpoint: Option<String>,
    #[serde(default)]
    pub translation_model: Option<String>,
    #[serde(default)]
    pub online_translation_enabled: Option<bool>,
    #[serde(default)]
    pub translation_target_language: Option<String>,
    #[serde(default)]
    pub privacy_mode: Option<bool>,
    #[serde(default)]
    pub prompt_models: Option<Vec<PromptModelProfile>>,
    #[serde(default)]
    pub active_prompt_model: Option<String>,
    #[serde(default)]
    pub default_prefix: Option<String>,
    #[serde(default)]
    pub default_negative: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub created_at: String,
    pub status: String,
    pub location: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationRequest {
    pub text: String,
    #[serde(default = "default_target_language")]
    pub target_language: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub test_connection: bool,
}

fn default_target_language() -> String {
    "en".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationResult {
    pub text: String,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTranslationInput {
    pub source_text: String,
    pub translated_text: String,
    #[serde(default = "default_target_language")]
    pub target_language: String,
    #[serde(default = "default_manual_provider")]
    pub provider: String,
    #[serde(default = "default_true")]
    pub locked: bool,
}

fn default_manual_provider() -> String {
    "manual".into()
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn generation_params_accept_empty_partial_and_legacy_json() {
        let missing: SaveRecipeInput = serde_json::from_value(json!({ "title": "draft" })).unwrap();
        assert!(missing.params.width.is_none());
        assert!(missing.params.sampler.is_none());
        assert!(missing.params.seed.is_none());

        let partial: SaveRecipeInput = serde_json::from_value(json!({
            "title": "partial",
            "params": { "width": 768, "sampler": "euler" }
        }))
        .unwrap();
        assert_eq!(partial.params.width, Some(768));
        assert_eq!(partial.params.sampler.as_deref(), Some("euler"));
        assert!(partial.params.height.is_none());
        assert!(partial.params.cfg.is_none());

        let legacy: SaveRecipeInput = serde_json::from_value(json!({
            "title": "legacy",
            "params": {
                "width": 1024,
                "height": 1536,
                "sampler": "dpmpp_2m",
                "scheduler": "karras",
                "steps": 28,
                "cfg": 3.5,
                "seed": "-1"
            }
        }))
        .unwrap();
        assert_eq!(legacy.params.width, Some(1024));
        assert_eq!(legacy.params.height, Some(1536));
        assert_eq!(legacy.params.steps, Some(28));
        assert_eq!(legacy.params.cfg, Some(3.5));
        assert_eq!(legacy.params.seed.as_deref(), Some("-1"));

        let serialized = serde_json::to_value(GenerationParams::default()).unwrap();
        assert!(serialized["width"].is_null());
        assert!(serialized["sampler"].is_null());
        assert!(serialized["seed"].is_null());
    }
}

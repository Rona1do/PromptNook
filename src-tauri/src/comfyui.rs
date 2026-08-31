use crate::{
    db::{get_app_settings, PromptVaultState},
    export::write_atomic,
    models::{AppSettings, Recipe, Resource},
    repository::find_recipe,
    resources::list_resources_inner,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyWorkflowExportResult {
    pub path: String,
    pub warnings: Vec<String>,
    pub format: String,
}

#[derive(Debug, Clone)]
struct WorkflowLink {
    id: i64,
    from_node: i64,
    from_slot: i64,
    to_node: i64,
    to_slot: i64,
    data_type: &'static str,
}

impl WorkflowLink {
    fn value(&self) -> Value {
        json!([
            self.id,
            self.from_node,
            self.from_slot,
            self.to_node,
            self.to_slot,
            self.data_type
        ])
    }
}

#[tauri::command]
pub fn export_comfyui_workflow(
    state: State<'_, PromptVaultState>,
    recipe_id: String,
    target_path: Option<String>,
) -> Result<ComfyWorkflowExportResult, String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "The database lock is unavailable".to_string())?;
    let recipe = find_recipe(&conn, &recipe_id, false, None)?
        .ok_or_else(|| "The prompt recipe no longer exists".to_string())?;
    let resources = list_resources_inner(&conn, None, None)?;
    let settings = get_app_settings(&conn)?;
    let (workflow, warnings) = build_comfyui_workflow(&recipe, &resources, &settings)?;

    let default_name = format!(
        "PromptNook-{}-{}.json",
        safe_file_stem(&recipe.title, &recipe.id),
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let target = target_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.exports.join(default_name));
    if target.is_dir() {
        return Err("The ComfyUI export target must be a file path".into());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the export directory: {error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(&workflow)
        .map_err(|error| format!("Could not serialize the ComfyUI workflow: {error}"))?;
    write_atomic(&target, &bytes)?;

    Ok(ComfyWorkflowExportResult {
        path: target.to_string_lossy().into_owned(),
        warnings,
        format: "ComfyUI Workflow JSON 0.4".into(),
    })
}

pub(crate) fn build_comfyui_workflow(
    recipe: &Recipe,
    resources: &[Resource],
    settings: &AppSettings,
) -> Result<(Value, Vec<String>), String> {
    if recipe.modality != "text_to_image" {
        return Err("ComfyUI export currently supports text-to-image recipes only".into());
    }
    if recipe.positive_prompt.trim().is_empty() {
        return Err("Add a positive prompt before exporting to ComfyUI".into());
    }

    let by_id: HashMap<&str, &Resource> = resources
        .iter()
        .map(|resource| (resource.id.as_str(), resource))
        .collect();
    let mut warnings = Vec::new();
    let checkpoint_name = resolve_checkpoint(recipe, &by_id, settings, &mut warnings)?;

    let mut loras = recipe.loras.clone();
    loras.sort_by_key(|lora| lora.order);
    let lora_references = loras
        .iter()
        .map(|lora| {
            if let Some(resource) = by_id.get(lora.resource_id.as_str()).copied() {
                if resource.resource_type != "lora" {
                    warnings.push(format!(
                        "{} is not catalogued as a LoRA; its display name was exported",
                        lora.name
                    ));
                    return lora.name.clone();
                }
                resource_reference(resource, &settings.lora_path, "LoRA", &mut warnings)
            } else {
                warnings.push(format!(
                    "LoRA {} is missing from the local catalog; its saved name was exported",
                    lora.name
                ));
                lora.name.clone()
            }
        })
        .collect::<Vec<_>>();

    let lora_count = loras.len() as i64;
    let positive_id = 2 + lora_count;
    let negative_id = positive_id + 1;
    let latent_id = positive_id + 2;
    let sampler_id = positive_id + 3;
    let vae_id = positive_id + 4;
    let save_id = positive_id + 5;

    let final_model_node = if lora_count == 0 { 1 } else { 1 + lora_count };
    let mut links = Vec::new();
    let mut next_link_id = 1_i64;
    let mut add_link = |from_node, from_slot, to_node, to_slot, data_type| {
        let id = next_link_id;
        next_link_id += 1;
        links.push(WorkflowLink {
            id,
            from_node,
            from_slot,
            to_node,
            to_slot,
            data_type,
        });
    };

    for index in 0..lora_count {
        let source = 1 + index;
        let target = 2 + index;
        add_link(source, 0, target, 0, "MODEL");
        add_link(source, 1, target, 1, "CLIP");
    }
    add_link(final_model_node, 0, sampler_id, 0, "MODEL");
    add_link(final_model_node, 1, positive_id, 0, "CLIP");
    add_link(final_model_node, 1, negative_id, 0, "CLIP");
    add_link(latent_id, 0, sampler_id, 3, "LATENT");
    add_link(positive_id, 0, sampler_id, 1, "CONDITIONING");
    add_link(negative_id, 0, sampler_id, 2, "CONDITIONING");
    add_link(sampler_id, 0, vae_id, 0, "LATENT");
    add_link(1, 2, vae_id, 1, "VAE");
    add_link(vae_id, 0, save_id, 0, "IMAGE");

    let output_links = |node_id: i64, slot: i64| -> Value {
        let ids = links
            .iter()
            .filter(|link| link.from_node == node_id && link.from_slot == slot)
            .map(|link| link.id)
            .collect::<Vec<_>>();
        if ids.is_empty() {
            Value::Null
        } else {
            json!(ids)
        }
    };
    let input_link = |node_id: i64, slot: i64| -> Value {
        links
            .iter()
            .find(|link| link.to_node == node_id && link.to_slot == slot)
            .map(|link| json!(link.id))
            .unwrap_or(Value::Null)
    };

    let mut nodes = vec![json!({
        "id": 1,
        "type": "CheckpointLoaderSimple",
        "pos": [-520, 40],
        "size": [315, 98],
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": [],
        "outputs": [
            {"name": "MODEL", "type": "MODEL", "links": output_links(1, 0), "slot_index": 0},
            {"name": "CLIP", "type": "CLIP", "links": output_links(1, 1), "slot_index": 1},
            {"name": "VAE", "type": "VAE", "links": output_links(1, 2), "slot_index": 2}
        ],
        "properties": node_properties("CheckpointLoaderSimple"),
        "widgets_values": [checkpoint_name]
    })];

    for (index, (lora, reference)) in loras.iter().zip(lora_references.iter()).enumerate() {
        let id = 2 + index as i64;
        nodes.push(json!({
            "id": id,
            "type": "LoraLoader",
            "pos": [-160 + (index as i64 * 350), 40],
            "size": [315, 126],
            "flags": {},
            "order": 1 + index as i64,
            "mode": 0,
            "inputs": [
                {"name": "model", "type": "MODEL", "link": input_link(id, 0)},
                {"name": "clip", "type": "CLIP", "link": input_link(id, 1)}
            ],
            "outputs": [
                {"name": "MODEL", "type": "MODEL", "links": output_links(id, 0), "slot_index": 0, "shape": 3},
                {"name": "CLIP", "type": "CLIP", "links": output_links(id, 1), "slot_index": 1, "shape": 3}
            ],
            "properties": node_properties("LoraLoader"),
            "widgets_values": [reference, lora.model_strength, lora.clip_strength]
        }));
    }

    let content_x = 240 + lora_count * 350;
    nodes.extend([
        json!({
            "id": positive_id,
            "type": "CLIPTextEncode",
            "pos": [content_x, -120],
            "size": [430, 180],
            "flags": {},
            "order": 1 + lora_count,
            "mode": 0,
            "inputs": [{"name": "clip", "type": "CLIP", "link": input_link(positive_id, 0)}],
            "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": output_links(positive_id, 0), "slot_index": 0}],
            "title": "Positive Prompt",
            "properties": node_properties("CLIPTextEncode"),
            "widgets_values": [recipe.positive_prompt]
        }),
        json!({
            "id": negative_id,
            "type": "CLIPTextEncode",
            "pos": [content_x, 120],
            "size": [430, 180],
            "flags": {},
            "order": 2 + lora_count,
            "mode": 0,
            "inputs": [{"name": "clip", "type": "CLIP", "link": input_link(negative_id, 0)}],
            "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": output_links(negative_id, 0), "slot_index": 0}],
            "title": "Negative Prompt",
            "properties": node_properties("CLIPTextEncode"),
            "widgets_values": [recipe.negative_prompt]
        }),
        json!({
            "id": latent_id,
            "type": "EmptyLatentImage",
            "pos": [content_x, 380],
            "size": [315, 106],
            "flags": {},
            "order": 3 + lora_count,
            "mode": 0,
            "inputs": [],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": output_links(latent_id, 0), "slot_index": 0}],
            "properties": node_properties("EmptyLatentImage"),
            "widgets_values": [recipe.params.width.unwrap_or(1024), recipe.params.height.unwrap_or(1024), 1]
        }),
        json!({
            "id": sampler_id,
            "type": "KSampler",
            "pos": [content_x + 520, 40],
            "size": [315, 262],
            "flags": {},
            "order": 4 + lora_count,
            "mode": 0,
            "inputs": [
                {"name": "model", "type": "MODEL", "link": input_link(sampler_id, 0)},
                {"name": "positive", "type": "CONDITIONING", "link": input_link(sampler_id, 1)},
                {"name": "negative", "type": "CONDITIONING", "link": input_link(sampler_id, 2)},
                {"name": "latent_image", "type": "LATENT", "link": input_link(sampler_id, 3)}
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": output_links(sampler_id, 0), "slot_index": 0}],
            "properties": node_properties("KSampler"),
            "widgets_values": sampler_widgets(recipe)
        }),
        json!({
            "id": vae_id,
            "type": "VAEDecode",
            "pos": [content_x + 920, 80],
            "size": [210, 46],
            "flags": {},
            "order": 5 + lora_count,
            "mode": 0,
            "inputs": [
                {"name": "samples", "type": "LATENT", "link": input_link(vae_id, 0)},
                {"name": "vae", "type": "VAE", "link": input_link(vae_id, 1)}
            ],
            "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": output_links(vae_id, 0), "slot_index": 0}],
            "properties": node_properties("VAEDecode"),
            "widgets_values": []
        }),
        json!({
            "id": save_id,
            "type": "SaveImage",
            "pos": [content_x + 1220, 80],
            "size": [315, 270],
            "flags": {},
            "order": 6 + lora_count,
            "mode": 0,
            "inputs": [{"name": "images", "type": "IMAGE", "link": input_link(save_id, 0)}],
            "outputs": [],
            "properties": node_properties("SaveImage"),
            "widgets_values": [format!("PromptNook/{}", safe_file_stem(&recipe.title, &recipe.id))]
        }),
    ]);

    let last_link_id = links.last().map(|link| link.id).unwrap_or(0);
    let workflow = json!({
        "last_node_id": save_id,
        "last_link_id": last_link_id,
        "nodes": nodes,
        "links": links.iter().map(WorkflowLink::value).collect::<Vec<_>>(),
        "groups": [],
        "config": {},
        "extra": {
            "promptnook": {
                "recipeId": recipe.id,
                "recipeTitle": recipe.title,
                "exportedAt": crate::db::now(),
                "format": "ComfyUI Workflow JSON 0.4"
            }
        },
        "version": 0.4
    });
    Ok((workflow, warnings))
}

fn resolve_checkpoint(
    recipe: &Recipe,
    resources: &HashMap<&str, &Resource>,
    settings: &AppSettings,
    warnings: &mut Vec<String>,
) -> Result<String, String> {
    if let Some(resource) = recipe
        .model_id
        .as_deref()
        .and_then(|id| resources.get(id).copied())
    {
        if resource.resource_type == "diffusion_model" {
            return Err(
                "This recipe uses a diffusion-model resource. The first exporter supports checkpoint workflows only; a FLUX template will be added separately."
                    .into(),
            );
        }
        if resource.resource_type != "checkpoint" {
            return Err("The selected recipe model is not a checkpoint resource".into());
        }
        return Ok(resource_reference(
            resource,
            &settings.checkpoint_path,
            "checkpoint",
            warnings,
        ));
    }
    if let Some(name) = recipe
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        warnings.push(
            "The saved checkpoint is missing from the local catalog; its saved display name was exported"
                .into(),
        );
        return Ok(name.to_string());
    }
    Err("Select a checkpoint in the recipe before exporting to ComfyUI".into())
}

fn resource_reference(
    resource: &Resource,
    root: &str,
    label: &str,
    warnings: &mut Vec<String>,
) -> String {
    if !resource.available {
        warnings.push(format!(
            "{label} {} is currently offline; the saved reference was exported",
            resource.name
        ));
    }
    let path = Path::new(&resource.path);
    if !root.trim().is_empty() {
        if let Ok(relative) = path.strip_prefix(Path::new(root)) {
            let value = relative.to_string_lossy().replace('\\', "/");
            if !value.is_empty() {
                return value;
            }
        }
        warnings.push(format!(
            "{label} {} is outside the configured model directory; only its filename was exported",
            resource.name
        ));
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&resource.name)
        .to_string()
}

fn sampler_widgets(recipe: &Recipe) -> Value {
    let raw_seed = recipe.params.seed.as_deref().unwrap_or("").trim();
    let parsed_seed = raw_seed
        .parse::<u64>()
        .ok()
        .filter(|seed| *seed <= 1_125_899_906_842_624);
    let (seed, control) = parsed_seed
        .map(|seed| (seed, "fixed"))
        .unwrap_or((0, "randomize"));
    json!([
        seed,
        control,
        recipe.params.steps.unwrap_or(20),
        recipe.params.cfg.unwrap_or(7.0),
        recipe.params.sampler.as_deref().unwrap_or("euler"),
        recipe.params.scheduler.as_deref().unwrap_or("normal"),
        1.0
    ])
}

fn node_properties(node_type: &str) -> Value {
    json!({
        "Node name for S&R": node_type,
        "cnr_id": "comfy-core"
    })
}

fn safe_file_stem(title: &str, fallback: &str) -> String {
    let mut output = String::new();
    let mut pending_separator = false;
    for character in title.trim().chars() {
        if character.is_alphanumeric() {
            if pending_separator && !output.is_empty() {
                output.push('-');
            }
            pending_separator = false;
            output.extend(character.to_lowercase());
        } else {
            pending_separator = true;
        }
        if output.chars().count() >= 64 {
            break;
        }
    }
    if output.is_empty() {
        format!("recipe-{}", fallback.chars().take(12).collect::<String>())
    } else {
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{GenerationParams, ResourceSnapshot};

    fn recipe() -> Recipe {
        Recipe {
            id: "recipe-1".into(),
            title: "Cinematic portrait".into(),
            status: "reproducible".into(),
            modality: "text_to_image".into(),
            positive_prompt: "cinematic portrait".into(),
            negative_prompt: "blurry".into(),
            positive_translation: String::new(),
            negative_translation: String::new(),
            model_id: Some("checkpoint-1".into()),
            model_name: Some("DreamShaper XL".into()),
            notes: String::new(),
            favorite: false,
            rating: 0,
            loras: vec![ResourceSnapshot {
                resource_id: "lora-1".into(),
                name: "Film Still".into(),
                model_strength: 0.8,
                clip_strength: 1.0,
                trigger_words: vec![],
                enabled_trigger_words: vec![],
                order: 0,
            }],
            params: GenerationParams {
                width: Some(1024),
                height: Some(768),
                sampler: Some("dpmpp_2m".into()),
                scheduler: Some("karras".into()),
                steps: Some(24),
                cfg: Some(5.5),
                seed: Some("42".into()),
            },
            cover_asset_id: None,
            assets: vec![],
            tag_ids: vec![],
            usage_count: 0,
            prompt_model: "general".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn resource(id: &str, resource_type: &str, name: &str, path: &str) -> Resource {
        Resource {
            id: id.into(),
            resource_type: resource_type.into(),
            name: name.into(),
            path: path.into(),
            file_size: 1,
            modified_at: String::new(),
            available: true,
            trigger_words: vec![],
            confirmed_trigger_words: vec![],
            preview_url: None,
            base_model: None,
            notes: String::new(),
            updated_at: String::new(),
        }
    }

    fn settings() -> AppSettings {
        AppSettings {
            lora_path: "C:\\ComfyUI\\models\\loras".into(),
            checkpoint_path: "C:\\ComfyUI\\models\\checkpoints".into(),
            diffusion_model_path: "C:\\ComfyUI\\models\\diffusion_models".into(),
            backup_path: String::new(),
            translation_provider: "off".into(),
            translation_endpoint: String::new(),
            translation_model: String::new(),
            online_translation_enabled: false,
            translation_target_language: "en".into(),
            privacy_mode: false,
            prompt_models: vec![],
            active_prompt_model: "general".into(),
            default_prefix: String::new(),
            default_negative: String::new(),
        }
    }

    #[test]
    fn builds_standard_checkpoint_workflow_with_lora_and_parameters() {
        let resources = vec![
            resource(
                "checkpoint-1",
                "checkpoint",
                "DreamShaper XL",
                "C:\\ComfyUI\\models\\checkpoints\\sdxl\\dreamshaperXL.safetensors",
            ),
            resource(
                "lora-1",
                "lora",
                "Film Still",
                "C:\\ComfyUI\\models\\loras\\styles\\film.safetensors",
            ),
        ];
        let (workflow, warnings) =
            build_comfyui_workflow(&recipe(), &resources, &settings()).unwrap();
        assert!(warnings.is_empty());
        assert_eq!(workflow["version"], 0.4);
        assert_eq!(workflow["nodes"].as_array().unwrap().len(), 8);
        assert_eq!(workflow["links"].as_array().unwrap().len(), 11);
        assert_eq!(
            workflow["nodes"][0]["widgets_values"][0],
            "sdxl/dreamshaperXL.safetensors"
        );
        assert_eq!(
            workflow["nodes"][1]["widgets_values"][0],
            "styles/film.safetensors"
        );
        assert_eq!(workflow["nodes"][5]["widgets_values"][0], 42);
        assert_eq!(workflow["nodes"][5]["widgets_values"][1], "fixed");
    }

    #[test]
    fn warns_when_a_saved_resource_is_offline() {
        let mut resources = vec![resource(
            "checkpoint-1",
            "checkpoint",
            "DreamShaper XL",
            "C:\\ComfyUI\\models\\checkpoints\\dreamshaperXL.safetensors",
        )];
        resources[0].available = false;
        let mut input = recipe();
        input.loras.clear();
        let (_, warnings) = build_comfyui_workflow(&input, &resources, &settings()).unwrap();
        assert!(warnings.iter().any(|warning| warning.contains("offline")));
    }

    #[test]
    fn rejects_diffusion_model_until_a_flux_template_exists() {
        let resources = vec![resource(
            "checkpoint-1",
            "diffusion_model",
            "FLUX.1 dev",
            "C:\\ComfyUI\\models\\diffusion_models\\flux1-dev.safetensors",
        )];
        let error = build_comfyui_workflow(&recipe(), &resources, &settings()).unwrap_err();
        assert!(error.contains("FLUX template"));
    }
}

use crate::{
    db::{get_app_settings, now, resolve_object_path, PromptVaultState, VaultPaths},
    models::{
        DownloadLoraCandidate, ImportDownloadLorasInput, ImportDownloadLorasResult,
        ImportedDownloadLora, ListDownloadLorasResult, Resource, SaveResourceInput, ScanResult,
    },
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::State;
use walkdir::WalkDir;

const MAX_SAFETENSORS_HEADER: u64 = 16 * 1024 * 1024;
const MAX_SIDECAR: u64 = 4 * 1024 * 1024;
/// Only surface files modified within this many days.
const DOWNLOAD_LORA_RECENT_DAYS: u64 = 14;
/// Default checkbox selection covers only the last N hours.
const DOWNLOAD_LORA_DEFAULT_SELECT_HOURS: u64 = 6;
/// Cap the candidate list so the import UI stays scannable.
const DOWNLOAD_LORA_MAX_CANDIDATES: usize = 25;
/// Reject multi-GB checkpoints / diffusion weights that are not LoRAs.
const DOWNLOAD_LORA_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Only walk Downloads root + one nested folder (browser save-as folders).
const DOWNLOAD_LORA_MAX_DEPTH: usize = 2;

fn default_downloads_path() -> Result<String, String> {
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    }
    .map(PathBuf::from)
    .ok_or_else(|| "Unable to locate the current user's home directory".to_string())?;
    Ok(home.join("Downloads").to_string_lossy().into_owned())
}

fn resource_from_row(row: &Row<'_>) -> rusqlite::Result<(Resource, Option<String>)> {
    let metadata_raw: String = row.get(7)?;
    let metadata: Value = serde_json::from_str(&metadata_raw).unwrap_or_default();
    let base_model = [
        "baseModel",
        "base_model",
        "ss_base_model_version",
        "modelspec.architecture",
    ]
    .iter()
    .find_map(|key| {
        metadata
            .get(*key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    });
    let scanned_preview: Option<String> = row.get(10)?;
    let scanned_words: Vec<String> =
        serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or_default();
    let confirmed_words: Vec<String> =
        serde_json::from_str(&row.get::<_, String>(9)?).unwrap_or_default();
    let (trigger_words, confirmed_trigger_words) =
        merge_trigger_words(scanned_words, confirmed_words);
    Ok((
        Resource {
            id: row.get(0)?,
            resource_type: row.get(1)?,
            name: row.get(2)?,
            path: row.get(3)?,
            file_size: row.get(4)?,
            modified_at: row.get(5)?,
            available: row.get::<_, i64>(6)? != 0,
            trigger_words,
            confirmed_trigger_words,
            preview_url: None,
            base_model,
            notes: row.get(11)?,
            updated_at: row.get(12)?,
        },
        scanned_preview,
    ))
}

const RESOURCE_SELECT: &str =
    "SELECT id,resource_type,name,path,file_size,modified_at,online,metadata_json,
            trigger_words_json,user_trigger_words_json,preview_path,notes,updated_at
     FROM resources";

pub fn list_resources_inner(
    conn: &Connection,
    resource_type: Option<&str>,
    paths: Option<&VaultPaths>,
) -> Result<Vec<Resource>, String> {
    let mut statement = conn
        .prepare(&format!(
            "{RESOURCE_SELECT} ORDER BY resource_type,name COLLATE NOCASE"
        ))
        .map_err(|e| format!("无法读取模型资源: {e}"))?;
    let rows = statement
        .query_map([], resource_from_row)
        .map_err(|e| format!("无法读取模型资源: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取模型资源: {e}"))?;
    let mut resources = Vec::with_capacity(rows.len());
    for (mut resource, scanned_preview) in rows {
        if let Some(paths) = paths {
            resource.preview_url =
                resource_asset_preview(conn, paths, &resource.id)?.or_else(|| {
                    safe_scanned_preview(paths, &resource.path, scanned_preview.as_deref())
                });
        }
        resources.push(resource);
    }
    if let Some(resource_type) = resource_type {
        resources.retain(|item| item.resource_type == resource_type);
    }
    Ok(resources)
}

fn resource_asset_preview(
    conn: &Connection,
    paths: &VaultPaths,
    resource_id: &str,
) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT a.sha256,a.extension,a.object_path,a.mime_type
             FROM entity_assets ea JOIN assets a ON a.id=ea.asset_id
             WHERE ea.entity_type='resource' AND ea.entity_id=?1 AND ea.role='preview'
             ORDER BY ea.sort_order,a.created_at DESC LIMIT 1",
        )
        .map_err(|e| format!("无法读取资源预览图: {e}"))?;
    let row = statement
        .query_row([resource_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .optional()
        .map_err(|e| format!("无法读取资源预览图: {e}"))?;
    let Some((sha256, extension, stored, mime_type)) = row else {
        return Ok(None);
    };
    let path = resolve_object_path(paths, &sha256, &extension, &stored)?;
    Ok(crate::storage::media_data_url(
        paths,
        &path,
        &sha256,
        &mime_type,
        crate::storage::AssetEmbed::Thumbnail,
    )
    .ok())
}

fn safe_scanned_preview(
    paths: &VaultPaths,
    resource_path: &str,
    preview_path: Option<&str>,
) -> Option<String> {
    let preview = PathBuf::from(preview_path?);
    if preview
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true)
    {
        return None;
    }
    let allowed = preview_candidates(Path::new(resource_path))
        .into_iter()
        .any(|candidate| same_file_name_path(&candidate, &preview));
    if !allowed {
        return None;
    }
    crate::storage::thumbnail_data_url_from_path(paths, &preview)
        .ok()
        .flatten()
}

fn same_file_name_path(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

#[tauri::command]
pub fn list_resources(
    state: State<'_, PromptVaultState>,
    resource_type: Option<String>,
) -> Result<Vec<Resource>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    list_resources_inner(&conn, resource_type.as_deref(), Some(&state.paths))
}

#[tauri::command]
pub fn save_resource(
    state: State<'_, PromptVaultState>,
    input: SaveResourceInput,
) -> Result<Resource, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let changed = conn
        .execute(
            "UPDATE resources
             SET user_trigger_words_json=?2,notes=?3,
                 preview_path=CASE
                   WHEN preview_path LIKE 'data:%' OR preview_path LIKE 'blob:%' THEN NULL
                   ELSE preview_path
                 END,
                 updated_at=?4
             WHERE id=?1",
            params![
                input.id,
                serde_json::to_string(&dedupe_words(input.confirmed_trigger_words))
                    .map_err(|e| format!("无法保存触发词: {e}"))?,
                input.notes,
                now()
            ],
        )
        .map_err(|e| format!("无法保存模型资源: {e}"))?;
    if changed == 0 {
        return Err("模型资源不存在，请先扫描目录".into());
    }
    let (mut resource, scanned_preview) = conn
        .query_row(
            &format!("{RESOURCE_SELECT} WHERE id=?1"),
            [&input.id],
            resource_from_row,
        )
        .map_err(|e| format!("保存后无法读取模型资源: {e}"))?;
    resource.preview_url = resource_asset_preview(&conn, &state.paths, &resource.id)?
        .or_else(|| safe_scanned_preview(&state.paths, &resource.path, scanned_preview.as_deref()));
    Ok(resource)
}

#[derive(Debug)]
struct ScannedResource {
    id: String,
    resource_type: String,
    name: String,
    path: String,
    file_size: i64,
    modified_at: String,
    metadata: Value,
    trigger_words: Vec<String>,
    preview_path: Option<String>,
}

#[tauri::command]
pub fn scan_resources(state: State<'_, PromptVaultState>) -> Result<ScanResult, String> {
    scan_resources_inner(&state)
}

pub fn scan_resources_inner(state: &PromptVaultState) -> Result<ScanResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        get_app_settings(&conn)?
    };
    let roots = [
        ("lora", settings.lora_path),
        ("checkpoint", settings.checkpoint_path),
        ("diffusion_model", settings.diffusion_model_path),
    ];
    let mut discovered = Vec::new();
    let mut offline_paths = Vec::new();
    let mut warnings = Vec::new();
    let mut online_roots = Vec::new();

    for (resource_type, raw_path) in roots {
        if raw_path.trim().is_empty() {
            continue;
        }
        let configured_root = PathBuf::from(&raw_path);
        if !configured_root.is_dir() {
            offline_paths.push(raw_path);
            continue;
        }
        let root = configured_root
            .canonicalize()
            .map_err(|e| format!("无法规范模型目录 {}: {e}", configured_root.display()))?;
        online_roots.push(root.clone());
        for entry in WalkDir::new(&root).follow_links(false) {
            let entry = match entry {
                Ok(value) => value,
                Err(error) => {
                    warnings.push(format!("跳过无法读取的路径: {error}"));
                    continue;
                }
            };
            if !entry.file_type().is_file() || !is_model_file(entry.path()) {
                continue;
            }
            match inspect_resource(resource_type, entry.path()) {
                Ok(item) => discovered.push(item),
                Err(error) => warnings.push(error),
            }
        }
    }

    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut existing_by_path: HashMap<String, (i64, String)> = HashMap::new();
    {
        let mut statement = conn
            .prepare("SELECT path,file_size,modified_at FROM resources")
            .map_err(|e| format!("无法读取资源缓存: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    (row.get::<_, i64>(1)?, row.get::<_, String>(2)?),
                ))
            })
            .map_err(|e| format!("无法读取资源缓存: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("无法读取资源缓存: {e}"))?;
        existing_by_path.extend(rows);
    }

    let mut added = 0;
    let mut updated = 0;
    let timestamp = now();
    let seen: HashSet<String> = discovered.iter().map(|v| v.path.clone()).collect();
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始资源扫描事务: {e}"))?;
    for item in &discovered {
        match existing_by_path.get(&item.path) {
            None => added += 1,
            Some((size, modified)) if *size != item.file_size || *modified != item.modified_at => {
                updated += 1
            }
            Some(_) => {}
        }
        tx.execute(
            "INSERT INTO resources(
               id,resource_type,name,path,file_size,modified_at,online,metadata_json,
               trigger_words_json,user_trigger_words_json,preview_path,notes,favorite,updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,1,?7,?8,'[]',?9,'',0,?10)
             ON CONFLICT(path) DO UPDATE SET
               resource_type=excluded.resource_type,name=excluded.name,
               file_size=excluded.file_size,modified_at=excluded.modified_at,online=1,
               metadata_json=excluded.metadata_json,trigger_words_json=excluded.trigger_words_json,
               preview_path=COALESCE(resources.preview_path,excluded.preview_path),
               updated_at=excluded.updated_at",
            params![
                item.id,
                item.resource_type,
                item.name,
                item.path,
                item.file_size,
                item.modified_at,
                item.metadata.to_string(),
                serde_json::to_string(&item.trigger_words)
                    .map_err(|e| format!("无法序列化触发词: {e}"))?,
                item.preview_path,
                timestamp
            ],
        )
        .map_err(|e| format!("无法缓存模型资源 {}: {e}", item.path))?;
    }

    // Only roots that were reachable participate in missing-file detection. An
    // unavailable drive never causes its cached rows to be deleted.
    let mut all_cached = tx
        .prepare("SELECT id,path FROM resources")
        .map_err(|e| format!("无法更新资源在线状态: {e}"))?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("无法更新资源在线状态: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法更新资源在线状态: {e}"))?;
    for (id, path) in all_cached.drain(..) {
        let path_buf = Path::new(&path);
        let under_online_root = online_roots
            .iter()
            .any(|root| path_starts_with(path_buf, root));
        let under_offline_root = offline_paths
            .iter()
            .any(|root| path_starts_with(path_buf, Path::new(root)));
        if (under_online_root && !seen.contains(&path)) || under_offline_root {
            tx.execute(
                "UPDATE resources SET online=0,updated_at=?2 WHERE id=?1",
                params![id, timestamp],
            )
            .map_err(|e| format!("无法更新离线资源: {e}"))?;
        }
    }
    tx.commit()
        .map_err(|e| format!("无法提交资源扫描结果: {e}"))?;
    // Avoid reading/encoding every preview while the scan transaction owns the
    // database mutex. A regular list_resources call enriches previews safely.
    let resources = list_resources_inner(&conn, None, None)?;
    Ok(ScanResult {
        scanned: discovered.len(),
        added,
        updated,
        offline_paths,
        warnings,
        resources,
    })
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    if cfg!(windows) {
        let path = path.to_string_lossy().replace('/', "\\").to_lowercase();
        let mut root = root.to_string_lossy().replace('/', "\\").to_lowercase();
        if !root.ends_with('\\') {
            root.push('\\');
        }
        path == root.trim_end_matches('\\') || path.starts_with(&root)
    } else {
        path.starts_with(root)
    }
}

fn is_model_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .map(|v| v.to_ascii_lowercase())
            .as_deref(),
        Some("safetensors" | "ckpt" | "pt" | "pth")
    )
}

fn inspect_resource(resource_type: &str, path: &Path) -> Result<ScannedResource, String> {
    let file_metadata = path
        .metadata()
        .map_err(|e| format!("无法读取 {} 的文件信息: {e}", path.display()))?;
    let modified_at = file_metadata
        .modified()
        .map(chrono::DateTime::<chrono::Utc>::from)
        .map(|v| v.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default();
    let mut metadata = if path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.eq_ignore_ascii_case("safetensors"))
        .unwrap_or(false)
    {
        read_safetensors_metadata(path).unwrap_or_else(|_| Value::Object(Map::new()))
    } else {
        Value::Object(Map::new())
    };
    for sidecar in sidecar_candidates(path) {
        if sidecar.is_file() {
            if let Ok(value) = read_bounded_json(&sidecar, MAX_SIDECAR) {
                merge_json(&mut metadata, value);
                break;
            }
        }
    }
    let trigger_words = extract_trigger_words(&metadata);
    let preview_path = preview_candidates(path)
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|v| v.to_string_lossy().into_owned());
    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .into_owned();
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_lowercase().as_bytes());
    let id = format!("res-{}", &format!("{:x}", hasher.finalize())[..32]);
    let name = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("未命名资源")
        .to_string();
    Ok(ScannedResource {
        id,
        resource_type: resource_type.into(),
        name,
        path: canonical,
        file_size: i64::try_from(file_metadata.len()).unwrap_or(i64::MAX),
        modified_at,
        metadata,
        trigger_words,
        preview_path,
    })
}

fn read_safetensors_metadata(path: &Path) -> Result<Value, String> {
    let mut file =
        File::open(path).map_err(|e| format!("无法打开 safetensors {}: {e}", path.display()))?;
    let mut length_bytes = [0u8; 8];
    file.read_exact(&mut length_bytes)
        .map_err(|e| format!("无法读取 safetensors 头: {e}"))?;
    let header_length = u64::from_le_bytes(length_bytes);
    let file_length = file
        .metadata()
        .map_err(|e| format!("无法读取 safetensors 大小: {e}"))?
        .len();
    if header_length == 0
        || header_length > MAX_SAFETENSORS_HEADER
        || header_length.saturating_add(8) > file_length
    {
        return Err(format!(
            "跳过异常 safetensors 头（{} 字节）: {}",
            header_length,
            path.display()
        ));
    }
    let mut bytes = vec![0u8; header_length as usize];
    file.seek(SeekFrom::Start(8))
        .and_then(|_| file.read_exact(&mut bytes))
        .map_err(|e| format!("无法读取 safetensors 元数据: {e}"))?;
    let header: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("safetensors 头不是有效 JSON: {e}"))?;
    Ok(header
        .get("__metadata__")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new())))
}

fn read_bounded_json(path: &Path, maximum: u64) -> Result<Value, String> {
    let size = path
        .metadata()
        .map_err(|e| format!("无法读取 sidecar 信息: {e}"))?
        .len();
    if size > maximum {
        return Err(format!(
            "sidecar 超过 {} MiB: {}",
            maximum / 1024 / 1024,
            path.display()
        ));
    }
    let mut file =
        File::open(path).map_err(|e| format!("无法打开 sidecar {}: {e}", path.display()))?;
    let mut bytes = Vec::with_capacity(size as usize);
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取 sidecar: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("sidecar JSON 无效: {e}"))
}

fn sidecar_candidates(path: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![path.with_extension("json")];
    let file_name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    if let Some(parent) = path.parent() {
        candidates.push(parent.join(format!("{file_name}.json")));
        candidates.push(parent.join(format!("{file_name}.rgthree-info.json")));
        candidates.push(parent.join(format!("{stem}.rgthree-info.json")));
        candidates.push(parent.join(format!("{stem}.civitai.info")));
    }
    candidates
}

fn preview_candidates(path: &Path) -> Vec<PathBuf> {
    let stem = path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or_default();
    let mut candidates = Vec::new();
    if let Some(parent) = path.parent() {
        for suffix in [
            ".preview.png",
            ".preview.jpg",
            ".preview.webp",
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
        ] {
            candidates.push(parent.join(format!("{stem}{suffix}")));
        }
    }
    candidates
}

fn merge_json(target: &mut Value, incoming: Value) {
    match (target, incoming) {
        (Value::Object(target), Value::Object(incoming)) => {
            for (key, value) in incoming {
                match target.get_mut(&key) {
                    Some(existing) => merge_json(existing, value),
                    None => {
                        target.insert(key, value);
                    }
                }
            }
        }
        (target, incoming) => *target = incoming,
    }
}

fn extract_trigger_words(metadata: &Value) -> Vec<String> {
    let mut candidates: Vec<(String, f64)> = Vec::new();
    collect_trigger_values(metadata, "", &mut candidates);
    // Stable sort keeps the sidecar author's original spelling/order when two
    // candidates have the same weight.
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1));
    dedupe_words(candidates.into_iter().map(|v| v.0).take(100).collect())
}

fn collect_trigger_values(value: &Value, key: &str, out: &mut Vec<(String, f64)>) {
    let normalized = key.to_ascii_lowercase();
    let is_words = matches!(
        normalized.as_str(),
        "trainedwords" | "trained_words" | "trigger_words" | "triggerwords"
    );
    let is_frequency = normalized == "ss_tag_frequency" || normalized == "tag_frequency";
    if is_words {
        match value {
            Value::Array(values) => {
                for item in values {
                    if let Some(word) = item.as_str() {
                        out.push((word.to_string(), 1.0));
                    } else if let Some(object) = item.as_object() {
                        if let Some(word) = object
                            .get("word")
                            .or_else(|| object.get("name"))
                            .and_then(Value::as_str)
                        {
                            let explicit_weight = object
                                .get("count")
                                .or_else(|| object.get("frequency"))
                                .or_else(|| object.get("weight"))
                                .and_then(Value::as_f64);
                            let provenance_bonus = if object
                                .get("civitai")
                                .and_then(Value::as_bool)
                                .unwrap_or(false)
                            {
                                2.0
                            } else if object.get("metadata").is_some() {
                                1.0
                            } else {
                                0.0
                            };
                            out.push((
                                word.to_string(),
                                explicit_weight.unwrap_or(1.0) + provenance_bonus,
                            ));
                        }
                    }
                }
            }
            Value::String(text) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                    collect_trigger_values(&parsed, "trainedWords", out);
                } else {
                    out.extend(
                        text.split(',')
                            .map(str::trim)
                            .filter(|v| !v.is_empty())
                            .map(|v| (v.to_string(), 1.0)),
                    );
                }
            }
            _ => {}
        }
        return;
    }
    if is_frequency {
        collect_frequency_map(value, out);
        return;
    }
    match value {
        Value::Object(map) => {
            for (child_key, child) in map {
                collect_trigger_values(child, child_key, out);
            }
        }
        Value::String(text) if normalized == "ss_tag_frequency" || normalized == "trainedwords" => {
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                collect_trigger_values(&parsed, key, out);
            }
        }
        _ => {}
    }
}

fn collect_frequency_map(value: &Value, out: &mut Vec<(String, f64)>) {
    match value {
        Value::String(text) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                collect_frequency_map(&parsed, out);
            }
        }
        Value::Object(map) => {
            for (key, value) in map {
                if let Some(number) = value.as_f64() {
                    out.push((key.clone(), number));
                } else {
                    collect_frequency_map(value, out);
                }
            }
        }
        _ => {}
    }
}

fn dedupe_words(words: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    words
        .into_iter()
        .map(|word| word.trim().to_string())
        .filter(|word| !word.is_empty() && seen.insert(word.to_lowercase()))
        .collect()
}

fn merge_trigger_words(
    scanned_words: Vec<String>,
    confirmed_words: Vec<String>,
) -> (Vec<String>, Vec<String>) {
    let confirmed = dedupe_words(confirmed_words);
    let visible = dedupe_words(confirmed.iter().cloned().chain(scanned_words).collect());
    (visible, confirmed)
}

#[tauri::command]
pub fn list_download_loras(
    state: State<'_, PromptVaultState>,
) -> Result<ListDownloadLorasResult, String> {
    let downloads_path = default_downloads_path()?;
    list_download_loras_inner(&state, &downloads_path)
}

pub fn list_download_loras_inner(
    state: &PromptVaultState,
    downloads_path: &str,
) -> Result<ListDownloadLorasResult, String> {
    let settings = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        get_app_settings(&conn)?
    };
    let downloads_path = downloads_path.to_string();
    let lora_path = settings.lora_path;
    if lora_path.trim().is_empty() {
        return Err("尚未配置 LoRA 目录，请先在设置中填写".into());
    }
    let downloads_root = PathBuf::from(&downloads_path);
    if !downloads_root.is_dir() {
        return Err(format!(
            "无法访问下载目录：{}（请确认路径存在且磁盘已挂载）",
            downloads_path
        ));
    }
    let lora_root = PathBuf::from(&lora_path);
    if !lora_root.is_dir() {
        return Err(format!(
            "无法访问 LoRA 目录：{}（请确认路径存在且磁盘已挂载）",
            lora_path
        ));
    }

    let now = SystemTime::now();
    let cutoff = now
        .checked_sub(Duration::from_secs(
            DOWNLOAD_LORA_RECENT_DAYS * 24 * 60 * 60,
        ))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let default_select_cutoff = now
        .checked_sub(Duration::from_secs(
            DOWNLOAD_LORA_DEFAULT_SELECT_HOURS * 60 * 60,
        ))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut candidates = Vec::new();
    for entry in WalkDir::new(&downloads_root)
        .follow_links(false)
        .max_depth(DOWNLOAD_LORA_MAX_DEPTH)
        .into_iter()
        .filter_map(|item| item.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if !is_likely_download_lora(path) {
            continue;
        }
        let metadata = match path.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.len() == 0 || metadata.len() > DOWNLOAD_LORA_MAX_BYTES {
            continue;
        }
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if modified < cutoff {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_string();
        if file_name.is_empty() {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or(&file_name)
            .to_string();
        let destination = lora_root.join(&file_name);
        let companion_files = companion_files_for(path)
            .into_iter()
            .filter_map(|companion| {
                companion
                    .file_name()
                    .and_then(|v| v.to_str())
                    .map(ToOwned::to_owned)
            })
            .collect();
        candidates.push((
            modified,
            DownloadLoraCandidate {
                name,
                file_name,
                source_path: path.to_string_lossy().into_owned(),
                destination_path: destination.to_string_lossy().into_owned(),
                file_size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
                modified_at: chrono::DateTime::<chrono::Utc>::from(modified)
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                already_exists: destination.is_file(),
                within_default_window: modified >= default_select_cutoff,
                companion_files,
            },
        ));
    }

    candidates.sort_by_key(|item| std::cmp::Reverse(item.0));
    candidates.truncate(DOWNLOAD_LORA_MAX_CANDIDATES);

    Ok(ListDownloadLorasResult {
        downloads_path,
        lora_path,
        candidates: candidates.into_iter().map(|(_, item)| item).collect(),
        recent_days: DOWNLOAD_LORA_RECENT_DAYS as u32,
        default_select_hours: DOWNLOAD_LORA_DEFAULT_SELECT_HOURS as u32,
    })
}

#[tauri::command]
pub fn import_download_loras(
    state: State<'_, PromptVaultState>,
    input: ImportDownloadLorasInput,
) -> Result<ImportDownloadLorasResult, String> {
    let downloads_path = default_downloads_path()?;
    import_download_loras_inner(&state, input, &downloads_path)
}

pub fn import_download_loras_inner(
    state: &PromptVaultState,
    input: ImportDownloadLorasInput,
    downloads_path: &str,
) -> Result<ImportDownloadLorasResult, String> {
    if input.source_paths.is_empty() {
        return Err("请至少选择一个要导入的 LoRA".into());
    }

    let settings = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        get_app_settings(&conn)?
    };
    let downloads_root = PathBuf::from(downloads_path);
    let lora_root = PathBuf::from(&settings.lora_path);
    if !downloads_root.is_dir() {
        return Err(format!("无法访问下载目录：{}", downloads_root.display()));
    }
    if settings.lora_path.trim().is_empty() || !lora_root.is_dir() {
        return Err(format!("无法访问 LoRA 目录：{}", settings.lora_path));
    }

    let downloads_canonical = downloads_root
        .canonicalize()
        .map_err(|e| format!("无法规范下载目录: {e}"))?;
    let lora_canonical = lora_root
        .canonicalize()
        .map_err(|e| format!("无法规范 LoRA 目录: {e}"))?;

    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for raw_source in &input.source_paths {
        let source = PathBuf::from(raw_source);
        let Ok(source_canonical) = source.canonicalize() else {
            failed.push(format!("找不到文件：{raw_source}"));
            continue;
        };
        if !path_starts_with(&source_canonical, &downloads_canonical) {
            failed.push(format!(
                "拒绝导入（不在下载目录内）：{}",
                source_canonical.display()
            ));
            continue;
        }
        if !source_canonical.is_file() || !is_likely_download_lora(&source_canonical) {
            failed.push(format!(
                "不是可识别的 LoRA 权重文件：{}",
                source_canonical.display()
            ));
            continue;
        }
        let file_name = match source_canonical.file_name().and_then(|v| v.to_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => {
                failed.push(format!("文件名无效：{}", source_canonical.display()));
                continue;
            }
        };
        let name = source_canonical
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or(&file_name)
            .to_string();
        let destination = lora_canonical.join(&file_name);
        if destination.is_file() && !input.overwrite {
            skipped.push(format!("已跳过（目标已存在）：{name}（{file_name}）"));
            continue;
        }

        // Collect companions before moving the weight so paths stay resolvable.
        let companions = companion_files_for(&source_canonical);
        match move_file(&source_canonical, &destination) {
            Ok(()) => {
                for companion in companions {
                    if let Some(companion_name) = companion.file_name().and_then(|v| v.to_str()) {
                        let companion_dest = lora_canonical.join(companion_name);
                        if companion_dest.is_file() && !input.overwrite {
                            // Still remove the download-side leftover when possible.
                            let _ = fs::remove_file(&companion);
                            continue;
                        }
                        if let Err(error) = move_file(&companion, &companion_dest) {
                            failed.push(format!("权重「{name}」已移动，但附属文件失败：{error}"));
                        }
                    }
                }
                imported.push(ImportedDownloadLora {
                    name: name.clone(),
                    file_name,
                    source_path: source_canonical.to_string_lossy().into_owned(),
                    destination_path: destination.to_string_lossy().into_owned(),
                });
            }
            Err(error) => failed.push(format!("导入失败「{name}」：{error}")),
        }
    }

    let scan = scan_resources_inner(state)?;
    Ok(ImportDownloadLorasResult {
        imported,
        skipped,
        failed,
        scan,
    })
}

fn is_likely_download_lora(path: &Path) -> bool {
    let file_name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if file_name.is_empty() {
        return false;
    }
    // Skip browser / download-manager temporary files.
    for marker in [
        ".crdownload",
        ".part",
        ".tmp",
        ".download",
        ".aria2",
        ".!ut",
    ] {
        if file_name.ends_with(marker) {
            return false;
        }
    }
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .map(|v| v.to_ascii_lowercase())
            .as_deref(),
        Some("safetensors" | "pt" | "pth")
        // .ckpt is often a full checkpoint; keep only smaller ones via size filter.
        | Some("ckpt")
    )
}

fn companion_files_for(model_path: &Path) -> Vec<PathBuf> {
    let mut companions = Vec::new();
    for candidate in preview_candidates(model_path)
        .into_iter()
        .chain(sidecar_candidates(model_path))
    {
        if candidate.is_file() {
            companions.push(candidate);
        }
    }
    companions
}

/// Move a file into the LoRA folder. Prefers rename (same volume); falls back to
/// copy + delete when crossing devices so Downloads is always cleaned up.
fn move_file(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建目标目录: {e}"))?;
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|e| format!("无法覆盖目标文件: {e}"))?;
    }
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            // Cross-device move: copy then remove source so Downloads is cleaned.
            fs::copy(source, destination)
                .map_err(|e| format!("移动失败（改名: {rename_error}；复制: {e}）"))?;
            fs::remove_file(source).map_err(|e| {
                format!("已写入目标，但无法删除下载源文件 {}: {e}", source.display())
            })?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{set_setting, PromptVaultState, VaultPaths};

    #[test]
    fn download_lora_filter_rejects_temp_and_keeps_weights() {
        assert!(is_likely_download_lora(Path::new(
            r"C:\Users\Example\Downloads\portrait-style-v2.safetensors"
        )));
        assert!(is_likely_download_lora(Path::new(
            r"C:\Users\Example\Downloads\style.pt"
        )));
        assert!(!is_likely_download_lora(Path::new(
            r"C:\Users\Example\Downloads\model.safetensors.crdownload"
        )));
        assert!(!is_likely_download_lora(Path::new(
            r"C:\Users\Example\Downloads\notes.txt"
        )));
    }

    #[test]
    fn list_and_import_download_loras_roundtrip() {
        let root = std::env::temp_dir().join(format!("pv-import-lora-{}", uuid::Uuid::new_v4()));
        let downloads = root.join("Downloads");
        let loras = root.join("loras");
        let vault = root.join("vault");
        fs::create_dir_all(&downloads).unwrap();
        fs::create_dir_all(&loras).unwrap();

        let source = downloads.join("demo_style.safetensors");
        let preview = downloads.join("demo_style.preview.png");
        let old = downloads.join("ancient.safetensors");
        fs::write(&source, b"lora-bytes").unwrap();
        fs::write(&preview, b"png-bytes").unwrap();
        fs::write(&old, b"old-lora").unwrap();
        let ancient = SystemTime::now() - Duration::from_secs(40 * 24 * 60 * 60);
        let _ = filetime_set_modified(&old, ancient);

        let paths = VaultPaths::temporary(vault).unwrap();
        let state = PromptVaultState::initialize_at(paths).unwrap();
        {
            let conn = state.db.lock().unwrap();
            set_setting(
                &conn,
                "loraDirectory",
                Value::String(loras.to_string_lossy().into_owned()),
            )
            .unwrap();
        }

        let listed = list_download_loras_inner(&state, &downloads.to_string_lossy()).unwrap();
        assert_eq!(listed.candidates.len(), 1);
        assert_eq!(listed.candidates[0].name, "demo_style");
        assert!(!listed.candidates[0].already_exists);

        let result = import_download_loras_inner(
            &state,
            ImportDownloadLorasInput {
                source_paths: vec![source.to_string_lossy().into_owned()],
                overwrite: false,
            },
            &downloads.to_string_lossy(),
        )
        .unwrap();
        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].name, "demo_style");
        assert_eq!(
            fs::read(loras.join("demo_style.safetensors")).unwrap(),
            b"lora-bytes"
        );
        assert_eq!(
            fs::read(loras.join("demo_style.preview.png")).unwrap(),
            b"png-bytes"
        );
        assert!(
            !source.exists(),
            "import must move (delete) the Downloads source weight"
        );
        assert!(
            !preview.exists(),
            "import must move companion files out of Downloads"
        );
        assert!(listed.candidates[0].within_default_window);
        assert_eq!(listed.default_select_hours, 6);
        assert!(result
            .scan
            .resources
            .iter()
            .any(|item| item.name == "demo_style" && item.resource_type == "lora"));
        let _ = fs::remove_dir_all(root);
    }

    fn filetime_set_modified(path: &Path, modified: SystemTime) -> std::io::Result<()> {
        // Windows-friendly: open and set last write time via filetime-less API.
        let file = fs::File::options().write(true).open(path)?;
        file.set_modified(modified)
    }

    #[test]
    fn extracts_and_deduplicates_trigger_words() {
        let value = serde_json::json!({
            "trainedWords": [
                "v-sign",
                "V-SIGN",
                "portrait",
                {"word": "Yumeko Jabami", "civitai": true},
                {"word": "academy uniform", "count": 20}
            ],
            "ss_tag_frequency": "{\"set\":{\"cinematic lighting\":12,\"portrait\":4}}"
        });
        let result = extract_trigger_words(&value);
        assert!(result.contains(&"v-sign".to_string()));
        assert!(result.contains(&"portrait".to_string()));
        assert!(result.contains(&"cinematic lighting".to_string()));
        assert!(result.contains(&"Yumeko Jabami".to_string()));
        assert!(result.contains(&"academy uniform".to_string()));
        assert!(
            result.iter().position(|word| word == "academy uniform")
                < result.iter().position(|word| word == "Yumeko Jabami")
        );
        assert_eq!(
            result
                .iter()
                .filter(|word| word.eq_ignore_ascii_case("v-sign"))
                .count(),
            1
        );
    }

    #[test]
    fn rejects_unbounded_safetensors_header() {
        let temp = std::env::temp_dir().join(format!("pv-{}.safetensors", uuid::Uuid::new_v4()));
        std::fs::write(&temp, (MAX_SAFETENSORS_HEADER + 1).to_le_bytes()).unwrap();
        let result = read_safetensors_metadata(&temp);
        let _ = std::fs::remove_file(temp);
        assert!(result.is_err());
    }

    #[test]
    fn scanned_preview_reader_only_accepts_expected_adjacent_image() {
        let root = std::env::temp_dir().join(format!("pv-preview-{}", uuid::Uuid::new_v4()));
        let vault = VaultPaths::temporary(root.join("vault")).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        let model = root.join("portrait.safetensors");
        let preview = root.join("portrait.preview.png");
        let unrelated = root.join("unrelated.png");
        std::fs::write(&model, b"model").unwrap();
        let mut img = image::RgbImage::new(32, 32);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgb([20, 120, 200]);
        }
        img.save(&preview).unwrap();
        img.save(&unrelated).unwrap();
        assert!(safe_scanned_preview(
            &vault,
            &model.to_string_lossy(),
            Some(&preview.to_string_lossy())
        )
        .is_some());
        assert!(safe_scanned_preview(
            &vault,
            &model.to_string_lossy(),
            Some(&unrelated.to_string_lossy())
        )
        .is_none());
        assert!(safe_scanned_preview(
            &vault,
            &model.to_string_lossy(),
            Some("data:image/png;base64,AAAA")
        )
        .is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn confirmed_trigger_words_are_visible_first_and_case_deduplicated() {
        let (visible, confirmed) = merge_trigger_words(
            vec!["portrait".into(), "V-SIGN".into(), "cinematic".into()],
            vec!["v-sign".into(), "My Manual Word".into(), "V-Sign".into()],
        );
        assert_eq!(confirmed, vec!["v-sign", "My Manual Word"]);
        assert_eq!(
            visible,
            vec!["v-sign", "My Manual Word", "portrait", "cinematic"]
        );
    }

    /// Read-only smoke test for a real ComfyUI model library.
    ///
    /// The three directories must be supplied explicitly so this never scans a
    /// developer machine by accident:
    ///
    /// - `PROMPTNOOK_SMOKE_LORA_DIR`
    /// - `PROMPTNOOK_SMOKE_CHECKPOINT_DIR`
    /// - `PROMPTNOOK_SMOKE_DIFFUSION_DIR`
    ///
    /// Only model files and bounded metadata/adjacent preview sidecars are
    /// read. All cache writes go to a fresh temporary PromptNook database.
    #[test]
    #[ignore = "requires explicit local ComfyUI model directory environment variables"]
    fn real_resource_scan_smoke() {
        let lora_directory = std::env::var("PROMPTNOOK_SMOKE_LORA_DIR")
            .expect("PROMPTNOOK_SMOKE_LORA_DIR is required");
        let checkpoint_directory = std::env::var("PROMPTNOOK_SMOKE_CHECKPOINT_DIR")
            .expect("PROMPTNOOK_SMOKE_CHECKPOINT_DIR is required");
        let diffusion_directory = std::env::var("PROMPTNOOK_SMOKE_DIFFUSION_DIR")
            .expect("PROMPTNOOK_SMOKE_DIFFUSION_DIR is required");
        let temporary_root =
            std::env::temp_dir().join(format!("pv-real-scan-{}", uuid::Uuid::new_v4()));
        let paths = VaultPaths::temporary(temporary_root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        {
            let conn = state.db.lock().unwrap();
            set_setting(
                &conn,
                "loraDirectory",
                Value::String(lora_directory.clone()),
            )
            .unwrap();
            set_setting(
                &conn,
                "checkpointDirectory",
                Value::String(checkpoint_directory.clone()),
            )
            .unwrap();
            set_setting(
                &conn,
                "diffusionModelDirectory",
                Value::String(diffusion_directory.clone()),
            )
            .unwrap();
        }

        let scan = scan_resources_inner(&state).unwrap();
        let counts =
            scan.resources
                .iter()
                .fold(HashMap::<String, usize>::new(), |mut counts, resource| {
                    *counts.entry(resource.resource_type.clone()).or_default() += 1;
                    counts
                });
        eprintln!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "counts": counts,
                "scanned": scan.scanned,
                "added": scan.added,
                "updated": scan.updated,
                "offlinePaths": scan.offline_paths,
                "warnings": scan.warnings,
            }))
            .unwrap()
        );
        assert!(
            scan.offline_paths.is_empty(),
            "the explicitly supplied real model roots must be online"
        );
        assert!(counts.get("lora").copied().unwrap_or(0) > 0);
        assert!(
            counts.get("checkpoint").copied().unwrap_or(0)
                + counts.get("diffusion_model").copied().unwrap_or(0)
                > 0
        );

        // Simulate a configured model drive becoming unavailable without
        // renaming or touching the real directory. Its cached row must remain
        // present and merely become unavailable.
        let missing_root = temporary_root.join("deliberately-offline-loras");
        let cached_path = missing_root.join("cached-lora.safetensors");
        {
            let conn = state.db.lock().unwrap();
            set_setting(
                &conn,
                "loraDirectory",
                Value::String(missing_root.to_string_lossy().into_owned()),
            )
            .unwrap();
            set_setting(&conn, "checkpointDirectory", Value::String(String::new())).unwrap();
            set_setting(
                &conn,
                "diffusionModelDirectory",
                Value::String(String::new()),
            )
            .unwrap();
            conn.execute(
                "INSERT INTO resources(
                   id,resource_type,name,path,file_size,modified_at,online,updated_at
                 ) VALUES ('offline-cache-smoke','lora','cached offline LoRA',?1,1,'',1,?2)",
                params![cached_path.to_string_lossy(), now()],
            )
            .unwrap();
        }
        let offline_scan = scan_resources_inner(&state).unwrap();
        assert!(offline_scan
            .offline_paths
            .iter()
            .any(|path| path_starts_with(Path::new(path), &missing_root)));
        let (row_count, available): (i64, i64) = state
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT COUNT(*),MAX(online) FROM resources WHERE id='offline-cache-smoke'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            row_count, 1,
            "offline scan must not delete cached resources"
        );
        assert_eq!(
            available, 0,
            "offline cached resources must be marked unavailable"
        );

        drop(state);
        let _ = std::fs::remove_dir_all(temporary_root);
    }
}

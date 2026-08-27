use crate::{
    backup::create_backup_inner,
    db::{get_app_settings, PromptVaultState},
    models::ListOptions,
    repository::{list_recipes_inner, list_snippets_inner},
    resources::list_resources_inner,
};
use rusqlite::Connection;
use serde_json::json;
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::State;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[tauri::command]
pub fn export_data(
    state: State<'_, PromptVaultState>,
    format: String,
    target_path: Option<String>,
) -> Result<String, String> {
    let format = format.to_ascii_lowercase();
    if !["json", "csv", "promptnook", "promptvault"].contains(&format.as_str()) {
        return Err("Export format must be json, csv, or promptnook".into());
    }
    let package_export = matches!(format.as_str(), "promptnook" | "promptvault");
    if package_export
        && state
            .recovery
            .lock()
            .map_err(|_| "恢复状态锁已损坏".to_string())?
            .is_some()
    {
        return Err("当前处于恢复模式，不能把临时空库导出为迁移包".into());
    }
    let extension = if package_export {
        "promptnook"
    } else {
        format.as_str()
    };
    let default_name = format!(
        "PromptNook-{}.{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        extension
    );
    let target = target_path
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.paths.exports.join(default_name));
    if target.is_dir() {
        return Err("导出目标必须是文件路径，不能是目录".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建导出目录 {}: {e}", parent.display()))?;
    }
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    match format.as_str() {
        "json" => export_json(&conn, &target)?,
        "csv" => export_csv(&conn, &target)?,
        "promptnook" | "promptvault" => export_promptvault(&conn, &state.paths, &target)?,
        _ => unreachable!(),
    }
    Ok(target.to_string_lossy().into_owned())
}

fn export_json(conn: &Connection, target: &Path) -> Result<(), String> {
    let all = ListOptions {
        limit: Some(0),
        ..Default::default()
    };
    let mut recipes = list_recipes_inner(conn, &all, None)?;
    for recipe in &mut recipes {
        for asset in &mut recipe.assets {
            asset.url.clear();
        }
    }
    let snippets = list_snippets_inner(conn, &all)?;
    let resources = list_resources_inner(conn, None, None)?;
    let categories = query_json_rows(
        conn,
        "SELECT json_object(
           'id',id,'name',name,'color',color,'parentId',parent_id,'sortOrder',sort_order
         ) FROM categories WHERE deleted_at IS NULL ORDER BY sort_order",
    )?;
    let tips = query_json_rows(
        conn,
        "SELECT json_object(
           'id',id,'title',title,'content',content,'scope',scope_type,
           'targetId',scope_id,'favorite',favorite,'createdAt',created_at,'updatedAt',updated_at
         ) FROM tips WHERE deleted_at IS NULL ORDER BY updated_at DESC",
    )?;
    let payload = json!({
        "format": "PromptNookHumanExport/v1",
        "exportedAt": crate::db::now(),
        "recipes": recipes,
        "snippets": snippets,
        "categories": categories,
        "resources": resources,
        "tips": tips,
        "settings": get_app_settings(conn)?,
    });
    let bytes =
        serde_json::to_vec_pretty(&payload).map_err(|e| format!("无法生成 JSON 导出: {e}"))?;
    write_atomic(target, &bytes)
}

fn export_csv(conn: &Connection, target: &Path) -> Result<(), String> {
    let mut buffer = Vec::new();
    {
        let mut writer = csv::WriterBuilder::new()
            .has_headers(true)
            .from_writer(&mut buffer);
        writer
            .write_record([
                "entityType",
                "id",
                "titleOrEnglish",
                "positivePrompt",
                "translation",
                "negativePrompt",
                "categories",
                "notes",
                "updatedAt",
            ])
            .map_err(|e| format!("无法写入 CSV 表头: {e}"))?;
        let all = ListOptions {
            limit: Some(0),
            ..Default::default()
        };
        for recipe in list_recipes_inner(conn, &all, None)? {
            writer
                .write_record([
                    "recipe",
                    &recipe.id,
                    &recipe.title,
                    &recipe.positive_prompt,
                    &recipe.positive_translation,
                    &recipe.negative_prompt,
                    "",
                    &recipe.notes,
                    &recipe.updated_at,
                ])
                .map_err(|e| format!("无法写入总 Prompt CSV: {e}"))?;
        }
        for snippet in list_snippets_inner(conn, &all)? {
            writer
                .write_record([
                    "snippet",
                    &snippet.id,
                    &snippet.text,
                    &snippet.text,
                    &snippet.translation,
                    "",
                    &snippet.category_ids.join("|"),
                    &snippet.notes,
                    &snippet.updated_at,
                ])
                .map_err(|e| format!("无法写入单 Prompt CSV: {e}"))?;
        }
        writer
            .flush()
            .map_err(|e| format!("无法完成 CSV 导出: {e}"))?;
    }
    write_atomic(target, &buffer)
}

fn export_promptvault(
    conn: &Connection,
    paths: &crate::db::VaultPaths,
    target: &Path,
) -> Result<(), String> {
    let backup = create_backup_inner(conn, paths, "")?;
    let snapshot = PathBuf::from(&backup.location);
    let temporary = target.with_extension(format!(
        "{}.{}.tmp",
        target
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("promptvault"),
        Uuid::new_v4()
    ));
    let result = (|| {
        let file = File::create(&temporary).map_err(|e| format!("无法创建迁移包临时文件: {e}"))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o600);
        for name in ["manifest.json", "prompt-vault.sqlite3"] {
            let mut source = File::open(snapshot.join(name))
                .map_err(|e| format!("无法读取备份快照 {name}: {e}"))?;
            zip.start_file(name, options)
                .map_err(|e| format!("无法写入迁移包: {e}"))?;
            std::io::copy(&mut source, &mut zip).map_err(|e| format!("无法压缩备份数据库: {e}"))?;
        }
        let mut statement = conn
            .prepare("SELECT sha256,extension,object_path FROM assets ORDER BY sha256")
            .map_err(|e| format!("无法读取迁移媒体清单: {e}"))?;
        let objects = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("无法读取迁移媒体清单: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("无法读取迁移媒体清单: {e}"))?;
        for (sha, extension, object_path) in objects {
            let archive_path = format!("objects/{}/{}.{}", &sha[..2], &sha[2..], extension);
            zip.start_file(archive_path, options)
                .map_err(|e| format!("无法写入迁移媒体: {e}"))?;
            let resolved = crate::db::resolve_object_path(paths, &sha, &extension, &object_path)?;
            let mut source =
                File::open(resolved).map_err(|e| format!("无法读取迁移媒体对象: {e}"))?;
            std::io::copy(&mut source, &mut zip)
                .map_err(|e| format!("无法压缩迁移媒体对象: {e}"))?;
        }
        let mut file = zip.finish().map_err(|e| format!("无法完成迁移包: {e}"))?;
        file.flush()
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("无法可靠写入迁移包: {e}"))?;
        replace_atomic(&temporary, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn query_json_rows(conn: &Connection, sql: &str) -> Result<Vec<serde_json::Value>, String> {
    let mut statement = conn
        .prepare(sql)
        .map_err(|e| format!("无法读取导出数据: {e}"))?;
    let result = statement
        .query_map([], |row| {
            let raw: String = row.get(0)?;
            Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
        })
        .map_err(|e| format!("无法读取导出数据: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取导出数据: {e}"));
    result
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = target.with_extension(format!(
        "{}.{}.tmp",
        target
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("export"),
        Uuid::new_v4()
    ));
    let result = (|| {
        let mut file =
            File::create(&temporary).map_err(|e| format!("无法创建导出临时文件: {e}"))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("无法可靠写入导出文件: {e}"))?;
        replace_atomic(&temporary, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn replace_atomic(temporary: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        if !target.is_file() {
            return Err("导出目标已存在且不是普通文件".into());
        }
        fs::remove_file(target).map_err(|e| format!("无法替换已有导出文件: {e}"))?;
    }
    fs::rename(temporary, target).map_err(|e| format!("无法提交导出文件: {e}"))
}

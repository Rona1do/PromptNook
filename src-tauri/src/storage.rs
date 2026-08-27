use crate::{
    db::{now, resolve_object_path, PromptVaultState, VaultPaths},
    models::{Asset, AssetData, ImportAssetInput},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::ImageReader;
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{BufWriter, Cursor, Write},
    path::{Path, PathBuf},
};
use tauri::State;
use uuid::Uuid;

const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;
/// Longest edge for list/card previews. Full images stay on disk until requested.
/// Large desktop cards; aspect ratio is preserved (no crop) — CSS uses contain.
const THUMBNAIL_MAX_EDGE: u32 = 1024;
const THUMBNAIL_JPEG_QUALITY: u8 = 78;

/// How much pixel data to embed when hydrating `Asset.url`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetEmbed {
    /// Metadata only (revisions, internal snapshots).
    None,
    /// Small JPEG thumbnail for lists and editors.
    Thumbnail,
    /// Original object bytes (prefer `get_asset_data` for explicit full loads).
    #[allow(dead_code)]
    Full,
}

#[tauri::command]
pub fn import_asset(
    state: State<'_, PromptVaultState>,
    input: ImportAssetInput,
) -> Result<Asset, String> {
    if input.data_base64.len() > MAX_ASSET_BYTES * 2 {
        return Err("图片数据过大，单张图片上限为 50 MiB".into());
    }
    let bytes = STANDARD
        .decode(input.data_base64.trim())
        .map_err(|e| format!("图片 Base64 数据无效: {e}"))?;
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES {
        return Err("图片为空或超过 50 MiB 上限".into());
    }
    let (detected_mime, extension) =
        detect_image(&bytes).ok_or_else(|| "仅支持 PNG、JPEG、WebP、GIF 图片".to_string())?;
    if !input.mime_type.is_empty()
        && input.mime_type != "application/octet-stream"
        && input.mime_type != detected_mime
    {
        return Err(format!(
            "图片内容是 {detected_mime}，与声明的 {} 不一致",
            input.mime_type
        ));
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let object_dir = state.paths.objects.join(&sha256[..2]);
    fs::create_dir_all(&object_dir)
        .map_err(|e| format!("无法创建图片对象目录 {}: {e}", object_dir.display()))?;
    let object_path = object_dir.join(format!("{}.{}", &sha256[2..], extension));
    let relative_object_path = format!("{}/{}.{}", &sha256[..2], &sha256[2..], extension);
    if !object_path.exists() {
        let temp_path = state
            .paths
            .temp
            .join(format!("asset-{}.tmp", Uuid::new_v4()));
        let mut temp = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|e| format!("无法创建图片临时文件: {e}"))?;
        temp.write_all(&bytes)
            .and_then(|_| temp.sync_all())
            .map_err(|e| {
                let _ = fs::remove_file(&temp_path);
                format!("无法可靠写入图片: {e}")
            })?;
        match fs::rename(&temp_path, &object_path) {
            Ok(()) => {}
            Err(_error) if object_path.exists() => {
                let _ = fs::remove_file(&temp_path);
            }
            Err(error) => {
                let _ = fs::remove_file(&temp_path);
                return Err(format!("无法提交图片对象: {error}"));
            }
        }
    }
    // Best-effort thumbnail so the first list paint never reads the full file.
    let _ = ensure_thumbnail(&state.paths, &object_path, &sha256);
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let existing: Option<(String, String, String)> = conn
        .query_row(
            "SELECT id,original_name,created_at FROM assets WHERE sha256=?1",
            [&sha256],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("无法检查重复图片: {e}"))?;
    let timestamp = now();
    let (id, name, created_at) = if let Some(existing) = existing {
        existing
    } else {
        let id = Uuid::new_v4().to_string();
        let name = sanitize_display_name(&input.name, extension);
        conn.execute(
            "INSERT INTO assets(
               id,sha256,mime_type,extension,original_name,object_path,size,created_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                id,
                sha256,
                detected_mime,
                extension,
                name,
                relative_object_path,
                bytes.len() as i64,
                timestamp
            ],
        )
        .map_err(|e| format!("无法登记图片对象: {e}"))?;
        (id, name, timestamp)
    };
    if let (Some(entity_type), Some(entity_id)) =
        (input.entity_type.as_deref(), input.entity_id.as_deref())
    {
        if !["recipe", "resource", "snippet", "tip"].contains(&entity_type) {
            return Err("不支持把图片关联到此类型".into());
        }
        let tx = conn
            .transaction()
            .map_err(|e| format!("无法开始图片关联事务: {e}"))?;
        if entity_type == "resource" && input.role == "preview" {
            tx.execute(
                "DELETE FROM entity_assets
                 WHERE entity_type='resource' AND entity_id=?1 AND role='preview'",
                [entity_id],
            )
            .map_err(|e| format!("无法替换资源预览图: {e}"))?;
        }
        tx.execute(
            "INSERT INTO entity_assets(entity_type,entity_id,asset_id,role,sort_order)
             VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(entity_type,entity_id,asset_id) DO UPDATE SET
               role=excluded.role,sort_order=excluded.sort_order",
            params![entity_type, entity_id, id, input.role, input.sort_order],
        )
        .map_err(|e| format!("无法关联图片: {e}"))?;
        tx.commit().map_err(|e| format!("无法提交图片关联: {e}"))?;
    }
    let size = i64::try_from(
        fs::metadata(&object_path)
            .map_err(|e| format!("无法确认图片大小: {e}"))?
            .len(),
    )
    .unwrap_or(i64::MAX);
    let url = media_data_url(
        &state.paths,
        &object_path,
        &sha256,
        detected_mime,
        AssetEmbed::Thumbnail,
    )
    .unwrap_or_default();
    Ok(Asset {
        id,
        name,
        sha256,
        mime_type: detected_mime.into(),
        url,
        size,
        created_at,
    })
}

#[tauri::command]
pub fn get_asset_data(state: State<'_, PromptVaultState>, id: String) -> Result<AssetData, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let (mime_type, sha256, extension, stored_path): (String, String, String, String) = conn
        .query_row(
            "SELECT mime_type,sha256,extension,object_path FROM assets WHERE id=?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|e| format!("图片不存在: {e}"))?;
    let object_path = resolve_object_path(&state.paths, &sha256, &extension, &stored_path)?;
    let bytes = fs::read(&object_path)
        .map_err(|e| format!("无法读取图片文件 {}: {e}", object_path.display()))?;
    Ok(AssetData {
        id,
        mime_type,
        data_base64: STANDARD.encode(bytes),
    })
}

#[tauri::command]
pub fn detach_asset(
    state: State<'_, PromptVaultState>,
    entity_type: String,
    entity_id: String,
    asset_id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    conn.execute(
        "DELETE FROM entity_assets WHERE entity_type=?1 AND entity_id=?2 AND asset_id=?3",
        params![entity_type, entity_id, asset_id],
    )
    .map_err(|e| format!("无法移除图片关联: {e}"))?;
    Ok(())
}

/// Delete assets that no live entity references, including object + thumbnail files.
pub fn collect_orphan_assets(conn: &Connection, paths: &VaultPaths) -> Result<usize, String> {
    let mut statement = conn
        .prepare(
            "SELECT a.id,a.sha256,a.extension,a.object_path
             FROM assets a
             WHERE NOT EXISTS (
               SELECT 1 FROM entity_assets ea WHERE ea.asset_id=a.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM recipes r WHERE r.cover_asset_id=a.id
             )",
        )
        .map_err(|e| format!("无法扫描孤立图片: {e}"))?;
    let orphans = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("无法扫描孤立图片: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法扫描孤立图片: {e}"))?;
    drop(statement);
    let mut removed = 0usize;
    for (id, sha256, extension, stored) in orphans {
        if let Ok(object_path) = resolve_object_path(paths, &sha256, &extension, &stored) {
            let _ = fs::remove_file(object_path);
        }
        let _ = fs::remove_file(thumbnail_path(paths, &sha256));
        conn.execute("DELETE FROM assets WHERE id=?1", [&id])
            .map_err(|e| format!("无法删除孤立图片记录: {e}"))?;
        removed += 1;
    }
    Ok(removed)
}

#[tauri::command]
pub fn garbage_collect_assets(state: State<'_, PromptVaultState>) -> Result<usize, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    collect_orphan_assets(&conn, &state.paths)
}

pub fn thumbnail_path(paths: &VaultPaths, sha256: &str) -> PathBuf {
    // Versioned filename so raising THUMBNAIL_MAX_EDGE regenerates sharper thumbs.
    paths
        .thumbnails
        .join(&sha256[..2])
        .join(format!("{}.w{THUMBNAIL_MAX_EDGE}.jpg", &sha256[2..]))
}

pub fn ensure_thumbnail(
    paths: &VaultPaths,
    object_path: &Path,
    sha256: &str,
) -> Result<PathBuf, String> {
    let thumb = thumbnail_path(paths, sha256);
    if thumb.is_file() {
        return Ok(thumb);
    }
    write_thumbnail(object_path, &thumb, paths)?;
    Ok(thumb)
}

fn write_thumbnail(source: &Path, dest: &Path, paths: &VaultPaths) -> Result<(), String> {
    let reader = ImageReader::open(source)
        .map_err(|e| format!("无法打开图片 {}: {e}", source.display()))?
        .with_guessed_format()
        .map_err(|e| format!("无法识别图片格式 {}: {e}", source.display()))?;
    let image = reader
        .decode()
        .map_err(|e| format!("无法解码图片 {}: {e}", source.display()))?;
    let resized = image.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE);
    let rgb = resized.to_rgb8();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建缩略图目录 {}: {e}", parent.display()))?;
    }
    let temp = paths.temp.join(format!("thumb-{}.jpg", Uuid::new_v4()));
    {
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| format!("无法创建缩略图临时文件: {e}"))?;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            BufWriter::new(file),
            THUMBNAIL_JPEG_QUALITY,
        );
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| {
                let _ = fs::remove_file(&temp);
                format!("无法编码缩略图: {e}")
            })?;
    }
    match fs::rename(&temp, dest) {
        Ok(()) => Ok(()),
        Err(_error) if dest.exists() => {
            let _ = fs::remove_file(&temp);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(format!("无法提交缩略图: {error}"))
        }
    }
}

/// Build a data URL for UI embedding. Thumbnail path is preferred for lists.
pub fn media_data_url(
    paths: &VaultPaths,
    object_path: &Path,
    sha256: &str,
    mime_type: &str,
    embed: AssetEmbed,
) -> Result<String, String> {
    match embed {
        AssetEmbed::None => Ok(String::new()),
        AssetEmbed::Thumbnail => {
            let thumb = ensure_thumbnail(paths, object_path, sha256)?;
            let bytes =
                fs::read(&thumb).map_err(|e| format!("无法读取缩略图 {}: {e}", thumb.display()))?;
            Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
        }
        AssetEmbed::Full => {
            let bytes = fs::read(object_path)
                .map_err(|e| format!("无法读取图片 {}: {e}", object_path.display()))?;
            Ok(format!(
                "data:{mime_type};base64,{}",
                STANDARD.encode(bytes)
            ))
        }
    }
}

/// Create a thumbnail data URL from an arbitrary image path (e.g. adjacent LoRA previews).
pub fn thumbnail_data_url_from_path(
    paths: &VaultPaths,
    path: &Path,
) -> Result<Option<String>, String> {
    let metadata = path
        .metadata()
        .map_err(|e| format!("无法读取预览图信息: {e}"))?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES as u64 {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|e| format!("无法读取预览图: {e}"))?;
    let Some((_, extension)) = detect_image(&bytes) else {
        return Ok(None);
    };
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    // Cache under thumbnails/external/ so repeated resource scans stay cheap.
    let cache = paths
        .thumbnails
        .join("external")
        .join(&sha256[..2])
        .join(format!("{sha256}.{extension}.jpg"));
    if !cache.is_file() {
        if let Some(parent) = cache.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建外部预览缓存: {e}"))?;
        }
        // Reuse object decode pipeline via a temp source path is wasteful;
        // decode from memory instead.
        write_thumbnail_from_bytes(&bytes, &cache, paths)?;
    }
    let thumb_bytes = fs::read(&cache).map_err(|e| format!("无法读取外部预览缓存: {e}"))?;
    Ok(Some(format!(
        "data:image/jpeg;base64,{}",
        STANDARD.encode(thumb_bytes)
    )))
}

fn write_thumbnail_from_bytes(bytes: &[u8], dest: &Path, paths: &VaultPaths) -> Result<(), String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("无法识别预览图格式: {e}"))?;
    let image = reader
        .decode()
        .map_err(|e| format!("无法解码预览图: {e}"))?;
    let resized = image.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE);
    let rgb = resized.to_rgb8();
    let temp = paths.temp.join(format!("ext-thumb-{}.jpg", Uuid::new_v4()));
    {
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|e| format!("无法创建外部缩略图临时文件: {e}"))?;
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            BufWriter::new(file),
            THUMBNAIL_JPEG_QUALITY,
        );
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|e| {
                let _ = fs::remove_file(&temp);
                format!("无法编码外部缩略图: {e}")
            })?;
    }
    match fs::rename(&temp, dest) {
        Ok(()) => Ok(()),
        Err(_error) if dest.exists() => {
            let _ = fs::remove_file(&temp);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(format!("无法提交外部缩略图: {error}"))
        }
    }
}

fn sanitize_display_name(name: &str, extension: &str) -> String {
    let name = Path::new(name)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .trim();
    if name.is_empty() {
        format!("image.{extension}")
    } else {
        name.chars().take(240).collect()
    }
}

pub(crate) fn detect_image(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::VaultPaths;

    #[test]
    fn detects_supported_image_magic() {
        assert_eq!(
            detect_image(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]),
            Some(("image/png", "png"))
        );
        assert_eq!(
            detect_image(&[0xff, 0xd8, 0xff, 0xe0]),
            Some(("image/jpeg", "jpg"))
        );
        assert_eq!(detect_image(b"not-an-image"), None);
    }

    #[test]
    fn strips_untrusted_path_from_display_name() {
        assert_eq!(
            sanitize_display_name(r"C:\private\photo.png", "png"),
            "photo.png"
        );
    }

    #[test]
    fn builds_jpeg_thumbnail_smaller_than_source_edge() {
        let root = std::env::temp_dir().join(format!("pv-thumb-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let source = paths.temp.join("big.png");
        // 600x400 solid red PNG via image crate
        let mut img = image::RgbImage::new(600, 400);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgb([220, 40, 40]);
        }
        img.save(&source).unwrap();
        let sha = "b".repeat(64);
        let thumb = ensure_thumbnail(&paths, &source, &sha).unwrap();
        assert!(thumb.is_file());
        let decoded = image::open(&thumb).unwrap();
        assert!(decoded.width() <= THUMBNAIL_MAX_EDGE);
        assert!(decoded.height() <= THUMBNAIL_MAX_EDGE);
        let url =
            media_data_url(&paths, &source, &sha, "image/png", AssetEmbed::Thumbnail).unwrap();
        assert!(url.starts_with("data:image/jpeg;base64,"));
        assert!(url.len() < 200_000);
        let _ = fs::remove_dir_all(root);
    }
}

use crate::{
    db::{
        checkpoint_wal, get_app_settings, integrity_check, now, open_connection,
        read_backup_location, resolve_object_path, validate_object_identity, PromptVaultState,
        VaultPaths, SCHEMA_VERSION,
    },
    models::BackupInfo,
};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupManifest {
    format: String,
    schema_version: i64,
    created_at: String,
    database_sha256: String,
    objects: Vec<ManifestObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestObject {
    sha256: String,
    extension: String,
    size: u64,
}

fn backup_root(paths: &VaultPaths, configured: &str) -> PathBuf {
    if configured.trim().is_empty() {
        paths.backups.clone()
    } else {
        PathBuf::from(configured).join("PromptNook-backups")
    }
}

#[tauri::command]
pub fn create_backup(
    state: State<'_, PromptVaultState>,
    backup_path: Option<String>,
) -> Result<BackupInfo, String> {
    if state
        .recovery
        .lock()
        .map_err(|_| "恢复状态锁已损坏".to_string())?
        .is_some()
    {
        return Err("当前处于恢复模式，不能把临时空库保存为备份".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let settings = get_app_settings(&conn)?;
    let configured = backup_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!settings.backup_path.is_empty()).then_some(settings.backup_path))
        .or_else(|| read_backup_location(&state.paths))
        .unwrap_or_default();
    create_backup_inner(&conn, &state.paths, &configured)
}

pub fn create_backup_inner(
    conn: &Connection,
    paths: &VaultPaths,
    configured_path: &str,
) -> Result<BackupInfo, String> {
    let _ = checkpoint_wal(conn);
    integrity_check(conn)?;
    let root = backup_root(paths, configured_path);
    fs::create_dir_all(root.join("snapshots"))
        .and_then(|_| fs::create_dir_all(root.join("objects")))
        .map_err(|e| format!("无法创建备份目录 {}: {e}", root.display()))?;
    let created_at = now();
    let id = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        &Uuid::new_v4().to_string()[..8]
    );
    let partial = root.join("snapshots").join(format!(".partial-{id}"));
    let final_path = root.join("snapshots").join(&id);
    fs::create_dir_all(&partial)
        .map_err(|e| format!("无法创建备份临时目录 {}: {e}", partial.display()))?;
    let result = (|| {
        let database_path = partial.join("prompt-vault.sqlite3");
        let mut destination =
            Connection::open(&database_path).map_err(|e| format!("无法创建备份数据库: {e}"))?;
        destination
            .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")
            .map_err(|e| format!("无法配置备份数据库: {e}"))?;
        {
            let backup = Backup::new(conn, &mut destination)
                .map_err(|e| format!("无法开始 SQLite 在线备份: {e}"))?;
            backup
                .run_to_completion(128, Duration::from_millis(5), None)
                .map_err(|e| format!("SQLite 在线备份失败: {e}"))?;
        }
        integrity_check(&destination)?;
        drop(destination);
        let database_sha256 = hash_file(&database_path)?;

        let mut statement = conn
            .prepare("SELECT sha256,extension,object_path,size FROM assets ORDER BY sha256")
            .map_err(|e| format!("无法读取媒体清单: {e}"))?;
        let object_rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| format!("无法读取媒体清单: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("无法读取媒体清单: {e}"))?;
        let mut objects = Vec::with_capacity(object_rows.len());
        for (sha256, extension, source_path, recorded_size) in object_rows {
            validate_object_identity(&sha256, &extension)?;
            let source = resolve_object_path(paths, &sha256, &extension, &source_path)?;
            let actual_hash = hash_file(&source)?;
            if actual_hash != sha256 {
                return Err(format!("媒体对象校验失败: {}", source.display()));
            }
            let destination = root.join("objects").join(&sha256[..2]).join(format!(
                "{}.{}",
                &sha256[2..],
                extension
            ));
            if !destination.exists() {
                copy_atomic(&source, &destination)?;
            } else if hash_file(&destination)? != sha256 {
                return Err(format!(
                    "备份媒体池中存在损坏对象: {}",
                    destination.display()
                ));
            }
            objects.push(ManifestObject {
                sha256,
                extension,
                size: u64::try_from(recorded_size).unwrap_or(0),
            });
        }
        let manifest = BackupManifest {
            format: "PromptNookBackup/v1".into(),
            schema_version: SCHEMA_VERSION,
            created_at: created_at.clone(),
            database_sha256: database_sha256.clone(),
            objects,
        };
        write_sync(
            &partial.join("manifest.json"),
            &serde_json::to_vec_pretty(&manifest).map_err(|e| format!("无法生成备份清单: {e}"))?,
        )?;
        fs::rename(&partial, &final_path).map_err(|e| format!("无法原子提交备份快照: {e}"))?;
        let size = directory_size(&final_path)?;
        Ok(BackupInfo {
            id,
            created_at,
            status: "valid".into(),
            location: final_path.to_string_lossy().into_owned(),
            size,
        })
    })();
    if result.is_err() && partial.exists() {
        let _ = fs::remove_dir_all(&partial);
    }
    if result.is_ok() {
        let _ = prune_snapshots(&root);
    }
    result
}

pub fn create_automatic_backup_if_due(
    state: &PromptVaultState,
    require_idle: bool,
) -> Result<Option<BackupInfo>, String> {
    if state
        .recovery
        .lock()
        .map_err(|_| "恢复状态锁已损坏".to_string())?
        .is_some()
    {
        return Ok(None);
    }
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let settings = get_app_settings(&conn)?;
    let configured = if settings.backup_path.is_empty() {
        read_backup_location(&state.paths).unwrap_or_default()
    } else {
        settings.backup_path
    };
    let newest_change: Option<String> = conn
        .query_row(
            "SELECT MAX(value) FROM (
               SELECT MAX(updated_at) AS value FROM recipes
               UNION ALL SELECT MAX(updated_at) FROM snippets
               UNION ALL SELECT MAX(updated_at) FROM categories
               UNION ALL SELECT MAX(updated_at) FROM tips
               UNION ALL SELECT MAX(updated_at) FROM resources
               UNION ALL SELECT MAX(updated_at) FROM settings
               UNION ALL SELECT MAX(created_at) FROM assets
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("无法判断自动备份时机: {e}"))?;
    let Some(newest_change) = newest_change
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&chrono::Utc))
    else {
        return Ok(None);
    };
    let now = chrono::Utc::now();
    if require_idle && now.signed_duration_since(newest_change) < chrono::Duration::minutes(10) {
        return Ok(None);
    }
    let latest = list_backups_inner(&state.paths, &configured)?
        .into_iter()
        .filter(|item| item.status == "valid")
        .filter_map(|item| {
            chrono::DateTime::parse_from_rfc3339(&item.created_at)
                .ok()
                .map(|time| time.with_timezone(&chrono::Utc))
        })
        .max();
    if let Some(latest) = latest {
        if latest >= newest_change || now.signed_duration_since(latest) < chrono::Duration::hours(1)
        {
            return Ok(None);
        }
    }
    create_backup_inner(&conn, &state.paths, &configured).map(Some)
}

fn prune_snapshots(root: &Path) -> Result<(), String> {
    let snapshots = root.join("snapshots");
    if !snapshots.is_dir() {
        return Ok(());
    }
    let mut known = Vec::new();
    for entry in fs::read_dir(&snapshots).map_err(|e| format!("无法读取快照保留目录: {e}"))?
    {
        let entry = entry.map_err(|e| format!("无法读取快照条目: {e}"))?;
        if !entry.path().is_dir() || entry.file_name().to_string_lossy().starts_with(".partial-") {
            continue;
        }
        // Unknown or malformed snapshots are deliberately retained; pruning
        // must never destroy the only potentially recoverable copy.
        let Ok(manifest) = read_manifest(&entry.path()) else {
            continue;
        };
        let Ok(time) = chrono::DateTime::parse_from_rfc3339(&manifest.created_at) else {
            continue;
        };
        known.push((entry.path(), time.with_timezone(&chrono::Utc)));
    }
    known.sort_by_key(|item| std::cmp::Reverse(item.1));
    let now = chrono::Utc::now();
    let mut hours = HashSet::new();
    let mut days = HashSet::new();
    let mut months = HashSet::new();
    for (index, (path, timestamp)) in known.into_iter().enumerate() {
        let age = now.signed_duration_since(timestamp);
        let keep = index < 3
            || age < chrono::Duration::zero()
            || (age <= chrono::Duration::hours(24)
                && hours.insert(timestamp.format("%Y-%m-%dT%H").to_string()))
            || (age <= chrono::Duration::days(30)
                && days.insert(timestamp.format("%Y-%m-%d").to_string()))
            || (age <= chrono::Duration::days(366)
                && months.insert(timestamp.format("%Y-%m").to_string()));
        if !keep && path.parent() == Some(snapshots.as_path()) {
            fs::remove_dir_all(&path)
                .map_err(|e| format!("无法清理过期快照 {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_backups(
    state: State<'_, PromptVaultState>,
    backup_path: Option<String>,
) -> Result<Vec<BackupInfo>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let settings = get_app_settings(&conn)?;
    let configured = backup_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!settings.backup_path.is_empty()).then_some(settings.backup_path))
        .or_else(|| read_backup_location(&state.paths))
        .unwrap_or_default();
    list_backups_inner(&state.paths, &configured)
}

pub fn list_backups_inner(
    paths: &VaultPaths,
    configured_path: &str,
) -> Result<Vec<BackupInfo>, String> {
    let root = backup_root(paths, configured_path).join("snapshots");
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("无法读取备份目录: {e}"))? {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !entry.path().is_dir() || entry.file_name().to_string_lossy().starts_with(".partial-") {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let manifest = read_manifest(&entry.path());
        let (created_at, status) = match manifest {
            Ok(value) => {
                let valid = validate_snapshot_shallow(
                    &backup_root(paths, configured_path),
                    &entry.path(),
                    &value,
                )
                .is_ok();
                (
                    value.created_at,
                    if valid { "valid" } else { "invalid" }.to_string(),
                )
            }
            Err(_) => (String::new(), "invalid".into()),
        };
        result.push(BackupInfo {
            id,
            created_at,
            status,
            location: entry.path().to_string_lossy().into_owned(),
            size: directory_size(&entry.path()).unwrap_or(0),
        });
    }
    result.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(result)
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, PromptVaultState>,
    id: String,
    backup_path: Option<String>,
) -> Result<(), String> {
    restore_backup_inner(&state, id, backup_path)
}

pub fn restore_backup_inner(
    state: &PromptVaultState,
    id: String,
    backup_path: Option<String>,
) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id.starts_with('.') {
        return Err("备份 ID 无效".into());
    }
    let recovery_before = state
        .recovery
        .lock()
        .map_err(|_| "恢复状态锁已损坏".to_string())?
        .clone();
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let settings = get_app_settings(&conn)?;
    let configured = backup_path
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!settings.backup_path.is_empty()).then_some(settings.backup_path))
        .or_else(|| read_backup_location(&state.paths))
        .unwrap_or_default();
    let root = backup_root(&state.paths, &configured);
    let snapshot_path = root.join("snapshots").join(&id);
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("无法访问备份根目录: {e}"))?;
    let canonical_snapshot = snapshot_path
        .canonicalize()
        .map_err(|e| format!("备份不存在: {e}"))?;
    if !path_is_within(&canonical_snapshot, &canonical_root) {
        return Err("拒绝访问备份目录之外的路径".into());
    }
    let manifest = read_manifest(&canonical_snapshot)?;
    validate_snapshot(&canonical_root, &canonical_snapshot, &manifest)?;

    let staging_root = state
        .paths
        .temp
        .join(format!("restore-stage-{}", Uuid::new_v4()));
    fs::create_dir_all(staging_root.join("objects"))
        .map_err(|e| format!("无法创建恢复 staging 目录: {e}"))?;
    if let Err(error) = stage_verified_snapshot(
        &canonical_root,
        &canonical_snapshot,
        &manifest,
        &staging_root,
    ) {
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error);
    }

    // Content-addressed media is additive. Finish every verified media copy
    // before changing the live database, so DB references can never become
    // visible before their files.
    for object in &manifest.objects {
        let staged = manifest_object_path(&staging_root, object)?;
        let destination = manifest_object_path(&state.paths.root, object)?;
        if !destination.exists() || hash_file(&destination)? != object.sha256 {
            copy_atomic(&staged, &destination)?;
        }
    }

    let safety = if recovery_before.is_none() {
        Some(create_backup_inner(&conn, &state.paths, &configured)?)
    } else {
        None
    };
    let staged_database = staging_root.join("prompt-vault.sqlite3");
    let rollback_database = state.paths.root.join(format!(
        "prompt-vault.pre-restore-{}-{}.sqlite3",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        &Uuid::new_v4().to_string()[..8]
    ));
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("恢复前无法收拢 WAL: {e}"))?;
    let disposable =
        Connection::open_in_memory().map_err(|e| format!("无法准备数据库切换: {e}"))?;
    let old_connection = std::mem::replace(&mut *conn, disposable);
    drop(old_connection);

    if let Err(error) =
        switch_database_files(&state.paths.database, &staged_database, &rollback_database)
    {
        if let Ok(reopened) = open_connection(&state.paths.database) {
            *conn = reopened;
        }
        let _ = fs::remove_dir_all(&staging_root);
        return Err(error);
    }
    match open_connection(&state.paths.database).and_then(|new_conn| {
        integrity_check(&new_conn)?;
        Ok(new_conn)
    }) {
        Ok(new_conn) => {
            *conn = new_conn;
            drop(conn);
            if let Some(mode) = state
                .recovery
                .lock()
                .map_err(|_| "恢复状态锁已损坏".to_string())?
                .take()
            {
                let _ = fs::remove_file(mode.session_database);
            }
            let _ = fs::remove_dir_all(&staging_root);
            Ok(())
        }
        Err(validation_error) => {
            let failed = state
                .paths
                .root
                .join(format!("failed-restore-{}.sqlite3", Uuid::new_v4()));
            let _ = fs::rename(&state.paths.database, &failed);
            let _ = remove_exact_sidecars(&state.paths.database);
            let _ = restore_rollback_files(&state.paths.database, &rollback_database);
            if let Ok(original) = open_connection(&state.paths.database) {
                *conn = original;
            }
            let _ = fs::remove_dir_all(&staging_root);
            Err(format!(
                "恢复后的数据库校验失败并已自动回滚：{validation_error}{}",
                safety
                    .map(|item| format!("；安全快照：{}", item.location))
                    .unwrap_or_default()
            ))
        }
    }
}

#[tauri::command]
pub fn import_promptvault(
    state: State<'_, PromptVaultState>,
    package_path: String,
    backup_path: Option<String>,
) -> Result<BackupInfo, String> {
    import_promptvault_inner(&state, package_path, backup_path)
}

pub fn import_promptvault_inner(
    state: &PromptVaultState,
    package_path: String,
    backup_path: Option<String>,
) -> Result<BackupInfo, String> {
    let package = PathBuf::from(package_path);
    if !package.is_file() {
        return Err("迁移包不存在".into());
    }
    let configured = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        let settings = get_app_settings(&conn)?;
        backup_path
            .filter(|value| !value.trim().is_empty())
            .or_else(|| (!settings.backup_path.is_empty()).then_some(settings.backup_path))
            .or_else(|| read_backup_location(&state.paths))
            .unwrap_or_default()
    };
    let destination_root = backup_root(&state.paths, &configured);
    fs::create_dir_all(destination_root.join("snapshots"))
        .and_then(|_| fs::create_dir_all(destination_root.join("objects")))
        .map_err(|e| format!("无法创建迁移包导入目录: {e}"))?;
    let stage_root = state
        .paths
        .temp
        .join(format!("package-import-{}", Uuid::new_v4()));
    let snapshot_id = format!(
        "{}-import-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        &Uuid::new_v4().to_string()[..8]
    );
    let stage_snapshot = stage_root.join("snapshots").join(&snapshot_id);
    fs::create_dir_all(&stage_snapshot)
        .and_then(|_| fs::create_dir_all(stage_root.join("objects")))
        .map_err(|e| format!("无法创建迁移包 staging 目录: {e}"))?;
    let result = (|| {
        let file = File::open(&package).map_err(|e| format!("无法打开迁移包: {e}"))?;
        let mut archive = ZipArchive::new(file).map_err(|e| format!("迁移包不是有效 ZIP: {e}"))?;
        let manifest_bytes = {
            let mut entry = archive
                .by_name("manifest.json")
                .map_err(|e| format!("迁移包缺少 manifest.json: {e}"))?;
            if entry.size() > 10 * 1024 * 1024 {
                return Err("迁移包清单超过 10 MiB".into());
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("无法读取迁移包清单: {e}"))?;
            bytes
        };
        let manifest: BackupManifest =
            serde_json::from_slice(&manifest_bytes).map_err(|e| format!("迁移包清单无效: {e}"))?;
        if !matches!(
            manifest.format.as_str(),
            "PromptNookBackup/v1" | "PromptVaultBackup/v1"
        ) {
            return Err("不支持的迁移包格式".into());
        }
        write_sync(&stage_snapshot.join("manifest.json"), &manifest_bytes)?;
        {
            let mut entry = archive
                .by_name("prompt-vault.sqlite3")
                .map_err(|e| format!("迁移包缺少数据库: {e}"))?;
            if entry.size() == 0 || entry.size() > 8 * 1024 * 1024 * 1024 {
                return Err("迁移包数据库大小异常".into());
            }
            write_stream_sync(&stage_snapshot.join("prompt-vault.sqlite3"), &mut entry)?;
        }
        for object in &manifest.objects {
            validate_object_identity(&object.sha256, &object.extension)?;
            if object.size > 100 * 1024 * 1024 {
                return Err("迁移包单个媒体对象超过 100 MiB".into());
            }
            let name = format!(
                "objects/{}/{}.{}",
                &object.sha256[..2],
                &object.sha256[2..],
                object.extension
            );
            let mut entry = archive
                .by_name(&name)
                .map_err(|e| format!("迁移包缺少媒体 {name}: {e}"))?;
            if entry.size() != object.size {
                return Err(format!("迁移包媒体大小与清单不符: {name}"));
            }
            let destination = manifest_object_path(&stage_root, object)?;
            write_stream_sync(&destination, &mut entry)?;
        }
        validate_snapshot(&stage_root, &stage_snapshot, &manifest)?;

        for object in &manifest.objects {
            let source = manifest_object_path(&stage_root, object)?;
            let destination = manifest_object_path(&destination_root, object)?;
            if !destination.exists() {
                copy_atomic(&source, &destination)?;
            } else if hash_file(&destination)? != object.sha256 {
                return Err(format!(
                    "目标备份媒体池存在损坏对象: {}",
                    destination.display()
                ));
            }
        }
        let partial = destination_root
            .join("snapshots")
            .join(format!(".partial-{snapshot_id}"));
        fs::create_dir_all(&partial).map_err(|e| format!("无法创建导入快照目录: {e}"))?;
        copy_atomic(
            &stage_snapshot.join("manifest.json"),
            &partial.join("manifest.json"),
        )?;
        copy_atomic(
            &stage_snapshot.join("prompt-vault.sqlite3"),
            &partial.join("prompt-vault.sqlite3"),
        )?;
        let final_path = destination_root.join("snapshots").join(&snapshot_id);
        fs::rename(&partial, &final_path).map_err(|e| format!("无法提交导入快照: {e}"))?;
        Ok(BackupInfo {
            id: snapshot_id,
            created_at: manifest.created_at,
            status: "valid".into(),
            location: final_path.to_string_lossy().into_owned(),
            size: directory_size(&final_path)?,
        })
    })();
    let _ = fs::remove_dir_all(&stage_root);
    result
}

fn read_manifest(snapshot_path: &Path) -> Result<BackupManifest, String> {
    let bytes = fs::read(snapshot_path.join("manifest.json"))
        .map_err(|e| format!("无法读取备份清单: {e}"))?;
    let manifest: BackupManifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("备份清单无效: {e}"))?;
    if !matches!(
        manifest.format.as_str(),
        "PromptNookBackup/v1" | "PromptVaultBackup/v1"
    ) {
        return Err("不支持的备份格式".into());
    }
    Ok(manifest)
}

fn validate_snapshot(
    root: &Path,
    snapshot_path: &Path,
    manifest: &BackupManifest,
) -> Result<(), String> {
    if manifest.schema_version > SCHEMA_VERSION {
        return Err(format!(
            "备份数据库版本 {} 高于本程序支持的版本 {}",
            manifest.schema_version, SCHEMA_VERSION
        ));
    }
    let database_path = snapshot_path.join("prompt-vault.sqlite3");
    if hash_file(&database_path)? != manifest.database_sha256 {
        return Err("备份数据库校验和不匹配".into());
    }
    let database = Connection::open_with_flags(&database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("无法验证备份数据库: {e}"))?;
    integrity_check(&database)?;
    let mut seen = HashSet::new();
    for object in &manifest.objects {
        validate_object_identity(&object.sha256, &object.extension)?;
        if !seen.insert((object.sha256.clone(), object.extension.clone())) {
            return Err("备份清单包含重复媒体对象".into());
        }
        let path = manifest_object_path(root, object)?;
        if path.metadata().map(|value| value.len()).unwrap_or(u64::MAX) != object.size {
            return Err(format!("备份媒体大小不匹配: {}", path.display()));
        }
        if hash_file(&path)? != object.sha256 {
            return Err(format!("备份媒体对象校验失败: {}", path.display()));
        }
    }
    Ok(())
}

fn validate_snapshot_shallow(
    root: &Path,
    snapshot_path: &Path,
    manifest: &BackupManifest,
) -> Result<(), String> {
    if manifest.schema_version > SCHEMA_VERSION {
        return Err("备份来自更高版本".into());
    }
    let database = snapshot_path.join("prompt-vault.sqlite3");
    if !database.is_file() || database.metadata().map(|v| v.len()).unwrap_or(0) == 0 {
        return Err("备份数据库文件缺失".into());
    }
    let mut seen = HashSet::new();
    for object in &manifest.objects {
        validate_object_identity(&object.sha256, &object.extension)?;
        if !seen.insert((object.sha256.clone(), object.extension.clone())) {
            return Err("备份清单包含重复媒体对象".into());
        }
        let path = manifest_object_path(root, object)?;
        let metadata = path.metadata().map_err(|e| format!("备份媒体缺失: {e}"))?;
        if !metadata.is_file() || metadata.len() != object.size {
            return Err("备份媒体大小不匹配".into());
        }
    }
    Ok(())
}

fn manifest_object_path(root: &Path, object: &ManifestObject) -> Result<PathBuf, String> {
    validate_object_identity(&object.sha256, &object.extension)?;
    let path = root.join("objects").join(&object.sha256[..2]).join(format!(
        "{}.{}",
        &object.sha256[2..],
        object.extension
    ));
    if !path_is_within(&path, root) {
        return Err("备份媒体路径越界".into());
    }
    Ok(path)
}

fn stage_verified_snapshot(
    backup_root: &Path,
    snapshot_path: &Path,
    manifest: &BackupManifest,
    staging_root: &Path,
) -> Result<(), String> {
    let source_database = snapshot_path.join("prompt-vault.sqlite3");
    let staged_database = staging_root.join("prompt-vault.sqlite3");
    copy_atomic(&source_database, &staged_database)?;
    if hash_file(&staged_database)? != manifest.database_sha256 {
        return Err("staging 数据库校验失败".into());
    }
    for object in &manifest.objects {
        let source = manifest_object_path(backup_root, object)?;
        let staged = manifest_object_path(staging_root, object)?;
        copy_atomic(&source, &staged)?;
        if hash_file(&staged)? != object.sha256 {
            return Err(format!("staging 媒体校验失败: {}", staged.display()));
        }
    }

    let mut database =
        Connection::open(&staged_database).map_err(|e| format!("无法打开 staging 数据库: {e}"))?;
    crate::db::migrate(&mut database)?;
    let manifest_objects: HashSet<(String, String)> = manifest
        .objects
        .iter()
        .map(|item| (item.sha256.clone(), item.extension.clone()))
        .collect();
    let mut statement = database
        .prepare("SELECT id,sha256,extension FROM assets")
        .map_err(|e| format!("无法读取 staging 媒体记录: {e}"))?;
    let assets = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("无法读取 staging 媒体记录: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取 staging 媒体记录: {e}"))?;
    drop(statement);
    let tx = database
        .transaction()
        .map_err(|e| format!("无法开始 staging 路径迁移: {e}"))?;
    for (id, sha256, extension) in assets {
        validate_object_identity(&sha256, &extension)?;
        if !manifest_objects.contains(&(sha256.clone(), extension.clone())) {
            return Err(format!("备份清单缺少数据库引用的媒体对象 {id}"));
        }
        let relative = format!("{}/{}.{}", &sha256[..2], &sha256[2..], extension);
        tx.execute(
            "UPDATE assets SET object_path=?2 WHERE id=?1",
            rusqlite::params![id, relative],
        )
        .map_err(|e| format!("无法规范 staging 媒体路径: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("无法提交 staging 媒体路径: {e}"))?;
    database
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
        .map_err(|e| format!("无法收拢 staging 数据库: {e}"))?;
    integrity_check(&database)
}

fn switch_database_files(live: &Path, staged: &Path, rollback: &Path) -> Result<(), String> {
    if rollback.exists() {
        return Err("恢复回滚文件已存在，请稍后重试".into());
    }
    if live.exists() {
        fs::rename(live, rollback).map_err(|e| format!("无法保留恢复前数据库: {e}"))?;
    }
    let live_wal = append_file_suffix(live, "-wal");
    let live_shm = append_file_suffix(live, "-shm");
    let rollback_wal = append_file_suffix(rollback, "-wal");
    let rollback_shm = append_file_suffix(rollback, "-shm");
    if live_wal.exists() {
        if let Err(error) = fs::rename(&live_wal, &rollback_wal) {
            let _ = restore_rollback_files(live, rollback);
            return Err(format!("无法保留恢复前 WAL，已回滚: {error}"));
        }
    }
    if live_shm.exists() {
        if let Err(error) = fs::rename(&live_shm, &rollback_shm) {
            let _ = restore_rollback_files(live, rollback);
            return Err(format!("无法保留恢复前 SHM，已回滚: {error}"));
        }
    }
    if let Err(error) = fs::rename(staged, live) {
        let _ = restore_rollback_files(live, rollback);
        return Err(format!("无法切换到恢复数据库，已回滚: {error}"));
    }
    Ok(())
}

fn restore_rollback_files(live: &Path, rollback: &Path) -> Result<(), String> {
    if rollback.exists() && !live.exists() {
        fs::rename(rollback, live).map_err(|e| format!("无法恢复回滚数据库: {e}"))?;
    }
    let live_wal = append_file_suffix(live, "-wal");
    let live_shm = append_file_suffix(live, "-shm");
    let rollback_wal = append_file_suffix(rollback, "-wal");
    let rollback_shm = append_file_suffix(rollback, "-shm");
    if rollback_wal.exists() && !live_wal.exists() {
        fs::rename(rollback_wal, live_wal).map_err(|e| format!("无法恢复回滚 WAL: {e}"))?;
    }
    if rollback_shm.exists() && !live_shm.exists() {
        fs::rename(rollback_shm, live_shm).map_err(|e| format!("无法恢复回滚 SHM: {e}"))?;
    }
    Ok(())
}

fn remove_exact_sidecars(database: &Path) -> Result<(), String> {
    for path in [
        append_file_suffix(database, "-wal"),
        append_file_suffix(database, "-shm"),
    ] {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("无法移除失败恢复 sidecar {}: {e}", path.display()))?;
        }
    }
    Ok(())
}

fn append_file_suffix(path: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", path.to_string_lossy(), suffix))
}

fn path_is_within(path: &Path, root: &Path) -> bool {
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

pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("无法读取 {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|e| format!("无法校验 {}: {e}", path.display()))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn write_sync(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file =
        fs::File::create(path).map_err(|e| format!("无法创建 {}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("无法可靠写入 {}: {e}", path.display()))
}

fn write_stream_sync(path: &Path, reader: &mut impl Read) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "目标文件没有父目录".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("无法创建目标目录: {e}"))?;
    let mut file = File::create(path).map_err(|e| format!("无法创建 {}: {e}", path.display()))?;
    std::io::copy(reader, &mut file)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("无法可靠写入 {}: {e}", path.display()))
}

fn copy_atomic(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "目标路径没有父目录".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("无法创建备份媒体目录 {}: {e}", parent.display()))?;
    let temporary = parent.join(format!(".copy-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut input =
            fs::File::open(source).map_err(|e| format!("无法打开 {}: {e}", source.display()))?;
        let mut output =
            fs::File::create(&temporary).map_err(|e| format!("无法创建临时备份文件: {e}"))?;
        std::io::copy(&mut input, &mut output)
            .and_then(|_| output.sync_all())
            .map_err(|e| format!("无法复制媒体对象: {e}"))?;
        if destination.exists() {
            fs::remove_file(destination).map_err(|e| format!("无法替换损坏的媒体对象: {e}"))?;
        }
        fs::rename(&temporary, destination).map_err(|e| format!("无法提交媒体对象: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let mut total = 0u64;
    for entry in WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|e| format!("无法统计备份大小: {e}"))?;
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata().map(|v| v.len()).unwrap_or(0));
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{PromptVaultState, VaultPaths};

    #[test]
    fn file_hash_is_stable() {
        let path = std::env::temp_dir().join(format!("pv-hash-{}", Uuid::new_v4()));
        fs::write(&path, b"PromptVault").unwrap();
        let first = hash_file(&path).unwrap();
        let second = hash_file(&path).unwrap();
        let _ = fs::remove_file(path);
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn online_backup_produces_a_valid_listed_snapshot() {
        let root = std::env::temp_dir().join(format!("pv-backup-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO snippets(
                   id,text_en,text_zh,notes,favorite,rating,usage_count,translation_locked,
                   created_at,updated_at
                 ) VALUES ('test','portrait','肖像','',0,0,0,0,?1,?1)",
                [crate::db::now()],
            )
            .unwrap();
            let backup = create_backup_inner(&conn, &paths, "").unwrap();
            assert_eq!(backup.status, "valid");
            assert!(Path::new(&backup.location)
                .join("prompt-vault.sqlite3")
                .is_file());
        }
        let listed = list_backups_inner(&paths, "").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "valid");
        drop(state);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn verified_backup_restores_even_when_live_database_is_corrupt() {
        let root = std::env::temp_dir().join(format!("pv-recovery-restore-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        let backup = {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO snippets(
                   id,text_en,text_zh,notes,favorite,rating,usage_count,translation_locked,
                   created_at,updated_at
                 ) VALUES ('recover-me','portrait','肖像','',0,0,0,0,?1,?1)",
                [crate::db::now()],
            )
            .unwrap();
            create_backup_inner(&conn, &paths, "").unwrap()
        };
        drop(state);
        fs::write(&paths.database, b"broken live database").unwrap();
        let recovered_state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        assert!(recovered_state.recovery.lock().unwrap().is_some());
        restore_backup_inner(&recovered_state, backup.id, None).unwrap();
        assert!(recovered_state.recovery.lock().unwrap().is_none());
        let text: String = recovered_state
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT text_en FROM snippets WHERE id='recover-me'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(text, "portrait");
        drop(recovered_state);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn promptvault_package_import_is_verified_before_becoming_a_snapshot() {
        let root = std::env::temp_dir().join(format!("pv-package-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        let backup = {
            let conn = state.db.lock().unwrap();
            create_backup_inner(&conn, &paths, "").unwrap()
        };
        let package = root.join("roundtrip.promptvault");
        {
            let file = File::create(&package).unwrap();
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default();
            for name in ["manifest.json", "prompt-vault.sqlite3"] {
                writer.start_file(name, options).unwrap();
                let bytes = fs::read(Path::new(&backup.location).join(name)).unwrap();
                writer.write_all(&bytes).unwrap();
            }
            writer.finish().unwrap();
        }
        let imported =
            import_promptvault_inner(&state, package.to_string_lossy().into_owned(), None).unwrap();
        assert_eq!(imported.status, "valid");
        assert!(Path::new(&imported.location)
            .join("manifest.json")
            .is_file());
        assert_eq!(list_backups_inner(&paths, "").unwrap().len(), 2);
        drop(state);
        let _ = fs::remove_dir_all(root);
    }
}

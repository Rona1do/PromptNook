use crate::models::{AppSettings, PromptModelProfile};
use rusqlite::{backup::Backup, params, Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

pub const SCHEMA_VERSION: i64 = 5;

#[derive(Debug, Clone)]
pub struct VaultPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub objects: PathBuf,
    pub thumbnails: PathBuf,
    pub backups: PathBuf,
    pub exports: PathBuf,
    pub temp: PathBuf,
}

impl VaultPaths {
    pub fn discover() -> Result<Self, String> {
        let base = if cfg!(windows) {
            std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .ok_or_else(|| "无法确定 Windows LOCALAPPDATA 目录".to_string())?
                .join("PromptNook")
        } else {
            std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|v| PathBuf::from(v).join(".local/share")))
                .ok_or_else(|| "无法确定本地数据目录".to_string())?
                .join("PromptNook")
        };
        Self::at(base.join("vault"))
    }

    #[cfg(test)]
    pub fn temporary(root: PathBuf) -> Result<Self, String> {
        Self::at(root)
    }

    fn at(root: PathBuf) -> Result<Self, String> {
        let paths = Self {
            database: root.join("prompt-vault.sqlite3"),
            objects: root.join("objects"),
            thumbnails: root.join("thumbnails"),
            backups: root.join("backups"),
            exports: root.join("exports"),
            temp: root.join("tmp"),
            root,
        };
        for directory in [
            &paths.root,
            &paths.objects,
            &paths.thumbnails,
            &paths.backups,
            &paths.exports,
            &paths.temp,
        ] {
            fs::create_dir_all(directory)
                .map_err(|e| format!("无法创建目录 {}: {e}", directory.display()))?;
        }
        Ok(paths)
    }
}

pub struct PromptVaultState {
    pub db: Mutex<Connection>,
    pub paths: VaultPaths,
    pub recovery: Mutex<Option<RecoveryMode>>,
}

#[derive(Debug, Clone)]
pub struct RecoveryMode {
    pub original_error: String,
    pub session_database: PathBuf,
}

impl PromptVaultState {
    pub fn initialize() -> Result<Self, String> {
        let paths = VaultPaths::discover()?;
        Self::initialize_at(paths)
    }

    pub fn initialize_at(paths: VaultPaths) -> Result<Self, String> {
        match initialize_live_database(&paths) {
            Ok(conn) => Ok(Self {
                db: Mutex::new(conn),
                paths,
                recovery: Mutex::new(None),
            }),
            Err(original_error) => {
                // Never rename, truncate, or overwrite the damaged database at
                // startup. A disposable healthy catalog keeps the UI available
                // so the user can inspect and restore verified snapshots.
                let session_database = paths
                    .temp
                    .join(format!("recovery-session-{}.sqlite3", uuid::Uuid::new_v4()));
                let mut conn = open_connection(&session_database).map_err(|recovery_error| {
                    format!(
                        "活库无法打开：{original_error}；恢复模式数据库也无法创建：{recovery_error}"
                    )
                })?;
                migrate(&mut conn)?;
                seed(&mut conn)?;
                if let Some(path) = read_backup_location(&paths) {
                    set_setting(&conn, "backupDirectory", Value::String(path))?;
                }
                Ok(Self {
                    db: Mutex::new(conn),
                    paths,
                    recovery: Mutex::new(Some(RecoveryMode {
                        original_error,
                        session_database,
                    })),
                })
            }
        }
    }
}

fn initialize_live_database(paths: &VaultPaths) -> Result<Connection, String> {
    let existed = paths.database.is_file()
        && paths
            .database
            .metadata()
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false);
    if existed {
        let probe = Connection::open_with_flags(&paths.database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("无法只读检查活库: {e}"))?;
        integrity_check(&probe)?;
    }
    let mut conn = open_connection(&paths.database)?;
    let current = schema_version(&conn)?;
    if existed && current > 0 && current < SCHEMA_VERSION {
        create_pre_migration_snapshot(&conn, paths, current)?;
    }
    migrate(&mut conn)?;
    seed(&mut conn)?;
    normalize_object_records(&conn, paths)?;
    integrity_check(&conn)?;
    if let Some(path) = read_backup_location(paths) {
        let database_path = setting_string(&conn, "backupDirectory")?;
        if database_path.is_empty() {
            set_setting(&conn, "backupDirectory", Value::String(path))?;
        }
    }
    Ok(conn)
}

fn schema_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| format!("无法读取数据库版本: {e}"))
}

pub fn open_connection(path: &Path) -> Result<Connection, String> {
    let conn =
        Connection::open(path).map_err(|e| format!("无法打开数据库 {}: {e}", path.display()))?;
    conn.busy_timeout(Duration::from_secs(10))
        .map_err(|e| format!("无法设置数据库等待时间: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys=ON;
         PRAGMA journal_mode=WAL;
         PRAGMA synchronous=FULL;
         PRAGMA temp_store=MEMORY;
         PRAGMA wal_autocheckpoint=1000;",
    )
    .map_err(|e| format!("无法配置数据库可靠性选项: {e}"))?;
    Ok(conn)
}

/// Collapse the WAL into the main database file. Call on idle exit and before backups.
pub fn checkpoint_wal(conn: &Connection) -> Result<(), String> {
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_row| Ok(()))
        .map_err(|e| format!("无法执行 WAL checkpoint: {e}"))
}

pub fn migrate(conn: &mut Connection) -> Result<(), String> {
    let current = schema_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(format!(
            "Database version {current} is newer than this app supports ({SCHEMA_VERSION}); upgrade PromptNook"
        ));
    }
    if current == 0 {
        let tx = conn
            .transaction()
            .map_err(|e| format!("无法开始数据库迁移: {e}"))?;
        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS categories (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL COLLATE NOCASE,
              color TEXT NOT NULL DEFAULT '#687483',
              parent_id TEXT REFERENCES categories(id),
              sort_order INTEGER NOT NULL DEFAULT 0,
              prompt_model TEXT NOT NULL DEFAULT 'general',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_live_name_parent
              ON categories(prompt_model, name, IFNULL(parent_id, '')) WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS snippets (
              id TEXT PRIMARY KEY,
              text_en TEXT NOT NULL,
              text_zh TEXT NOT NULL DEFAULT '',
              notes TEXT NOT NULL DEFAULT '',
              favorite INTEGER NOT NULL DEFAULT 0,
              rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
              usage_count INTEGER NOT NULL DEFAULT 0,
              translation_locked INTEGER NOT NULL DEFAULT 0,
              prompt_model TEXT NOT NULL DEFAULT 'general',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_snippets_live_updated ON snippets(deleted_at, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_snippets_text_en ON snippets(text_en COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_snippets_text_zh ON snippets(text_zh COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_snippets_prompt_model
              ON snippets(prompt_model) WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS snippet_categories (
              snippet_id TEXT NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
              category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
              PRIMARY KEY(snippet_id, category_id)
            );

            CREATE TABLE IF NOT EXISTS resources (
              id TEXT PRIMARY KEY,
              resource_type TEXT NOT NULL CHECK(resource_type IN ('lora','checkpoint','diffusion_model')),
              name TEXT NOT NULL,
              path TEXT NOT NULL UNIQUE,
              file_size INTEGER NOT NULL DEFAULT 0,
              modified_at TEXT NOT NULL DEFAULT '',
              online INTEGER NOT NULL DEFAULT 1,
              metadata_json TEXT NOT NULL DEFAULT '{}',
              trigger_words_json TEXT NOT NULL DEFAULT '[]',
              user_trigger_words_json TEXT NOT NULL DEFAULT '[]',
              preview_path TEXT,
              notes TEXT NOT NULL DEFAULT '',
              favorite INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_resources_type_name ON resources(resource_type, name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS assets (
              id TEXT PRIMARY KEY,
              sha256 TEXT NOT NULL UNIQUE,
              mime_type TEXT NOT NULL,
              extension TEXT NOT NULL,
              original_name TEXT NOT NULL DEFAULT '',
              object_path TEXT NOT NULL UNIQUE,
              size INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recipes (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reproducible')),
              modality TEXT NOT NULL DEFAULT 'text_to_image',
              positive_prompt TEXT NOT NULL DEFAULT '',
              negative_prompt TEXT NOT NULL DEFAULT '',
              positive_translation TEXT NOT NULL DEFAULT '',
              negative_translation TEXT NOT NULL DEFAULT '',
              model_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
              model_name TEXT,
              width INTEGER,
              height INTEGER,
              sampler TEXT,
              scheduler TEXT,
              steps INTEGER,
              cfg REAL,
              seed TEXT,
              notes TEXT NOT NULL DEFAULT '',
              favorite INTEGER NOT NULL DEFAULT 0,
              rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
              usage_count INTEGER NOT NULL DEFAULT 0,
              components_json TEXT NOT NULL DEFAULT '[]',
              loras_json TEXT NOT NULL DEFAULT '[]',
              parameters_json TEXT NOT NULL DEFAULT '{}',
              cover_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
              prompt_model TEXT NOT NULL DEFAULT 'general',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_recipes_live_updated ON recipes(deleted_at, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_recipes_prompt_model
              ON recipes(prompt_model) WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS entity_assets (
              entity_type TEXT NOT NULL CHECK(entity_type IN ('recipe','resource','snippet','tip')),
              entity_id TEXT NOT NULL,
              asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
              role TEXT NOT NULL DEFAULT 'example',
              sort_order INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(entity_type, entity_id, asset_id)
            );

            CREATE TABLE IF NOT EXISTS tips (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              content TEXT NOT NULL,
              scope_type TEXT NOT NULL DEFAULT 'global'
                CHECK(scope_type IN ('global','model','lora','category')),
              scope_id TEXT,
              favorite INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_tips_scope ON tips(scope_type, scope_id, deleted_at);

            CREATE TABLE IF NOT EXISTS revisions (
              id TEXT PRIMARY KEY,
              entity_type TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              snapshot_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_revisions_entity
              ON revisions(entity_type, entity_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS translation_cache (
              source_text TEXT NOT NULL,
              target_language TEXT NOT NULL,
              provider TEXT NOT NULL,
              translated_text TEXT NOT NULL,
              locked INTEGER NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(source_text, target_language, provider)
            );
            CREATE INDEX IF NOT EXISTS idx_translation_source
              ON translation_cache(source_text, target_language, locked DESC, updated_at DESC);

            CREATE TABLE IF NOT EXISTS glossary (
              source_text TEXT PRIMARY KEY COLLATE NOCASE,
              translated_text TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recipe_tags (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL COLLATE NOCASE,
              color TEXT NOT NULL DEFAULT '#d6578b',
              kind TEXT NOT NULL DEFAULT 'pose'
                CHECK(kind IN ('pose','general')),
              sort_order INTEGER NOT NULL DEFAULT 0,
              prompt_model TEXT NOT NULL DEFAULT 'general',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_tags_live_name
              ON recipe_tags(prompt_model, name) WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS recipe_tag_links (
              recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
              tag_id TEXT NOT NULL REFERENCES recipe_tags(id) ON DELETE CASCADE,
              PRIMARY KEY(recipe_id, tag_id)
            );

            PRAGMA user_version=5;
            "#,
        )
        .map_err(|e| format!("数据库迁移失败: {e}"))?;
        tx.commit()
            .map_err(|e| format!("无法提交数据库迁移: {e}"))?;
    } else if current == 1 {
        let tx = conn
            .transaction()
            .map_err(|e| format!("无法开始数据库迁移: {e}"))?;
        // v2 changes media-path semantics from absolute paths to paths relative
        // to the managed objects directory; normalization runs after commit.
        tx.execute_batch("PRAGMA user_version=2;")
            .map_err(|e| format!("数据库迁移失败: {e}"))?;
        tx.commit()
            .map_err(|e| format!("无法提交数据库迁移: {e}"))?;
    }

    let after = schema_version(conn)?;
    if after == 2 {
        let tx = conn
            .transaction()
            .map_err(|e| format!("无法开始数据库迁移: {e}"))?;
        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS recipe_tags (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL COLLATE NOCASE,
              color TEXT NOT NULL DEFAULT '#d6578b',
              kind TEXT NOT NULL DEFAULT 'pose'
                CHECK(kind IN ('pose','general')),
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              deleted_at TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_tags_live_name
              ON recipe_tags(name) WHERE deleted_at IS NULL;

            CREATE TABLE IF NOT EXISTS recipe_tag_links (
              recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
              tag_id TEXT NOT NULL REFERENCES recipe_tags(id) ON DELETE CASCADE,
              PRIMARY KEY(recipe_id, tag_id)
            );

            PRAGMA user_version=3;
            "#,
        )
        .map_err(|e| format!("数据库迁移失败: {e}"))?;
        tx.commit()
            .map_err(|e| format!("无法提交数据库迁移: {e}"))?;
    }

    let after = schema_version(conn)?;
    if after == 3 {
        migrate_to_v4(conn)?;
    }
    let after = schema_version(conn)?;
    if after == 4 {
        migrate_to_v5(conn)?;
    }
    Ok(())
}

/// v4: each user-defined workspace owns an independent prompt set.
fn migrate_to_v4(conn: &mut Connection) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始数据库迁移: {e}"))?;

    // SQLite may already have these columns if the live schema was created at v4.
    // Run each ALTER separately so a single "duplicate column" does not abort the rest.
    for statement in [
        "ALTER TABLE recipes ADD COLUMN prompt_model TEXT NOT NULL DEFAULT 'general'",
        "ALTER TABLE snippets ADD COLUMN prompt_model TEXT NOT NULL DEFAULT 'general'",
        "ALTER TABLE categories ADD COLUMN prompt_model TEXT NOT NULL DEFAULT 'general'",
        "ALTER TABLE recipe_tags ADD COLUMN prompt_model TEXT NOT NULL DEFAULT 'general'",
    ] {
        let _ = tx.execute_batch(statement);
    }

    tx.execute_batch(
        r#"
        UPDATE recipes SET prompt_model='general' WHERE IFNULL(prompt_model,'')='';
        UPDATE snippets SET prompt_model='general' WHERE IFNULL(prompt_model,'')='';
        UPDATE categories SET prompt_model='general' WHERE IFNULL(prompt_model,'')='';
        UPDATE recipe_tags SET prompt_model='general' WHERE IFNULL(prompt_model,'')='';

        DROP INDEX IF EXISTS idx_categories_live_name_parent;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_live_name_parent
          ON categories(prompt_model, name, IFNULL(parent_id, '')) WHERE deleted_at IS NULL;

        DROP INDEX IF EXISTS idx_recipe_tags_live_name;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_tags_live_name
          ON recipe_tags(prompt_model, name) WHERE deleted_at IS NULL;

        CREATE INDEX IF NOT EXISTS idx_recipes_prompt_model
          ON recipes(prompt_model) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_snippets_prompt_model
          ON snippets(prompt_model) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_categories_prompt_model
          ON categories(prompt_model) WHERE deleted_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_recipe_tags_prompt_model
          ON recipe_tags(prompt_model) WHERE deleted_at IS NULL;
        "#,
    )
    .map_err(|e| format!("数据库迁移失败: {e}"))?;

    // Migrate legacy prefix/negative into per-model defaults map.
    let legacy_prefix = setting_string(&tx, "universalPrefix").unwrap_or_default();
    let legacy_negative = setting_string(&tx, "defaultNegative").unwrap_or_default();
    let defaults = serde_json::json!({
        "general": {
            "defaultPrefix": if legacy_prefix.is_empty() {
                "masterpiece, best quality, highly detailed"
            } else {
                legacy_prefix.as_str()
            },
            "defaultNegative": if legacy_negative.is_empty() {
                "blurry, low quality, deformed hands, extra fingers, watermark"
            } else {
                legacy_negative.as_str()
            }
        }
    });
    set_setting(&tx, "promptModelDefaults", defaults)?;
    set_setting(&tx, "activePromptModel", Value::String("general".into()))?;

    tx.execute_batch("PRAGMA user_version=4;")
        .map_err(|e| format!("数据库迁移失败: {e}"))?;
    tx.commit()
        .map_err(|e| format!("无法提交数据库迁移: {e}"))?;
    Ok(())
}

/// v5 is retained as a compatibility boundary for older databases.
fn migrate_to_v5(conn: &mut Connection) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始数据库迁移: {e}"))?;

    tx.execute_batch("PRAGMA user_version=5;")
        .map_err(|e| format!("数据库迁移失败: {e}"))?;
    tx.commit()
        .map_err(|e| format!("无法提交数据库迁移: {e}"))?;
    Ok(())
}

fn seed(conn: &mut Connection) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始初始化数据事务: {e}"))?;
    let now = now();
    let categories = [
        ("cat-subject", "Subject", "#5d5fef"),
        ("cat-appearance", "Appearance", "#8a5cf5"),
        ("cat-action", "Action", "#ec9d2d"),
        ("cat-scene", "Scene", "#35a27f"),
        ("cat-composition", "Composition", "#2c91b8"),
        ("cat-camera", "Camera", "#5178dc"),
        ("cat-light", "Lighting", "#8c6dcc"),
        ("cat-style", "Style", "#bd5f9a"),
        ("cat-quality", "Quality", "#687483"),
        ("cat-negative", "Negative", "#d05454"),
    ];
    for (index, (id, name, color)) in categories.iter().enumerate() {
        tx.execute(
            "INSERT OR IGNORE INTO categories
             (id,name,color,parent_id,sort_order,created_at,updated_at)
             VALUES (?1,?2,?3,NULL,?4,?5,?5)",
            params![id, name, color, index as i64, now],
        )
        .map_err(|e| format!("无法初始化分类: {e}"))?;
    }
    let recipe_tags = [
        ("tag-portrait", "Portrait", "#d6578b", 0),
        ("tag-character", "Character", "#ef7a51", 1),
        ("tag-product", "Product", "#ec9d2d", 2),
        ("tag-landscape", "Landscape", "#35a27f", 3),
        ("tag-illustration", "Illustration", "#8a5cf5", 4),
        ("tag-photography", "Photography", "#2c91b8", 5),
        ("tag-3d", "3D", "#5178dc", 6),
        ("tag-architecture", "Architecture", "#8c6dcc", 7),
        ("tag-other", "Other", "#9aa3b5", 8),
    ];
    for (id, name, color, order) in recipe_tags {
        tx.execute(
            "INSERT OR IGNORE INTO recipe_tags
             (id,name,color,kind,sort_order,prompt_model,created_at,updated_at)
             VALUES (?1,?2,?3,'general',?4,'general',?5,?5)",
            params![id, name, color, order, now],
        )
        .map_err(|e| format!("Could not initialize recipe tags: {e}"))?;
    }
    let model_defaults = serde_json::json!({
        "general": {
            "defaultPrefix": "masterpiece, best quality, highly detailed",
            "defaultNegative": "blurry, low quality, deformed hands, extra fingers, watermark"
        }
    });
    let prompt_models = serde_json::json!([{
        "id": "general",
        "name": "General",
        "description": "General-purpose prompt workspace"
    }]);
    let defaults = [
        ("loraDirectory", Value::String(String::new())),
        ("checkpointDirectory", Value::String(String::new())),
        ("diffusionModelDirectory", Value::String(String::new())),
        ("backupDirectory", Value::String(String::new())),
        ("translationProvider", Value::String("builtin".into())),
        ("translationEndpoint", Value::String(String::new())),
        ("translationModel", Value::String(String::new())),
        ("onlineTranslationEnabled", Value::Bool(false)),
        ("translationTargetLanguage", Value::String("en".into())),
        ("privacyMode", Value::Bool(false)),
        ("promptModels", prompt_models),
        ("activePromptModel", Value::String("general".into())),
        ("promptModelDefaults", model_defaults),
        (
            "universalPrefix",
            Value::String("masterpiece, best quality, highly detailed".into()),
        ),
        (
            "defaultNegative",
            Value::String("blurry, low quality, deformed hands, extra fingers, watermark".into()),
        ),
    ];
    for (key, value) in defaults {
        tx.execute(
            "INSERT OR IGNORE INTO settings(key,value_json,updated_at) VALUES (?1,?2,?3)",
            params![key, value.to_string(), now],
        )
        .map_err(|e| format!("无法初始化设置: {e}"))?;
    }
    tx.commit().map_err(|e| format!("无法提交初始化数据: {e}"))
}

pub fn integrity_check(conn: &Connection) -> Result<(), String> {
    let result: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("数据库完整性检查失败: {e}"))?;
    if result != "ok" {
        return Err(format!("数据库完整性检查未通过: {result}"));
    }
    let fk_violations: i64 = conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .map_err(|e| format!("外键检查失败: {e}"))?;
    if fk_violations != 0 {
        return Err(format!("数据库存在 {fk_violations} 个外键错误"));
    }
    Ok(())
}

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn setting_value(conn: &Connection, key: &str) -> Result<Option<Value>, String> {
    let text: Option<String> = conn
        .query_row(
            "SELECT value_json FROM settings WHERE key=?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("无法读取设置 {key}: {e}"))?;
    text.map(|s| serde_json::from_str(&s).map_err(|e| format!("设置 {key} 的数据无效: {e}")))
        .transpose()
}

pub fn setting_string(conn: &Connection, key: &str) -> Result<String, String> {
    Ok(setting_value(conn, key)?
        .and_then(|v| v.as_str().map(ToOwned::to_owned))
        .unwrap_or_default())
}

pub fn setting_bool(conn: &Connection, key: &str) -> Result<bool, String> {
    Ok(setting_value(conn, key)?
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

pub fn set_setting(conn: &Connection, key: &str, value: Value) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings(key,value_json,updated_at) VALUES (?1,?2,?3)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        params![key, value.to_string(), now()],
    )
    .map_err(|e| format!("无法保存设置 {key}: {e}"))?;
    Ok(())
}

fn create_pre_migration_snapshot(
    source: &Connection,
    paths: &VaultPaths,
    from_version: i64,
) -> Result<(), String> {
    let directory = paths.root.join("pre-migration");
    fs::create_dir_all(&directory).map_err(|e| format!("无法创建迁移前快照目录: {e}"))?;
    let target = directory.join(format!(
        "{}-v{}-to-v{}-{}.sqlite3",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        from_version,
        SCHEMA_VERSION,
        &uuid::Uuid::new_v4().to_string()[..8]
    ));
    let mut destination =
        Connection::open(&target).map_err(|e| format!("无法创建迁移前快照: {e}"))?;
    {
        let backup = Backup::new(source, &mut destination)
            .map_err(|e| format!("无法开始迁移前快照: {e}"))?;
        backup
            .run_to_completion(128, Duration::from_millis(5), None)
            .map_err(|e| format!("迁移前快照失败: {e}"))?;
    }
    integrity_check(&destination).map_err(|e| format!("迁移前快照校验失败，已取消迁移: {e}"))
}

fn normalize_object_records(conn: &Connection, paths: &VaultPaths) -> Result<(), String> {
    let mut statement = conn
        .prepare("SELECT id,sha256,extension,object_path FROM assets")
        .map_err(|e| format!("无法读取媒体路径: {e}"))?;
    let records = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("无法读取媒体路径: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取媒体路径: {e}"))?;
    drop(statement);
    for (id, sha256, extension, stored) in records {
        validate_object_identity(&sha256, &extension)?;
        let expected_relative = format!("{}/{}.{}", &sha256[..2], &sha256[2..], extension);
        let stored_path = PathBuf::from(&stored);
        if stored_path.is_absolute() {
            let expected = paths.objects.join(&expected_relative);
            if !same_path(&stored_path, &expected) {
                return Err(format!("媒体记录 {} 指向受管目录之外，已进入恢复模式", id));
            }
            conn.execute(
                "UPDATE assets SET object_path=?2 WHERE id=?1",
                params![id, expected_relative],
            )
            .map_err(|e| format!("无法迁移媒体相对路径: {e}"))?;
        } else if stored.replace('\\', "/") != expected_relative {
            return Err(format!("媒体记录 {id} 包含非法相对路径"));
        }
    }
    Ok(())
}

pub fn validate_object_identity(sha256: &str, extension: &str) -> Result<(), String> {
    if sha256.len() != 64 || !sha256.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err("媒体 SHA-256 无效".into());
    }
    if !matches!(extension, "png" | "jpg" | "webp" | "gif") {
        return Err(format!("不允许的媒体扩展名: {extension}"));
    }
    Ok(())
}

pub fn resolve_object_path(
    paths: &VaultPaths,
    sha256: &str,
    extension: &str,
    stored: &str,
) -> Result<PathBuf, String> {
    validate_object_identity(sha256, extension)?;
    let expected_relative = format!("{}/{}.{}", &sha256[..2], &sha256[2..], extension);
    if stored.replace('\\', "/") != expected_relative {
        return Err("媒体对象路径与内容哈希不一致".into());
    }
    let candidate = paths.objects.join(&expected_relative);
    if !candidate.starts_with(&paths.objects) {
        return Err("媒体对象路径越界".into());
    }
    Ok(candidate)
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

pub fn persist_backup_location(paths: &VaultPaths, value: &str) -> Result<(), String> {
    let destination = paths.root.join("backup-location.json");
    let temporary = paths
        .temp
        .join(format!("backup-location-{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(&serde_json::json!({ "backupDirectory": value }))
        .map_err(|e| format!("无法保存恢复配置: {e}"))?;
    fs::write(&temporary, bytes).map_err(|e| format!("无法写入恢复配置: {e}"))?;
    let previous = paths
        .temp
        .join(format!("backup-location-{}.previous", uuid::Uuid::new_v4()));
    if destination.exists() {
        fs::rename(&destination, &previous).map_err(|e| format!("无法暂存旧恢复配置: {e}"))?;
    }
    match fs::rename(&temporary, &destination) {
        Ok(()) => {
            let _ = fs::remove_file(previous);
            Ok(())
        }
        Err(error) => {
            if previous.exists() {
                let _ = fs::rename(previous, destination);
            }
            Err(format!("无法提交恢复配置，已回滚: {error}"))
        }
    }
}

pub fn read_backup_location(paths: &VaultPaths) -> Option<String> {
    let bytes = fs::read(paths.root.join("backup-location.json")).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("backupDirectory")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

pub fn normalize_prompt_model(value: &str) -> String {
    let mut key = String::new();
    let mut separator = false;
    for ch in value.trim().to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            if separator && !key.is_empty() {
                key.push('-');
            }
            key.push(ch);
            separator = false;
        } else {
            separator = true;
        }
    }
    if key.is_empty() {
        "general".into()
    } else {
        key
    }
}

pub fn active_prompt_model(conn: &Connection) -> Result<String, String> {
    Ok(normalize_prompt_model(&setting_string(
        conn,
        "activePromptModel",
    )?))
}

fn prompt_model_defaults_map(conn: &Connection) -> Result<Value, String> {
    match setting_value(conn, "promptModelDefaults")? {
        Some(Value::Object(map)) if !map.is_empty() => Ok(Value::Object(map)),
        _ => {
            let legacy_prefix = setting_string(conn, "universalPrefix")?;
            let legacy_negative = setting_string(conn, "defaultNegative")?;
            Ok(serde_json::json!({
                "general": {
                    "defaultPrefix": if legacy_prefix.is_empty() {
                        "masterpiece, best quality, highly detailed"
                    } else {
                        legacy_prefix.as_str()
                    },
                    "defaultNegative": if legacy_negative.is_empty() {
                        "blurry, low quality, deformed hands, extra fingers, watermark"
                    } else {
                        legacy_negative.as_str()
                    }
                }
            }))
        }
    }
}

fn model_default_field(map: &Value, model: &str, field: &str, fallback: &str) -> String {
    map.get(model)
        .and_then(|entry| entry.get(field))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

pub fn get_app_settings(conn: &Connection) -> Result<AppSettings, String> {
    let active = active_prompt_model(conn)?;
    let mut prompt_models: Vec<PromptModelProfile> = setting_value(conn, "promptModels")?
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_else(|| {
            vec![PromptModelProfile {
                id: active.clone(),
                name: if active == "general" {
                    "General".into()
                } else {
                    active.clone()
                },
                description: String::new(),
            }]
        });
    if !prompt_models.iter().any(|profile| profile.id == active) {
        prompt_models.push(PromptModelProfile {
            id: active.clone(),
            name: active.clone(),
            description: "Imported workspace".into(),
        });
    }
    let defaults = prompt_model_defaults_map(conn)?;
    let default_prefix = model_default_field(
        &defaults,
        &active,
        "defaultPrefix",
        "masterpiece, best quality",
    );
    let default_negative = model_default_field(
        &defaults,
        &active,
        "defaultNegative",
        "blurry, low quality, deformed hands, extra fingers, watermark",
    );
    Ok(AppSettings {
        lora_path: setting_string(conn, "loraDirectory")?,
        checkpoint_path: setting_string(conn, "checkpointDirectory")?,
        diffusion_model_path: setting_string(conn, "diffusionModelDirectory")?,
        backup_path: setting_string(conn, "backupDirectory")?,
        translation_provider: match setting_string(conn, "translationProvider")?.as_str() {
            "builtin" => "off".into(),
            value => value.to_string(),
        },
        translation_endpoint: setting_string(conn, "translationEndpoint")?,
        translation_model: setting_string(conn, "translationModel")?,
        online_translation_enabled: setting_bool(conn, "onlineTranslationEnabled")?,
        translation_target_language: {
            let value = setting_string(conn, "translationTargetLanguage")?;
            if value.is_empty() {
                "en".into()
            } else {
                value
            }
        },
        privacy_mode: setting_bool(conn, "privacyMode")?,
        prompt_models,
        active_prompt_model: active,
        default_prefix,
        default_negative,
    })
}

/// Persist defaultPrefix / defaultNegative into the active model's slot.
pub fn upsert_active_model_defaults(
    conn: &Connection,
    default_prefix: Option<String>,
    default_negative: Option<String>,
) -> Result<(), String> {
    if default_prefix.is_none() && default_negative.is_none() {
        return Ok(());
    }
    let active = active_prompt_model(conn)?;
    let mut map = prompt_model_defaults_map(conn)?;
    let entry = map
        .as_object_mut()
        .ok_or_else(|| "模型默认 Prompt 配置损坏".to_string())?
        .entry(active.clone())
        .or_insert_with(|| {
            serde_json::json!({
                "defaultPrefix": "",
                "defaultNegative": ""
            })
        });
    if let Some(prefix) = default_prefix {
        entry
            .as_object_mut()
            .ok_or_else(|| "模型默认 Prompt 配置损坏".to_string())?
            .insert("defaultPrefix".into(), Value::String(prefix.clone()));
        // Keep legacy keys in sync for older readers / recovery.
        if active == "general" {
            set_setting(conn, "universalPrefix", Value::String(prefix))?;
        }
    }
    if let Some(negative) = default_negative {
        entry
            .as_object_mut()
            .ok_or_else(|| "模型默认 Prompt 配置损坏".to_string())?
            .insert("defaultNegative".into(), Value::String(negative.clone()));
        if active == "general" {
            set_setting(conn, "defaultNegative", Value::String(negative))?;
        }
    }
    set_setting(conn, "promptModelDefaults", map)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn initializes_reliable_database_and_seed_data() {
        let root = std::env::temp_dir().join(format!("promptnook-db-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths).unwrap();
        {
            let conn = state.db.lock().unwrap();
            let journal: String = conn
                .query_row("PRAGMA journal_mode", [], |row| row.get(0))
                .unwrap();
            let synchronous: i64 = conn
                .query_row("PRAGMA synchronous", [], |row| row.get(0))
                .unwrap();
            let foreign_keys: i64 = conn
                .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
                .unwrap();
            let categories: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM categories WHERE deleted_at IS NULL",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(journal.to_ascii_lowercase(), "wal");
            assert_eq!(synchronous, 2);
            assert_eq!(foreign_keys, 1);
            assert_eq!(categories, 10);
            assert!(get_app_settings(&conn).unwrap().lora_path.is_empty());
            integrity_check(&conn).unwrap();
        }
        drop(state);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupted_live_database_enters_non_destructive_recovery_mode() {
        let root = std::env::temp_dir().join(format!("promptnook-recovery-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let damaged = b"not a sqlite database; preserve me";
        fs::write(&paths.database, damaged).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        assert!(state.recovery.lock().unwrap().is_some());
        assert_eq!(fs::read(&paths.database).unwrap(), damaged);
        assert_eq!(
            state
                .db
                .lock()
                .unwrap()
                .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        drop(state);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn object_paths_are_hash_derived_and_cannot_escape() {
        let root = std::env::temp_dir().join(format!("promptnook-path-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let sha = "a".repeat(64);
        let resolved =
            resolve_object_path(&paths, &sha, "png", &format!("aa/{}.png", &sha[2..])).unwrap();
        assert!(resolved.starts_with(&paths.objects));
        assert!(resolve_object_path(&paths, &sha, "exe", "aa/file.exe").is_err());
        assert!(resolve_object_path(&paths, &sha, "png", "../escape.png").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn existing_database_is_snapshotted_before_schema_upgrade() {
        let root = std::env::temp_dir().join(format!("promptnook-migrate-{}", Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        state
            .db
            .lock()
            .unwrap()
            .execute_batch("PRAGMA user_version=1; PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        drop(state);
        let upgraded = PromptVaultState::initialize_at(paths.clone()).unwrap();
        let version: i64 = upgraded
            .db
            .lock()
            .unwrap()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert!(fs::read_dir(paths.root.join("pre-migration"))
            .unwrap()
            .any(
                |entry| entry.unwrap().path().extension().and_then(|v| v.to_str())
                    == Some("sqlite3")
            ));
        drop(upgraded);
        let _ = fs::remove_dir_all(root);
    }
}

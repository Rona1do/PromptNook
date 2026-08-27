use crate::{
    db::{
        active_prompt_model, get_app_settings, normalize_prompt_model, now,
        persist_backup_location, resolve_object_path, set_setting, upsert_active_model_defaults,
        PromptVaultState, VaultPaths,
    },
    models::*,
    storage::{collect_orphan_assets, media_data_url, AssetEmbed},
    translation,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

fn json_string<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("无法序列化数据: {e}"))
}

fn parse_json<T: serde::de::DeserializeOwned + Default>(text: String) -> T {
    serde_json::from_str(&text).unwrap_or_default()
}

fn normalized_limit(options: &ListOptions) -> usize {
    // limit=0 or omitted → load everything (vault UI needs full lists;
    // a silent default of 500 made older snippets "disappear" from the UI).
    match options.limit {
        None | Some(0) => usize::MAX,
        Some(n) if n < 0 => usize::MAX,
        Some(n) => (n as usize).clamp(1, 50_000),
    }
}

fn add_revision<T: Serialize>(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    snapshot: &T,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO revisions(id,entity_type,entity_id,snapshot_json,created_at)
         VALUES (?1,?2,?3,?4,?5)",
        params![
            Uuid::new_v4().to_string(),
            entity_type,
            entity_id,
            json_string(snapshot)?,
            now()
        ],
    )
    .map_err(|e| format!("无法保存修改历史: {e}"))?;
    Ok(())
}

fn asset_from_row(
    row: &Row<'_>,
    paths: Option<&VaultPaths>,
    embed: AssetEmbed,
) -> rusqlite::Result<Asset> {
    let mime_type: String = row.get(2)?;
    let sha256: String = row.get(1)?;
    let stored_path: String = row.get(6)?;
    let extension: String = row.get(7)?;
    let url = if embed == AssetEmbed::None {
        String::new()
    } else if let Some(paths) = paths {
        resolve_object_path(paths, &sha256, &extension, &stored_path)
            .ok()
            .and_then(|object_path| {
                media_data_url(paths, &object_path, &sha256, &mime_type, embed).ok()
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(Asset {
        id: row.get::<_, String>(0)?,
        name: row.get(3)?,
        sha256,
        mime_type,
        url,
        size: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn assets_for_entity_with_embed(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    paths: Option<&VaultPaths>,
    embed: AssetEmbed,
) -> Result<Vec<Asset>, String> {
    let mut statement = conn
        .prepare(
            "SELECT a.id,a.sha256,a.mime_type,a.original_name,a.size,
                    a.created_at,a.object_path,a.extension
             FROM entity_assets ea JOIN assets a ON a.id=ea.asset_id
             WHERE ea.entity_type=?1 AND ea.entity_id=?2
             ORDER BY ea.sort_order,a.created_at",
        )
        .map_err(|e| format!("无法读取图片: {e}"))?;
    let result = statement
        .query_map(params![entity_type, entity_id], |row| {
            asset_from_row(row, paths, embed)
        })
        .map_err(|e| format!("无法读取图片: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取图片: {e}"));
    result
}

fn recipe_from_row(row: &Row<'_>) -> rusqlite::Result<Recipe> {
    Ok(Recipe {
        id: row.get(0)?,
        title: row.get(1)?,
        status: row.get(2)?,
        modality: row.get(3)?,
        positive_prompt: row.get(4)?,
        negative_prompt: row.get(5)?,
        positive_translation: row.get(6)?,
        negative_translation: row.get(7)?,
        model_id: row.get(8)?,
        model_name: row.get(9)?,
        params: GenerationParams {
            width: row.get(10)?,
            height: row.get(11)?,
            sampler: row.get(12)?,
            scheduler: row.get(13)?,
            steps: row.get(14)?,
            cfg: row.get(15)?,
            seed: row.get(16)?,
        },
        notes: row.get(17)?,
        favorite: row.get::<_, i64>(18)? != 0,
        rating: row.get(19)?,
        usage_count: row.get(20)?,
        loras: parse_json(row.get(21)?),
        cover_asset_id: row.get(22)?,
        assets: Vec::new(),
        tag_ids: Vec::new(),
        prompt_model: row
            .get::<_, String>(25)
            .unwrap_or_else(|_| "general".into()),
        created_at: row.get(23)?,
        updated_at: row.get(24)?,
    })
}

fn resolve_list_prompt_model(conn: &Connection, options: &ListOptions) -> Result<String, String> {
    if let Some(model) = options
        .prompt_model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(normalize_prompt_model(model));
    }
    active_prompt_model(conn)
}

fn resolve_entity_prompt_model(
    conn: &Connection,
    requested: Option<&str>,
    existing: Option<&str>,
) -> Result<String, String> {
    if let Some(model) = requested.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(normalize_prompt_model(model));
    }
    if let Some(model) = existing.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(normalize_prompt_model(model));
    }
    active_prompt_model(conn)
}

fn tag_ids_for_recipe(conn: &Connection, recipe_id: &str) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare("SELECT tag_id FROM recipe_tag_links WHERE recipe_id=?1 ORDER BY tag_id")
        .map_err(|e| format!("Could not read recipe tags: {e}"))?;
    let rows = statement
        .query_map([recipe_id], |row| row.get(0))
        .map_err(|e| format!("Could not read recipe tags: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read recipe tags: {e}"))?;
    Ok(rows)
}

const RECIPE_SELECT: &str = "SELECT id,title,status,modality,positive_prompt,negative_prompt,
            positive_translation,negative_translation,model_id,model_name,width,height,sampler,
            scheduler,steps,cfg,seed,notes,favorite,rating,usage_count,loras_json,
            cover_asset_id,created_at,updated_at,prompt_model
     FROM recipes";

pub fn find_recipe(
    conn: &Connection,
    id: &str,
    include_deleted: bool,
    paths: Option<&VaultPaths>,
) -> Result<Option<Recipe>, String> {
    find_recipe_with_embed(conn, id, include_deleted, paths, AssetEmbed::Thumbnail)
}

pub fn find_recipe_with_embed(
    conn: &Connection,
    id: &str,
    include_deleted: bool,
    paths: Option<&VaultPaths>,
    embed: AssetEmbed,
) -> Result<Option<Recipe>, String> {
    let sql = format!(
        "{RECIPE_SELECT} WHERE id=?1 {}",
        if include_deleted {
            ""
        } else {
            "AND deleted_at IS NULL"
        }
    );
    let mut recipe = conn
        .query_row(&sql, [id], recipe_from_row)
        .optional()
        .map_err(|e| format!("无法读取总 Prompt: {e}"))?;
    if let Some(item) = recipe.as_mut() {
        item.assets = assets_for_entity_with_embed(conn, "recipe", &item.id, paths, embed)?;
        item.tag_ids = tag_ids_for_recipe(conn, &item.id)?;
    }
    Ok(recipe)
}

pub fn list_recipes_inner(
    conn: &Connection,
    options: &ListOptions,
    paths: Option<&VaultPaths>,
) -> Result<Vec<Recipe>, String> {
    // Search and dashboards only need metadata; full UI lists still use thumbnails.
    let embed = if paths.is_some() {
        AssetEmbed::Thumbnail
    } else {
        AssetEmbed::None
    };
    list_recipes_with_embed(conn, options, paths, embed)
}

pub fn list_recipes_with_embed(
    conn: &Connection,
    options: &ListOptions,
    paths: Option<&VaultPaths>,
    embed: AssetEmbed,
) -> Result<Vec<Recipe>, String> {
    let prompt_model = resolve_list_prompt_model(conn, options)?;
    let sql = format!(
        "{RECIPE_SELECT} WHERE {} AND prompt_model=?1 ORDER BY favorite DESC, updated_at DESC",
        if options.include_deleted {
            "1=1"
        } else {
            "deleted_at IS NULL"
        }
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|e| format!("无法读取总 Prompt: {e}"))?;
    let mut recipes = statement
        .query_map([&prompt_model], recipe_from_row)
        .map_err(|e| format!("无法读取总 Prompt: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取总 Prompt: {e}"))?;
    let query = options.query.as_deref().unwrap_or("").trim().to_lowercase();
    recipes.retain(|item| {
        (query.is_empty()
            || [
                &item.title,
                &item.positive_prompt,
                &item.negative_prompt,
                &item.positive_translation,
                &item.negative_translation,
                &item.notes,
            ]
            .iter()
            .any(|text| text.to_lowercase().contains(&query)))
            && options.favorite.map(|v| item.favorite == v).unwrap_or(true)
    });
    // Attach media only for the page slice so a large vault does not decode every thumbnail.
    let offset = options.offset.unwrap_or(0).max(0) as usize;
    let limit = normalized_limit(options);
    let end = offset.saturating_add(limit).min(recipes.len());
    let start = offset.min(end);
    for item in &mut recipes[start..end] {
        item.assets = assets_for_entity_with_embed(conn, "recipe", &item.id, paths, embed)?;
        item.tag_ids = tag_ids_for_recipe(conn, &item.id)?;
    }
    // Tags for off-page rows still load (tiny) so client-side filters stay accurate.
    for (index, item) in recipes.iter_mut().enumerate() {
        if index >= start && index < end {
            continue;
        }
        item.tag_ids = tag_ids_for_recipe(conn, &item.id)?;
    }
    Ok(recipes.into_iter().skip(offset).take(limit).collect())
}

#[tauri::command]
pub fn list_recipes(
    state: State<'_, PromptVaultState>,
    options: Option<ListOptions>,
) -> Result<Vec<Recipe>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    list_recipes_inner(&conn, &options.unwrap_or_default(), Some(&state.paths))
}

#[tauri::command]
pub fn get_recipe(
    state: State<'_, PromptVaultState>,
    id: String,
) -> Result<Option<Recipe>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    find_recipe(&conn, &id, false, Some(&state.paths))
}

fn validate_recipe_input(input: &SaveRecipeInput) -> Result<(), String> {
    if input.status != "draft" && input.status != "reproducible" {
        return Err("状态只能是 draft 或 reproducible".into());
    }
    if input.modality != "text_to_image" && input.modality != "image_to_video" {
        return Err("不支持的创作类型".into());
    }
    // 可复现：只要有正向 Prompt 即可。尺寸/采样器/步数/CFG 对很多用户是全局统一设置，
    // 允许留空，不在每条总 Prompt 上强制填写。
    if input.status == "reproducible" && input.positive_prompt.trim().is_empty() {
        return Err("可复现配方至少需要正向 Prompt".into());
    }
    if !(0..=5).contains(&input.rating) {
        return Err("评分必须在 0 到 5 之间".into());
    }
    Ok(())
}

fn first_prompt_fragment(source: &str) -> String {
    let mut fragment = String::new();
    let mut brackets = Vec::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for character in source.chars() {
        if escaped {
            fragment.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            fragment.push(character);
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            fragment.push(character);
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '"' | '\'') {
            quote = Some(character);
            fragment.push(character);
            continue;
        }
        match character {
            '(' | '[' | '{' => {
                brackets.push(character);
                fragment.push(character);
            }
            ')' | ']' | '}' => {
                if brackets.last().is_some_and(|opening| {
                    matches!((*opening, character), ('(', ')') | ('[', ']') | ('{', '}'))
                }) {
                    brackets.pop();
                }
                fragment.push(character);
            }
            ',' | '，' | ';' | '；' | '\n' | '\r' if brackets.is_empty() => break,
            _ => fragment.push(character),
        }
    }

    fragment.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn derive_recipe_title(title: &str, positive_prompt: &str, timestamp: &str) -> String {
    let explicit = title.trim();
    if !explicit.is_empty() {
        return explicit.to_string();
    }

    let prompt_title = first_prompt_fragment(positive_prompt);
    if !prompt_title.is_empty() {
        const MAX_CHARACTERS: usize = 48;
        let mut characters = prompt_title.chars();
        let shortened: String = characters.by_ref().take(MAX_CHARACTERS).collect();
        return if characters.next().is_some() {
            format!("{shortened}…")
        } else {
            shortened
        };
    }

    let date = timestamp.get(..10).unwrap_or("未知日期");
    format!("未命名 Prompt · {date}")
}

#[tauri::command]
pub fn save_recipe(
    state: State<'_, PromptVaultState>,
    input: SaveRecipeInput,
) -> Result<Recipe, String> {
    // 总 Prompt 不强制自动翻译（长文调用慢，由用户手动点翻译）。
    save_recipe_inner(&state, input)
}

fn recipe_needs_translation(source: &str, translation: &str) -> bool {
    !source.trim().is_empty() && translation.trim().is_empty()
}

fn append_translate_debug_log(state: &PromptVaultState, message: &str) -> Result<(), String> {
    use std::io::Write;
    let path = state.paths.root.join("translate-debug.log");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("无法写翻译日志: {e}"))?;
    let line = format!("{}  {}\n", now(), message);
    file.write_all(line.as_bytes())
        .map_err(|e| format!("无法写翻译日志: {e}"))
}

fn save_recipe_inner(state: &PromptVaultState, input: SaveRecipeInput) -> Result<Recipe, String> {
    validate_recipe_input(&input)?;
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut asset_ids = HashSet::new();
    for asset in &input.assets {
        if !asset_ids.insert(asset.id.as_str()) {
            return Err(format!("示例图 {} 被重复添加", asset.id));
        }
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE id=?1)",
                [&asset.id],
                |row| row.get(0),
            )
            .map_err(|e| format!("无法验证示例图: {e}"))?;
        if !exists {
            return Err(format!("示例图 {} 不存在，配方未保存", asset.id));
        }
    }
    if let Some(cover_id) = input.cover_asset_id.as_ref() {
        if !asset_ids.contains(cover_id.as_str()) {
            return Err("封面必须来自当前配方的示例图列表".into());
        }
    }
    let id = input
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = find_recipe(&conn, &id, true, None)?;
    let prompt_model = resolve_entity_prompt_model(
        &conn,
        input.prompt_model.as_deref(),
        existing.as_ref().map(|item| item.prompt_model.as_str()),
    )?;
    let timestamp = now();
    let title = derive_recipe_title(&input.title, &input.positive_prompt, &timestamp);
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始保存事务: {e}"))?;
    if let Some(snapshot) = existing.as_ref() {
        add_revision(&tx, "recipe", &id, snapshot)?;
    }
    tx.execute(
        "INSERT INTO recipes(
           id,title,status,modality,positive_prompt,negative_prompt,
           positive_translation,negative_translation,model_id,model_name,width,height,sampler,
           scheduler,steps,cfg,seed,notes,favorite,rating,usage_count,components_json,loras_json,
           parameters_json,cover_asset_id,prompt_model,created_at,updated_at,deleted_at
         ) VALUES (
           ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,
           ?18,?19,?20,?21,'[]',?22,?23,?24,?25,?26,?27,NULL
         )
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title,status=excluded.status,modality=excluded.modality,
           positive_prompt=excluded.positive_prompt,negative_prompt=excluded.negative_prompt,
           positive_translation=excluded.positive_translation,
           negative_translation=excluded.negative_translation,model_id=excluded.model_id,
           model_name=excluded.model_name,
           width=excluded.width,height=excluded.height,sampler=excluded.sampler,
           scheduler=excluded.scheduler,steps=excluded.steps,cfg=excluded.cfg,seed=excluded.seed,
           notes=excluded.notes,favorite=excluded.favorite,rating=excluded.rating,
           usage_count=excluded.usage_count,components_json=excluded.components_json,loras_json=excluded.loras_json,
           parameters_json=excluded.parameters_json,cover_asset_id=excluded.cover_asset_id,
           prompt_model=excluded.prompt_model,
           updated_at=excluded.updated_at,deleted_at=NULL",
        params![
            id,
            title,
            input.status,
            input.modality,
            input.positive_prompt,
            input.negative_prompt,
            input.positive_translation,
            input.negative_translation,
            input.model_id,
            input.model_name,
            input.params.width,
            input.params.height,
            input.params.sampler,
            input.params.scheduler,
            input.params.steps,
            input.params.cfg,
            input.params.seed,
            input.notes,
            input.favorite as i64,
            input.rating,
            input.usage_count,
            json_string(&input.loras)?,
            json_string(&input.params)?,
            input.cover_asset_id,
            prompt_model.as_str(),
            existing
                .as_ref()
                .map(|v| v.created_at.as_str())
                .unwrap_or(timestamp.as_str()),
            timestamp
        ],
    )
    .map_err(|e| format!("无法保存总 Prompt: {e}"))?;
    tx.execute(
        "DELETE FROM entity_assets WHERE entity_type='recipe' AND entity_id=?1",
        [&id],
    )
    .map_err(|e| format!("无法更新示例图: {e}"))?;
    for (sort_order, asset) in input.assets.iter().enumerate() {
        tx.execute(
            "INSERT INTO entity_assets(entity_type,entity_id,asset_id,role,sort_order)
             SELECT 'recipe',?1,id,?3,?4 FROM assets WHERE id=?2",
            params![
                id,
                asset.id,
                if input.cover_asset_id.as_ref() == Some(&asset.id) {
                    "cover"
                } else {
                    "example"
                },
                sort_order as i64
            ],
        )
        .map_err(|e| format!("无法关联示例图: {e}"))?;
    }
    tx.execute("DELETE FROM recipe_tag_links WHERE recipe_id=?1", [&id])
        .map_err(|e| format!("Could not update recipe tags: {e}"))?;
    let mut seen_tags = HashSet::new();
    for tag_id in &input.tag_ids {
        let tag_id = tag_id.trim();
        if tag_id.is_empty() || !seen_tags.insert(tag_id.to_string()) {
            continue;
        }
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM recipe_tags
                    WHERE id=?1 AND deleted_at IS NULL AND prompt_model=?2
                 )",
                params![tag_id, prompt_model.as_str()],
                |row| row.get(0),
            )
            .map_err(|e| format!("Could not validate recipe tags: {e}"))?;
        if !exists {
            return Err(format!(
                "Recipe tag {tag_id} does not exist in this workspace"
            ));
        }
        tx.execute(
            "INSERT INTO recipe_tag_links(recipe_id,tag_id) VALUES (?1,?2)",
            params![id, tag_id],
        )
        .map_err(|e| format!("Could not attach recipe tags: {e}"))?;
    }
    tx.commit().map_err(|e| format!("无法提交总 Prompt: {e}"))?;
    find_recipe(&conn, &id, false, Some(&state.paths))?
        .ok_or_else(|| "保存后无法读取总 Prompt".into())
}

#[tauri::command]
pub fn list_recipe_tags(state: State<'_, PromptVaultState>) -> Result<Vec<RecipeTag>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let prompt_model = active_prompt_model(&conn)?;
    let mut statement = conn
        .prepare(
            "SELECT t.id,t.name,t.color,t.kind,t.sort_order,t.prompt_model,
                    (SELECT COUNT(*) FROM recipe_tag_links l
                       JOIN recipes r ON r.id=l.recipe_id
                      WHERE l.tag_id=t.id AND r.deleted_at IS NULL)
             FROM recipe_tags t
             WHERE t.deleted_at IS NULL AND t.prompt_model=?1
             ORDER BY t.sort_order,t.name",
        )
        .map_err(|e| format!("Could not read recipe tags: {e}"))?;
    let rows = statement
        .query_map([&prompt_model], |row| {
            Ok(RecipeTag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                kind: row.get(3)?,
                sort_order: row.get(4)?,
                prompt_model: row.get(5)?,
                recipe_count: row.get(6)?,
            })
        })
        .map_err(|e| format!("Could not read recipe tags: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Could not read recipe tags: {e}"))?;
    Ok(rows)
}

#[tauri::command]
pub fn delete_recipe(state: State<'_, PromptVaultState>, id: String) -> Result<(), String> {
    soft_delete(&state, "recipe", &id)
}

fn snippet_from_row(row: &Row<'_>) -> rusqlite::Result<Snippet> {
    Ok(Snippet {
        id: row.get(0)?,
        text: row.get(1)?,
        translation: row.get(2)?,
        notes: row.get(3)?,
        favorite: row.get::<_, i64>(4)? != 0,
        usage_count: row.get(6)?,
        translation_locked: row.get::<_, i64>(7)? != 0,
        category_ids: Vec::new(),
        prompt_model: row
            .get::<_, String>(10)
            .unwrap_or_else(|_| "general".into()),
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

const SNIPPET_SELECT: &str =
    "SELECT id,text_en,text_zh,notes,favorite,rating,usage_count,translation_locked,
            created_at,updated_at,prompt_model FROM snippets";

fn category_ids_for_snippet(conn: &Connection, snippet_id: &str) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT category_id FROM snippet_categories WHERE snippet_id=?1 ORDER BY category_id",
        )
        .map_err(|e| format!("无法读取单 Prompt 分类: {e}"))?;
    let result = statement
        .query_map([snippet_id], |row| row.get(0))
        .map_err(|e| format!("无法读取单 Prompt 分类: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取单 Prompt 分类: {e}"));
    result
}

pub fn find_snippet(
    conn: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<Snippet>, String> {
    let sql = format!(
        "{SNIPPET_SELECT} WHERE id=?1 {}",
        if include_deleted {
            ""
        } else {
            "AND deleted_at IS NULL"
        }
    );
    let mut item = conn
        .query_row(&sql, [id], snippet_from_row)
        .optional()
        .map_err(|e| format!("无法读取单 Prompt: {e}"))?;
    if let Some(snippet) = item.as_mut() {
        snippet.category_ids = category_ids_for_snippet(conn, &snippet.id)?;
    }
    Ok(item)
}

pub fn list_snippets_inner(
    conn: &Connection,
    options: &ListOptions,
) -> Result<Vec<Snippet>, String> {
    let prompt_model = resolve_list_prompt_model(conn, options)?;
    let sql = format!(
        "{SNIPPET_SELECT} WHERE {} AND prompt_model=?1 ORDER BY favorite DESC, updated_at DESC",
        if options.include_deleted {
            "1=1"
        } else {
            "deleted_at IS NULL"
        }
    );
    let mut statement = conn
        .prepare(&sql)
        .map_err(|e| format!("无法读取单 Prompt: {e}"))?;
    let mut items = statement
        .query_map([&prompt_model], snippet_from_row)
        .map_err(|e| format!("无法读取单 Prompt: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取单 Prompt: {e}"))?;
    for item in &mut items {
        item.category_ids = category_ids_for_snippet(conn, &item.id)?;
    }
    let query = options.query.as_deref().unwrap_or("").trim().to_lowercase();
    items.retain(|item| {
        (query.is_empty()
            || [&item.text, &item.translation, &item.notes]
                .iter()
                .any(|text| text.to_lowercase().contains(&query)))
            && options.favorite.map(|v| item.favorite == v).unwrap_or(true)
            && options
                .category_id
                .as_ref()
                .map(|v| item.category_ids.contains(v))
                .unwrap_or(true)
    });
    match options.sort.as_deref() {
        Some("leastUsed") => items.sort_by_key(|item| item.usage_count),
        Some("mostUsed") => items.sort_by_key(|item| std::cmp::Reverse(item.usage_count)),
        Some("oldest") => items.sort_by(|a, b| a.updated_at.cmp(&b.updated_at)),
        _ => {}
    }
    let offset = options.offset.unwrap_or(0).max(0) as usize;
    Ok(items
        .into_iter()
        .skip(offset)
        .take(normalized_limit(options))
        .collect())
}

#[tauri::command]
pub fn list_snippets(
    state: State<'_, PromptVaultState>,
    options: Option<ListOptions>,
) -> Result<Vec<Snippet>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    list_snippets_inner(&conn, &options.unwrap_or_default())
}

#[tauri::command]
pub fn get_snippet(
    state: State<'_, PromptVaultState>,
    id: String,
) -> Result<Option<Snippet>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    find_snippet(&conn, &id, false)
}

#[tauri::command]
pub async fn save_snippet(
    state: State<'_, PromptVaultState>,
    mut input: SaveSnippetInput,
) -> Result<Snippet, String> {
    if input.text.trim().is_empty() {
        return Err("单 Prompt 英文原文不能为空".into());
    }

    // Auto-translate when the configured target-language field is empty.
    let should_auto = !input.translation_locked || input.translation.trim().is_empty();
    if should_auto && recipe_needs_translation(&input.text, &input.translation) {
        match translation::auto_translate_to_zh_from_state(&state, &input.text).await {
            Ok(text) if !text.trim().is_empty() => {
                input.translation = text;
                // Fresh auto translation is considered confirmed for search UX.
                input.translation_locked = true;
                let _ = append_translate_debug_log(
                    &state,
                    &format!(
                        "snippet auto-translate OK ({} chars)",
                        input.text.chars().count()
                    ),
                );
            }
            Ok(_) => {
                let _ = append_translate_debug_log(&state, "snippet auto-translate returned empty");
            }
            Err(error) => {
                let _ = append_translate_debug_log(
                    &state,
                    &format!("snippet auto-translate FAILED: {error}"),
                );
            }
        }
    }

    save_snippet_inner(&state, input)
}

fn save_snippet_inner(
    state: &PromptVaultState,
    input: SaveSnippetInput,
) -> Result<Snippet, String> {
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let id = input
        .id
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = find_snippet(&conn, &id, true)?;
    let prompt_model = resolve_entity_prompt_model(
        &conn,
        input.prompt_model.as_deref(),
        existing.as_ref().map(|item| item.prompt_model.as_str()),
    )?;
    let duplicate: Option<String> = conn
        .query_row(
            "SELECT id FROM snippets
             WHERE lower(trim(text_en))=lower(trim(?1)) AND deleted_at IS NULL
               AND prompt_model=?3 AND id<>?2 LIMIT 1",
            params![input.text, id, prompt_model.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("无法检查重复 Prompt: {e}"))?;
    if let Some(id) = duplicate {
        return Err(format!("当前模型下已存在相同的单 Prompt（{id}）"));
    }
    let timestamp = now();
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始保存事务: {e}"))?;
    if let Some(snapshot) = existing.as_ref() {
        add_revision(&tx, "snippet", &id, snapshot)?;
    }
    tx.execute(
        "INSERT INTO snippets(
           id,text_en,text_zh,notes,favorite,rating,usage_count,translation_locked,
           prompt_model,created_at,updated_at,deleted_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,NULL)
         ON CONFLICT(id) DO UPDATE SET
           text_en=excluded.text_en,text_zh=excluded.text_zh,notes=excluded.notes,
           favorite=excluded.favorite,rating=excluded.rating,
           usage_count=excluded.usage_count,translation_locked=excluded.translation_locked,
           prompt_model=excluded.prompt_model,
           updated_at=excluded.updated_at,deleted_at=NULL",
        params![
            id,
            input.text.trim(),
            input.translation.trim(),
            input.notes,
            input.favorite as i64,
            0,
            input
                .usage_count
                .or_else(|| existing.as_ref().map(|v| v.usage_count))
                .unwrap_or(0),
            input.translation_locked as i64,
            prompt_model.as_str(),
            existing
                .as_ref()
                .map(|v| v.created_at.as_str())
                .unwrap_or(timestamp.as_str()),
            timestamp
        ],
    )
    .map_err(|e| format!("无法保存单 Prompt: {e}"))?;
    tx.execute("DELETE FROM snippet_categories WHERE snippet_id=?1", [&id])
        .map_err(|e| format!("无法更新分类: {e}"))?;
    for category_id in &input.category_ids {
        // Categories must belong to the same prompt model family.
        let ok: bool = tx
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM categories
                    WHERE id=?1 AND deleted_at IS NULL AND prompt_model=?2
                 )",
                params![category_id, prompt_model.as_str()],
                |row| row.get(0),
            )
            .map_err(|e| format!("无法验证分类: {e}"))?;
        if !ok {
            return Err(format!("分类 {category_id} 不存在或不属于当前模型"));
        }
        tx.execute(
            "INSERT INTO snippet_categories(snippet_id,category_id) VALUES (?1,?2)",
            params![id, category_id],
        )
        .map_err(|e| format!("分类不存在或无法关联: {e}"))?;
    }
    tx.commit().map_err(|e| format!("无法提交单 Prompt: {e}"))?;
    find_snippet(&conn, &id, false)?.ok_or_else(|| "保存后无法读取单 Prompt".into())
}

#[tauri::command]
pub fn increment_snippet_usage(
    state: State<'_, PromptVaultState>,
    id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let changed = conn
        .execute(
            "UPDATE snippets SET usage_count=usage_count+1,updated_at=?2
             WHERE id=?1 AND deleted_at IS NULL",
            params![id, now()],
        )
        .map_err(|e| format!("无法更新使用次数: {e}"))?;
    if changed == 0 {
        return Err("单 Prompt 不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub fn delete_snippet(state: State<'_, PromptVaultState>, id: String) -> Result<(), String> {
    soft_delete(&state, "snippet", &id)
}

fn category_from_row(row: &Row<'_>) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        parent_id: row.get(3)?,
        sort_order: row.get(4)?,
        prompt_model: row.get::<_, String>(5).unwrap_or_else(|_| "general".into()),
        snippet_count: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

#[tauri::command]
pub fn list_categories(state: State<'_, PromptVaultState>) -> Result<Vec<Category>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let prompt_model = active_prompt_model(&conn)?;
    let mut statement = conn
        .prepare(
            "SELECT c.id,c.name,c.color,c.parent_id,c.sort_order,c.prompt_model,
                    (SELECT COUNT(*) FROM snippet_categories sc
                     JOIN snippets s ON s.id=sc.snippet_id
                     WHERE sc.category_id=c.id AND s.deleted_at IS NULL),
                    c.created_at,c.updated_at
             FROM categories c
             WHERE c.deleted_at IS NULL AND c.prompt_model=?1
             ORDER BY c.sort_order,c.name",
        )
        .map_err(|e| format!("无法读取分类: {e}"))?;
    let result = statement
        .query_map([&prompt_model], category_from_row)
        .map_err(|e| format!("无法读取分类: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取分类: {e}"));
    result
}

fn find_category(
    conn: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<Category>, String> {
    let sql = format!(
        "SELECT c.id,c.name,c.color,c.parent_id,c.sort_order,c.prompt_model,
                (SELECT COUNT(*) FROM snippet_categories sc
                 JOIN snippets s ON s.id=sc.snippet_id
                 WHERE sc.category_id=c.id AND s.deleted_at IS NULL),
                c.created_at,c.updated_at FROM categories c
         WHERE c.id=?1 {}",
        if include_deleted {
            ""
        } else {
            "AND deleted_at IS NULL"
        }
    );
    conn.query_row(&sql, [id], category_from_row)
        .optional()
        .map_err(|e| format!("无法读取分类: {e}"))
}

#[tauri::command]
pub fn save_category(
    state: State<'_, PromptVaultState>,
    input: SaveCategoryInput,
) -> Result<Category, String> {
    if input.name.trim().is_empty() {
        return Err("分类名称不能为空".into());
    }
    if input.id.as_ref() == input.parent_id.as_ref() {
        return Err("分类不能把自己作为父分类".into());
    }
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = find_category(&conn, &id, true)?;
    let prompt_model = resolve_entity_prompt_model(
        &conn,
        input.prompt_model.as_deref(),
        existing.as_ref().map(|item| item.prompt_model.as_str()),
    )?;
    let timestamp = now();
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始保存事务: {e}"))?;
    if let Some(snapshot) = existing.as_ref() {
        add_revision(&tx, "category", &id, snapshot)?;
    }
    tx.execute(
        "INSERT INTO categories(id,name,color,parent_id,sort_order,prompt_model,created_at,updated_at,deleted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,parent_id=excluded.parent_id,
           sort_order=excluded.sort_order,prompt_model=excluded.prompt_model,
           updated_at=excluded.updated_at,deleted_at=NULL",
        params![
            id,
            input.name.trim(),
            input.color,
            input.parent_id,
            input.sort_order,
            prompt_model.as_str(),
            existing
                .as_ref()
                .map(|v| v.created_at.as_str())
                .unwrap_or(timestamp.as_str()),
            timestamp
        ],
    )
    .map_err(|e| format!("无法保存分类（可能存在同名分类）: {e}"))?;
    tx.commit().map_err(|e| format!("无法提交分类: {e}"))?;
    find_category(&conn, &id, false)?.ok_or_else(|| "保存后无法读取分类".into())
}

#[tauri::command]
pub fn delete_category(state: State<'_, PromptVaultState>, id: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let snapshot = find_category(&conn, &id, false)?.ok_or_else(|| "分类不存在".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始删除事务: {e}"))?;
    add_revision(&tx, "category", &id, &snapshot)?;
    tx.execute(
        "UPDATE categories SET deleted_at=?2,updated_at=?2 WHERE id=?1",
        params![id, now()],
    )
    .map_err(|e| format!("无法删除分类: {e}"))?;
    // Keep category relationships while the record is in the recycle bin so
    // restoration is lossless. Live category queries already hide it.
    tx.commit().map_err(|e| format!("无法提交删除: {e}"))
}

fn tip_from_row(row: &Row<'_>) -> rusqlite::Result<Tip> {
    Ok(Tip {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        scope: row.get(3)?,
        target_id: row.get(4)?,
        target_name: row.get(5)?,
        favorite: row.get::<_, i64>(6)? != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn find_tip(conn: &Connection, id: &str, include_deleted: bool) -> Result<Option<Tip>, String> {
    let sql = format!(
        "SELECT t.id,t.title,t.content,t.scope_type,t.scope_id,
                CASE t.scope_type
                  WHEN 'category' THEN (SELECT name FROM categories WHERE id=t.scope_id)
                  ELSE (SELECT name FROM resources WHERE id=t.scope_id)
                END,
                t.favorite,t.created_at,t.updated_at
         FROM tips t WHERE t.id=?1 {}",
        if include_deleted {
            ""
        } else {
            "AND deleted_at IS NULL"
        }
    );
    conn.query_row(&sql, [id], tip_from_row)
        .optional()
        .map_err(|e| format!("无法读取技巧: {e}"))
}

#[tauri::command]
pub fn list_tips(
    state: State<'_, PromptVaultState>,
    scope_type: Option<String>,
    scope_id: Option<String>,
) -> Result<Vec<Tip>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT t.id,t.title,t.content,t.scope_type,t.scope_id,
                    CASE t.scope_type
                      WHEN 'category' THEN (SELECT name FROM categories WHERE id=t.scope_id)
                      ELSE (SELECT name FROM resources WHERE id=t.scope_id)
                    END,
                    t.favorite,t.created_at,t.updated_at
             FROM tips t WHERE t.deleted_at IS NULL ORDER BY t.favorite DESC,t.updated_at DESC",
        )
        .map_err(|e| format!("无法读取技巧: {e}"))?;
    let mut items = statement
        .query_map([], tip_from_row)
        .map_err(|e| format!("无法读取技巧: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取技巧: {e}"))?;
    items.retain(|tip| {
        scope_type
            .as_ref()
            .map(|value| &tip.scope == value)
            .unwrap_or(true)
            && scope_id
                .as_ref()
                .map(|value| tip.target_id.as_ref() == Some(value))
                .unwrap_or(true)
    });
    Ok(items)
}

#[tauri::command]
pub fn save_tip(state: State<'_, PromptVaultState>, input: SaveTipInput) -> Result<Tip, String> {
    if input.title.trim().is_empty() || input.content.trim().is_empty() {
        return Err("技巧标题和内容不能为空".into());
    }
    if !["global", "model", "lora", "category"].contains(&input.scope.as_str()) {
        return Err("不支持的技巧范围".into());
    }
    if input.scope != "global" && input.target_id.is_none() {
        return Err("非全局技巧必须选择对应资源或分类".into());
    }
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let existing = find_tip(&conn, &id, true)?;
    let timestamp = now();
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始保存事务: {e}"))?;
    if let Some(snapshot) = existing.as_ref() {
        add_revision(&tx, "tip", &id, snapshot)?;
    }
    tx.execute(
        "INSERT INTO tips(id,title,content,scope_type,scope_id,favorite,created_at,updated_at,deleted_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,
           scope_type=excluded.scope_type,scope_id=excluded.scope_id,favorite=excluded.favorite,
           updated_at=excluded.updated_at,deleted_at=NULL",
        params![
            id,
            input.title.trim(),
            input.content.trim(),
            input.scope,
            input.target_id,
            input.favorite as i64,
            existing
                .as_ref()
                .map(|v| v.created_at.as_str())
                .unwrap_or(timestamp.as_str()),
            timestamp
        ],
    )
    .map_err(|e| format!("无法保存技巧: {e}"))?;
    tx.commit().map_err(|e| format!("无法提交技巧: {e}"))?;
    find_tip(&conn, &id, false)?.ok_or_else(|| "保存后无法读取技巧".into())
}

#[tauri::command]
pub fn delete_tip(state: State<'_, PromptVaultState>, id: String) -> Result<(), String> {
    soft_delete(&state, "tip", &id)
}

fn soft_delete(
    state: &State<'_, PromptVaultState>,
    entity_type: &str,
    id: &str,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let table = match entity_type {
        "recipe" => "recipes",
        "snippet" => "snippets",
        "tip" => "tips",
        _ => return Err("不支持删除此类型".into()),
    };
    let snapshot = match entity_type {
        "recipe" => find_recipe(&conn, id, false, None)?
            .map(|v| serde_json::to_value(v).unwrap_or(Value::Null)),
        "snippet" => {
            find_snippet(&conn, id, false)?.map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
        }
        "tip" => {
            find_tip(&conn, id, false)?.map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
        }
        _ => None,
    }
    .ok_or_else(|| "记录不存在或已经在回收站".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始删除事务: {e}"))?;
    add_revision(&tx, entity_type, id, &snapshot)?;
    let sql = format!("UPDATE {table} SET deleted_at=?2,updated_at=?2 WHERE id=?1");
    tx.execute(&sql, params![id, now()])
        .map_err(|e| format!("无法移入回收站: {e}"))?;
    tx.commit().map_err(|e| format!("无法提交删除: {e}"))
}

#[tauri::command]
pub fn list_trash(state: State<'_, PromptVaultState>) -> Result<Vec<TrashItem>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT 'recipe',id,title,deleted_at FROM recipes WHERE deleted_at IS NOT NULL
             UNION ALL
             SELECT 'snippet',id,text_en,deleted_at FROM snippets WHERE deleted_at IS NOT NULL
             UNION ALL
             SELECT 'category',id,name,deleted_at FROM categories WHERE deleted_at IS NOT NULL
             UNION ALL
             SELECT 'tip',id,title,deleted_at FROM tips WHERE deleted_at IS NOT NULL
             ORDER BY deleted_at DESC",
        )
        .map_err(|e| format!("无法读取回收站: {e}"))?;
    let result = statement
        .query_map([], |row| {
            Ok(TrashItem {
                entity_type: row.get(0)?,
                id: row.get(1)?,
                title: row.get(2)?,
                deleted_at: row.get(3)?,
            })
        })
        .map_err(|e| format!("无法读取回收站: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取回收站: {e}"));
    result
}

#[tauri::command]
pub fn restore_item(
    state: State<'_, PromptVaultState>,
    entity_type: String,
    id: String,
) -> Result<(), String> {
    let table = match entity_type.as_str() {
        "recipe" => "recipes",
        "snippet" => "snippets",
        "category" => "categories",
        "tip" => "tips",
        _ => return Err("不支持恢复此类型".into()),
    };
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let sql = format!("UPDATE {table} SET deleted_at=NULL,updated_at=?2 WHERE id=?1");
    let changed = conn
        .execute(&sql, params![id, now()])
        .map_err(|e| format!("无法恢复记录: {e}"))?;
    if changed == 0 {
        return Err("回收站中没有该记录".into());
    }
    Ok(())
}

/// Permanently delete a soft-deleted item. Does not restore; run GC for orphan images.
#[tauri::command]
pub fn purge_item(
    state: State<'_, PromptVaultState>,
    entity_type: String,
    id: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let table = match entity_type.as_str() {
        "recipe" => "recipes",
        "snippet" => "snippets",
        "category" => "categories",
        "tip" => "tips",
        _ => return Err("不支持彻底删除此类型".into()),
    };
    let deleted: Option<String> = conn
        .query_row(
            &format!("SELECT id FROM {table} WHERE id=?1 AND deleted_at IS NOT NULL"),
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("无法检查回收站记录: {e}"))?;
    if deleted.is_none() {
        return Err("只能彻底删除回收站中的记录；请先移入回收站".into());
    }
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始彻底删除事务: {e}"))?;
    match entity_type.as_str() {
        "recipe" => {
            tx.execute(
                "DELETE FROM entity_assets WHERE entity_type='recipe' AND entity_id=?1",
                [&id],
            )
            .map_err(|e| format!("无法解除示例图关联: {e}"))?;
            tx.execute(
                "DELETE FROM revisions WHERE entity_type='recipe' AND entity_id=?1",
                [&id],
            )
            .map_err(|e| format!("无法删除修改历史: {e}"))?;
            tx.execute("DELETE FROM recipes WHERE id=?1", [&id])
                .map_err(|e| format!("无法彻底删除总 Prompt: {e}"))?;
        }
        "snippet" => {
            tx.execute("DELETE FROM snippet_categories WHERE snippet_id=?1", [&id])
                .map_err(|e| format!("无法解除分类关联: {e}"))?;
            tx.execute(
                "DELETE FROM revisions WHERE entity_type='snippet' AND entity_id=?1",
                [&id],
            )
            .map_err(|e| format!("无法删除修改历史: {e}"))?;
            tx.execute("DELETE FROM snippets WHERE id=?1", [&id])
                .map_err(|e| format!("无法彻底删除单 Prompt: {e}"))?;
        }
        "tip" => {
            tx.execute(
                "DELETE FROM revisions WHERE entity_type='tip' AND entity_id=?1",
                [&id],
            )
            .map_err(|e| format!("无法删除修改历史: {e}"))?;
            tx.execute("DELETE FROM tips WHERE id=?1", [&id])
                .map_err(|e| format!("无法彻底删除技巧: {e}"))?;
        }
        "category" => {
            tx.execute(
                "UPDATE categories SET parent_id=NULL WHERE parent_id=?1",
                [&id],
            )
            .map_err(|e| format!("无法解除子分类: {e}"))?;
            tx.execute("DELETE FROM snippet_categories WHERE category_id=?1", [&id])
                .map_err(|e| format!("无法解除词条分类: {e}"))?;
            tx.execute(
                "DELETE FROM revisions WHERE entity_type='category' AND entity_id=?1",
                [&id],
            )
            .map_err(|e| format!("无法删除修改历史: {e}"))?;
            tx.execute("DELETE FROM categories WHERE id=?1", [&id])
                .map_err(|e| format!("无法彻底删除分类: {e}"))?;
        }
        _ => return Err("不支持彻底删除此类型".into()),
    }
    tx.commit().map_err(|e| format!("无法提交彻底删除: {e}"))?;
    let _ = collect_orphan_assets(&conn, &state.paths);
    Ok(())
}

#[tauri::command]
pub fn empty_trash(state: State<'_, PromptVaultState>) -> Result<usize, String> {
    let items: Vec<(String, String)> = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        let mut statement = conn
            .prepare(
                "SELECT 'recipe',id FROM recipes WHERE deleted_at IS NOT NULL
                 UNION ALL
                 SELECT 'snippet',id FROM snippets WHERE deleted_at IS NOT NULL
                 UNION ALL
                 SELECT 'category',id FROM categories WHERE deleted_at IS NOT NULL
                 UNION ALL
                 SELECT 'tip',id FROM tips WHERE deleted_at IS NOT NULL",
            )
            .map_err(|e| format!("无法读取回收站: {e}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("无法读取回收站: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("无法读取回收站: {e}"))?;
        rows
    };
    let total = items.len();
    for (entity_type, id) in items {
        purge_item(state.clone(), entity_type, id)?;
    }
    Ok(total)
}

#[tauri::command]
pub fn list_revisions(
    state: State<'_, PromptVaultState>,
    entity_type: String,
    entity_id: String,
) -> Result<Vec<Revision>, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT id,entity_type,entity_id,snapshot_json,created_at
             FROM revisions WHERE entity_type=?1 AND entity_id=?2
             ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(|e| format!("无法读取历史版本: {e}"))?;
    let result = statement
        .query_map(params![entity_type, entity_id], |row| {
            let raw: String = row.get(3)?;
            Ok(Revision {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                snapshot: serde_json::from_str(&raw).unwrap_or(Value::Null),
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("无法读取历史版本: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法读取历史版本: {e}"));
    result
}

#[tauri::command]
pub fn search_all(
    state: State<'_, PromptVaultState>,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut hits = Vec::new();
    for recipe in list_recipes_inner(
        &conn,
        &ListOptions {
            query: Some(query.clone()),
            limit: Some(50),
            ..Default::default()
        },
        None,
    )? {
        hits.push(SearchHit {
            entity_type: "recipe".into(),
            id: recipe.id,
            title: recipe.title,
            subtitle: "总 Prompt".into(),
            matched_text: recipe.positive_prompt,
            updated_at: recipe.updated_at,
        });
    }
    for snippet in list_snippets_inner(
        &conn,
        &ListOptions {
            query: Some(query.clone()),
            limit: Some(50),
            ..Default::default()
        },
    )? {
        hits.push(SearchHit {
            entity_type: "snippet".into(),
            id: snippet.id,
            title: snippet.text,
            subtitle: snippet.translation.clone(),
            matched_text: snippet.translation,
            updated_at: snippet.updated_at,
        });
    }
    let mut statement = conn
        .prepare(
            "SELECT 'resource',id,name,resource_type,path,updated_at FROM resources
             WHERE lower(name) LIKE ?1 OR lower(path) LIKE ?1
             UNION ALL
             SELECT 'tip',id,title,scope_type,content,updated_at FROM tips
             WHERE deleted_at IS NULL AND (lower(title) LIKE ?1 OR lower(content) LIKE ?1)
             LIMIT 100",
        )
        .map_err(|e| format!("无法执行全局搜索: {e}"))?;
    let pattern = format!("%{}%", needle.replace('%', "\\%").replace('_', "\\_"));
    let more = statement
        .query_map([pattern], |row| {
            Ok(SearchHit {
                entity_type: row.get(0)?,
                id: row.get(1)?,
                title: row.get(2)?,
                subtitle: row.get(3)?,
                matched_text: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("无法执行全局搜索: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("无法执行全局搜索: {e}"))?;
    hits.extend(more);
    hits.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    hits.truncate(100);
    Ok(hits)
}

#[tauri::command]
pub fn get_dashboard(state: State<'_, PromptVaultState>) -> Result<Dashboard, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let count = |sql: &str| {
        conn.query_row(sql, [], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("无法读取统计数据: {e}"))
    };
    let settings = get_app_settings(&conn)?;
    let last_backup_at = crate::backup::list_backups_inner(&state.paths, &settings.backup_path)
        .ok()
        .and_then(|items| items.first().map(|v| v.created_at.clone()));
    let model = settings.active_prompt_model.clone();
    let count_model = |sql: &str| {
        conn.query_row(sql, [&model], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("无法读取统计数据: {e}"))
    };
    Ok(Dashboard {
        recipe_count: count_model(
            "SELECT COUNT(*) FROM recipes WHERE deleted_at IS NULL AND prompt_model=?1",
        )?,
        snippet_count: count_model(
            "SELECT COUNT(*) FROM snippets WHERE deleted_at IS NULL AND prompt_model=?1",
        )?,
        resource_count: count("SELECT COUNT(*) FROM resources")?,
        favorite_count: count_model(
            "SELECT
              (SELECT COUNT(*) FROM recipes WHERE deleted_at IS NULL AND favorite=1 AND prompt_model=?1)+
              (SELECT COUNT(*) FROM snippets WHERE deleted_at IS NULL AND favorite=1 AND prompt_model=?1)+
              (SELECT COUNT(*) FROM tips WHERE deleted_at IS NULL AND favorite=1)",
        )?,
        last_backup_at,
        backup_healthy: !settings.backup_path.is_empty(),
        resource_paths_online: count("SELECT COUNT(*) FROM resources WHERE online=1")? > 0,
    })
}

#[tauri::command]
pub fn get_settings(state: State<'_, PromptVaultState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    get_app_settings(&conn)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, PromptVaultState>,
    input: SaveSettingsInput,
) -> Result<AppSettings, String> {
    if let Some(profiles) = input.prompt_models.as_ref() {
        if profiles.is_empty() {
            return Err("At least one prompt workspace is required".into());
        }
        if profiles
            .iter()
            .any(|profile| profile.id.trim().is_empty() || profile.name.trim().is_empty())
        {
            return Err("Every prompt workspace needs a stable id and a name".into());
        }
    }
    let backup_path_for_recovery = input.backup_path.clone();
    if let Some(path) = backup_path_for_recovery.as_deref() {
        persist_backup_location(&state.paths, path)?;
    }
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let values: [(&str, Option<Value>); 12] = [
        ("loraDirectory", input.lora_path.map(Value::String)),
        (
            "checkpointDirectory",
            input.checkpoint_path.map(Value::String),
        ),
        (
            "diffusionModelDirectory",
            input.diffusion_model_path.map(Value::String),
        ),
        ("backupDirectory", input.backup_path.map(Value::String)),
        (
            "translationProvider",
            input.translation_provider.map(Value::String),
        ),
        (
            "translationEndpoint",
            input.translation_endpoint.map(Value::String),
        ),
        (
            "translationModel",
            input.translation_model.map(Value::String),
        ),
        (
            "onlineTranslationEnabled",
            input.online_translation_enabled.map(Value::Bool),
        ),
        (
            "translationTargetLanguage",
            input.translation_target_language.map(Value::String),
        ),
        ("privacyMode", input.privacy_mode.map(Value::Bool)),
        (
            "promptModels",
            input
                .prompt_models
                .map(|profiles| serde_json::to_value(profiles).unwrap_or(Value::Array(vec![]))),
        ),
        (
            "activePromptModel",
            input
                .active_prompt_model
                .as_ref()
                .map(|value| Value::String(normalize_prompt_model(value))),
        ),
    ];
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始设置事务: {e}"))?;
    for (key, value) in values {
        if let Some(value) = value {
            set_setting(&tx, key, value)?;
        }
    }
    // defaultPrefix / defaultNegative are stored per active prompt model.
    upsert_active_model_defaults(
        &tx,
        input.default_prefix.clone(),
        input.default_negative.clone(),
    )?;
    tx.commit().map_err(|e| format!("无法提交设置: {e}"))?;
    get_app_settings(&conn)
}

#[tauri::command]
pub fn health_check(state: State<'_, PromptVaultState>) -> Result<HashMap<String, Value>, String> {
    let recovery = state
        .recovery
        .lock()
        .map_err(|_| "恢复状态锁已损坏".to_string())?
        .clone();
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    crate::db::integrity_check(&conn)?;
    let mut result = HashMap::new();
    result.insert("status".into(), Value::String("ok".into()));
    result.insert(
        "databasePath".into(),
        Value::String(state.paths.database.to_string_lossy().into_owned()),
    );
    result.insert(
        "vaultPath".into(),
        Value::String(state.paths.root.to_string_lossy().into_owned()),
    );
    result.insert(
        "schemaVersion".into(),
        Value::Number(crate::db::SCHEMA_VERSION.into()),
    );
    result.insert("recoveryMode".into(), Value::Bool(recovery.is_some()));
    if let Some(recovery) = recovery {
        result.insert(
            "recoveryError".into(),
            Value::String(recovery.original_error),
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{PromptVaultState, VaultPaths};

    #[test]
    fn draft_and_reproducible_allow_empty_generation_params() {
        let mut input = SaveRecipeInput {
            title: String::new(),
            ..Default::default()
        };
        assert!(validate_recipe_input(&input).is_ok());

        input.status = "reproducible".into();
        // reproducible without prompt is rejected
        assert!(validate_recipe_input(&input).is_err());

        input.positive_prompt = "portrait".into();
        // model / size / sampler / steps / cfg may all stay empty
        assert!(validate_recipe_input(&input).is_ok());

        input.model_id = Some("checkpoint".into());
        input.params = GenerationParams {
            width: Some(1024),
            height: Some(1024),
            sampler: Some("euler".into()),
            scheduler: None,
            steps: Some(28),
            cfg: Some(3.5),
            seed: None,
        };
        assert!(validate_recipe_input(&input).is_ok());
    }

    #[test]
    fn blank_recipe_title_uses_prompt_fragment_or_stable_date_fallback() {
        assert_eq!(
            derive_recipe_title(
                "",
                "(portrait, close-up:1.2), soft light",
                "2026-07-28T05:30:00.000Z"
            ),
            "(portrait, close-up:1.2)"
        );
        assert_eq!(
            derive_recipe_title("", "", "2026-07-28T05:30:00.000Z"),
            "未命名 Prompt · 2026-07-28"
        );
        assert_eq!(
            derive_recipe_title("  手写标题  ", "portrait", "2026-07-28T05:30:00.000Z"),
            "手写标题"
        );
    }

    #[test]
    fn save_recipe_persists_through_the_real_sql_path() {
        let root = std::env::temp_dir().join(format!("pv-save-recipe-{}", uuid::Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths).unwrap();

        let saved = save_recipe_inner(
            &state,
            SaveRecipeInput {
                id: Some("recipe-save-regression".into()),
                title: "保存回归测试".into(),
                positive_prompt: "portrait, soft lighting".into(),
                notes: "real sqlite path".into(),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(saved.id, "recipe-save-regression");
        assert_eq!(saved.title, "保存回归测试");
        assert_eq!(saved.positive_prompt, "portrait, soft lighting");
        assert_eq!(saved.notes, "real sqlite path");
        assert_eq!(saved.prompt_model, "general");
        assert!(!saved.created_at.is_empty());
        assert!(!saved.updated_at.is_empty());
        assert_eq!(
            state
                .db
                .lock()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM recipes WHERE id='recipe-save-regression'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );

        drop(state);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn save_recipe_persists_an_automatic_title_when_input_title_is_blank() {
        let root =
            std::env::temp_dir().join(format!("pv-save-auto-title-{}", uuid::Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths).unwrap();

        let from_prompt = save_recipe_inner(
            &state,
            SaveRecipeInput {
                id: Some("recipe-auto-prompt-title".into()),
                title: String::new(),
                positive_prompt: "cinematic portrait, golden hour".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(from_prompt.title, "cinematic portrait");

        let without_prompt = save_recipe_inner(
            &state,
            SaveRecipeInput {
                id: Some("recipe-auto-date-title".into()),
                title: String::new(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(without_prompt.title.starts_with("未命名 Prompt · "));
        assert_eq!(without_prompt.title.chars().count(), 23);

        drop(state);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn revision_recipe_reads_asset_metadata_without_embedding_image_data() {
        let root = std::env::temp_dir().join(format!("pv-revision-{}", uuid::Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths.clone()).unwrap();
        let sha = "a".repeat(64);
        let relative = format!("aa/{}.png", &sha[2..]);
        let object = paths.objects.join(&relative);
        std::fs::create_dir_all(object.parent().unwrap()).unwrap();
        let mut img = image::RgbImage::new(64, 48);
        for pixel in img.pixels_mut() {
            *pixel = image::Rgb([40, 80, 160]);
        }
        img.save(&object).unwrap();
        let size = std::fs::metadata(&object).unwrap().len() as i64;
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO assets(
                   id,sha256,mime_type,extension,original_name,object_path,size,created_at
                 ) VALUES ('asset',?1,'image/png','png','preview.png',?2,?3,?4)",
                params![sha, relative, size, now()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO recipes(id,title,created_at,updated_at)
                 VALUES ('recipe','test',?1,?1)",
                [now()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO entity_assets(entity_type,entity_id,asset_id,role,sort_order)
                 VALUES ('recipe','recipe','asset','example',0)",
                [],
            )
            .unwrap();
            let revision_view = find_recipe(&conn, "recipe", false, None).unwrap().unwrap();
            assert_eq!(revision_view.assets.len(), 1);
            assert!(revision_view.assets[0].url.is_empty());
            assert!(revision_view.params.width.is_none());
            assert!(revision_view.params.height.is_none());
            assert!(revision_view.params.sampler.is_none());
            assert!(revision_view.params.scheduler.is_none());
            assert!(revision_view.params.steps.is_none());
            assert!(revision_view.params.cfg.is_none());
            assert!(revision_view.params.seed.is_none());
            let ui_view = find_recipe(&conn, "recipe", false, Some(&paths))
                .unwrap()
                .unwrap();
            // List/detail hydration embeds JPEG thumbnails, not the original PNG bytes.
            assert!(ui_view.assets[0].url.starts_with("data:image/jpeg;base64,"));
            assert!(ui_view.assets[0].url.len() < 80_000);
        }
        drop(state);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_concrete_generation_params_remain_readable() {
        let root = std::env::temp_dir().join(format!("pv-legacy-{}", uuid::Uuid::new_v4()));
        let paths = VaultPaths::temporary(root.clone()).unwrap();
        let state = PromptVaultState::initialize_at(paths).unwrap();
        {
            let conn = state.db.lock().unwrap();
            conn.execute(
                "INSERT INTO recipes(
                   id,title,width,height,sampler,scheduler,steps,cfg,seed,created_at,updated_at
                 ) VALUES (
                   'legacy','legacy recipe',1024,1536,'dpmpp_2m','karras',28,3.5,'-1',?1,?1
                 )",
                [now()],
            )
            .unwrap();
            let recipe = find_recipe(&conn, "legacy", false, None).unwrap().unwrap();
            assert_eq!(recipe.params.width, Some(1024));
            assert_eq!(recipe.params.height, Some(1536));
            assert_eq!(recipe.params.sampler.as_deref(), Some("dpmpp_2m"));
            assert_eq!(recipe.params.scheduler.as_deref(), Some("karras"));
            assert_eq!(recipe.params.steps, Some(28));
            assert_eq!(recipe.params.cfg, Some(3.5));
            assert_eq!(recipe.params.seed.as_deref(), Some("-1"));
        }
        drop(state);
        let _ = std::fs::remove_dir_all(root);
    }
}

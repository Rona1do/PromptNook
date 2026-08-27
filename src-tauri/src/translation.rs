use crate::{
    db::{get_app_settings, now, PromptVaultState},
    models::{SaveTranslationInput, TranslationRequest, TranslationResult},
};
use reqwest::{Client, Response, Url};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const KEYRING_SERVICE: &str = "com.promptnook.desktop.translation";
const GOOGLE_OPENAI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Whole-prompt requests may be long, so the timeout is intentionally generous.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

#[tauri::command]
pub async fn translate_text(
    state: State<'_, PromptVaultState>,
    request: TranslationRequest,
) -> Result<TranslationResult, String> {
    let source = request.text.trim().to_string();
    if source.is_empty() {
        return Ok(TranslationResult {
            text: String::new(),
            cached: false,
        });
    }
    let (provider, endpoint, model, enabled) = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        let settings = get_app_settings(&conn)?;
        let provider = request
            .provider
            .clone()
            .unwrap_or_else(|| settings.translation_provider.clone());
        let cached: Option<String> = if request.test_connection {
            None
        } else {
            conn.query_row(
                "SELECT translated_text FROM translation_cache
                 WHERE source_text=?1 AND target_language=?2
                   AND (locked=1 OR provider=?3)
                 ORDER BY locked DESC,updated_at DESC LIMIT 1",
                params![source, request.target_language, provider],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("无法读取翻译缓存: {e}"))?
        };
        if let Some(text) = cached {
            return Ok(TranslationResult { text, cached: true });
        }
        (
            provider,
            request
                .endpoint
                .clone()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or(settings.translation_endpoint),
            request
                .model
                .clone()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or(settings.translation_model),
            settings.online_translation_enabled || request.test_connection,
        )
    };

    let api_key = request
        .api_key
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| load_translation_api_key("openai").ok())
        .or_else(|| load_translation_api_key(&provider).ok());

    let translated = auto_translate_to_zh(
        &provider,
        &endpoint,
        &model,
        enabled,
        api_key.as_deref(),
        &source,
        &request.target_language,
    )
    .await?;
    {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        conn.execute(
            "INSERT INTO translation_cache(
               source_text,target_language,provider,translated_text,locked,updated_at
             ) VALUES (?1,?2,?3,?4,0,?5)
             ON CONFLICT(source_text,target_language,provider) DO UPDATE SET
               translated_text=CASE WHEN translation_cache.locked=1
                 THEN translation_cache.translated_text ELSE excluded.translated_text END,
               updated_at=CASE WHEN translation_cache.locked=1
                 THEN translation_cache.updated_at ELSE excluded.updated_at END",
            params![source, request.target_language, provider, translated, now()],
        )
        .map_err(|e| format!("无法缓存翻译结果: {e}"))?;
    }
    Ok(TranslationResult {
        text: translated,
        cached: false,
    })
}

/// Shared auto-translate used by translate_text and save_snippet.
/// The configured local or compatible provider is preferred; machine
/// translation is only a last-resort fallback.
pub(crate) async fn auto_translate_to_zh_from_state(
    state: &PromptVaultState,
    source: &str,
) -> Result<String, String> {
    let source = source.trim();
    if source.is_empty() {
        return Ok(String::new());
    }
    let (provider, endpoint, model, enabled, target_language) = {
        let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
        let settings = get_app_settings(&conn)?;
        (
            settings.translation_provider,
            settings.translation_endpoint,
            settings.translation_model,
            settings.online_translation_enabled,
            settings.translation_target_language,
        )
    };
    let api_key = load_translation_api_key("openai")
        .ok()
        .filter(|k| !k.trim().is_empty());
    auto_translate_to_zh(
        &provider,
        &endpoint,
        &model,
        enabled,
        api_key.as_deref(),
        source,
        &target_language,
    )
    .await
}

async fn auto_translate_to_zh(
    provider: &str,
    endpoint: &str,
    model: &str,
    enabled: bool,
    api_key: Option<&str>,
    source: &str,
    target_language: &str,
) -> Result<String, String> {
    if provider == "ollama" {
        if !enabled {
            return Err("已选择 Ollama，但未开启「允许自动翻译」。请在设置中打开开关。".into());
        }
        if endpoint.trim().is_empty() || model.trim().is_empty() {
            return Err("Ollama 需要填写 API 地址和模型名称".into());
        }
        return call_ollama(endpoint, model, source, target_language).await;
    }

    let gemini_key = api_key.filter(|k| !k.trim().is_empty());
    let gemini_usable = gemini_key.is_some()
        && (is_google_endpoint(endpoint)
            || model.to_ascii_lowercase().contains("gemini")
            || provider == "openai"
            || provider == "off"
            || provider == "builtin");

    if let (true, Some(key)) = (gemini_usable, gemini_key) {
        let model_id = if model.trim().is_empty() {
            "gemini-2.0-flash".to_string()
        } else {
            model.trim().trim_start_matches("models/").to_string()
        };

        // Short prompt lines fit comfortably in one Gemini request.
        if source.chars().count() <= 220 {
            match call_gemini_native(&model_id, Some(key), source, target_language).await {
                Ok(text) => return Ok(text),
                Err(gemini_error) => {
                    if let Ok(text) = call_google_translate_machine(source, target_language).await {
                        return Ok(text);
                    }
                    return Err(format!(
                        "Gemini 短句翻译失败：{gemini_error}（免费 Google 翻译也可能被限流 429）"
                    ));
                }
            }
        }

        // Long total-prompt: try full Gemini, then delimiter-chunked Gemini (short pieces pass safety).
        match call_gemini_native(&model_id, Some(key), source, target_language).await {
            Ok(text) => return Ok(text),
            Err(_full_error) => {
                if let Ok(text) =
                    translate_gemini_by_delimiter_chunks(&model_id, key, source, target_language)
                        .await
                {
                    if !text.trim().is_empty() {
                        return Ok(text);
                    }
                }
            }
        }
    }

    // Non-Google OpenAI-compatible LLM (if explicitly configured & enabled)
    if provider == "openai"
        && enabled
        && !endpoint.trim().is_empty()
        && !model.trim().is_empty()
        && !is_google_endpoint(endpoint)
    {
        if let Ok(text) =
            call_openai_compatible(endpoint, model, api_key, source, target_language).await
        {
            return Ok(text);
        }
    }

    // Last resort: unofficial Google Translate (frequently returns HTTP 429).
    call_google_translate_machine(source, target_language)
        .await
        .map_err(|error| {
            if error.contains("429") {
                "Google 网页翻译接口触发频率限制(HTTP 429)，暂时不可用。\n\
                 请在「设置 → 翻译」用「一键套用 Google 参数」并保存 Gemini API 密钥，\
                 然后打开「允许自动翻译」。单 Prompt 会走 Gemini（短句可用），不再依赖该免费接口。"
                    .into()
            } else {
                format!("翻译失败：{error}")
            }
        })
}

/// Translate long prompts piece-by-piece while preserving prompt delimiters.
async fn translate_gemini_by_delimiter_chunks(
    model: &str,
    api_key: &str,
    source: &str,
    target_language: &str,
) -> Result<String, String> {
    let pieces = split_for_machine_translate(source, 160);
    let piece_count = pieces.len();
    let mut output = String::with_capacity(source.len());
    let mut any_ok = false;
    for (idx, piece) in pieces.into_iter().enumerate() {
        if piece.trim().is_empty() {
            output.push_str(&piece);
            continue;
        }
        let leading = piece.len() - piece.trim_start().len();
        let trailing = piece.len() - piece.trim_end().len();
        let core = piece.trim();
        match call_gemini_native(model, Some(api_key), core, target_language).await {
            Ok(translated) => {
                any_ok = true;
                if leading > 0 {
                    output.push_str(&piece[..leading]);
                }
                output.push_str(translated.trim());
                if trailing > 0 {
                    output.push_str(&piece[piece.len() - trailing..]);
                }
            }
            Err(_) => {
                // Keep original English segment rather than aborting the whole prompt.
                output.push_str(&piece);
            }
        }
        // Brief pause between multi-chunk requests only (rate-limit cushion).
        if piece_count > 1 && idx + 1 < piece_count {
            std::thread::sleep(Duration::from_millis(80));
        }
    }
    if !any_ok {
        return Err("Gemini 分段翻译全部失败".into());
    }
    let cleaned = clean_translation(&output);
    if cleaned.is_empty() {
        Err("Gemini 分段翻译结果为空".into())
    } else {
        Ok(cleaned)
    }
}

#[tauri::command]
pub fn save_translation_api_key(provider: String, api_key: String) -> Result<(), String> {
    if !matches!(provider.as_str(), "openai" | "ollama") {
        return Err("API 密钥服务只能是 openai 或 ollama".into());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider)
        .map_err(|e| format!("无法访问 Windows 凭据管理器: {e}"))?;
    if api_key.is_empty() {
        entry
            .delete_credential()
            .map_err(|e| format!("无法删除翻译凭据: {e}"))
    } else {
        entry
            .set_password(&api_key)
            .map_err(|e| format!("无法保存翻译凭据: {e}"))
    }
}

#[tauri::command]
pub fn has_translation_api_key(provider: String) -> Result<bool, String> {
    if !matches!(provider.as_str(), "openai" | "ollama") {
        return Ok(false);
    }
    Ok(load_translation_api_key(&provider)
        .map(|value| !value.is_empty())
        .unwrap_or(false))
}

fn load_translation_api_key(provider: &str) -> Result<String, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider)
        .map_err(|e| format!("无法访问 Windows 凭据管理器: {e}"))?
        .get_password()
        .map_err(|e| format!("无法读取翻译凭据: {e}"))
}

#[tauri::command]
pub fn save_translation_override(
    state: State<'_, PromptVaultState>,
    input: SaveTranslationInput,
) -> Result<TranslationResult, String> {
    if input.source_text.trim().is_empty() || input.translated_text.trim().is_empty() {
        return Err("原文和译文不能为空".into());
    }
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    conn.execute(
        "INSERT INTO translation_cache(
           source_text,target_language,provider,translated_text,locked,updated_at
         ) VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(source_text,target_language,provider) DO UPDATE SET
           translated_text=excluded.translated_text,locked=excluded.locked,updated_at=excluded.updated_at",
        params![
            input.source_text.trim(),
            input.target_language,
            input.provider,
            input.translated_text.trim(),
            input.locked as i64,
            now()
        ],
    )
    .map_err(|e| format!("无法保存人工译文: {e}"))?;
    Ok(TranslationResult {
        text: input.translated_text,
        cached: true,
    })
}

#[tauri::command]
pub fn import_glossary_csv(
    state: State<'_, PromptVaultState>,
    csv_text: String,
) -> Result<usize, String> {
    if csv_text.len() > 10 * 1024 * 1024 {
        return Err("词表 CSV 不能超过 10 MiB".into());
    }
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(csv_text.as_bytes());
    let mut pairs = Vec::new();
    for (index, record) in reader.records().enumerate() {
        let record = record.map_err(|e| format!("CSV 第 {} 行无效: {e}", index + 1))?;
        if record.len() < 2 {
            continue;
        }
        let source = record.get(0).unwrap_or("").trim();
        let translated = record.get(1).unwrap_or("").trim();
        if index == 0
            && ["english", "英文", "source"]
                .iter()
                .any(|v| source.eq_ignore_ascii_case(v))
        {
            continue;
        }
        if !source.is_empty() && !translated.is_empty() {
            pairs.push((source.to_string(), translated.to_string()));
        }
    }
    let mut conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("无法开始词表导入事务: {e}"))?;
    for (source, translated) in &pairs {
        tx.execute(
            "INSERT INTO glossary(source_text,translated_text,updated_at) VALUES (?1,?2,?3)
             ON CONFLICT(source_text) DO UPDATE SET
               translated_text=excluded.translated_text,updated_at=excluded.updated_at",
            params![source, translated, now()],
        )
        .map_err(|e| format!("无法导入词表: {e}"))?;
    }
    tx.commit().map_err(|e| format!("无法提交词表: {e}"))?;
    Ok(pairs.len())
}

#[allow(dead_code)]
fn builtin_translation(
    state: &State<'_, PromptVaultState>,
    source: &str,
) -> Result<String, String> {
    let conn = state.db.lock().map_err(|_| "数据库锁已损坏".to_string())?;
    let mut output = String::with_capacity(source.len());
    let mut start = 0;
    for (index, character) in source.char_indices() {
        if matches!(character, ',' | '，' | ';' | '；' | '\n') {
            output.push_str(&translate_piece(&conn, &source[start..index])?);
            output.push(character);
            start = index + character.len_utf8();
        }
    }
    output.push_str(&translate_piece(&conn, &source[start..])?);
    Ok(output)
}

#[allow(dead_code)]
fn translate_piece(conn: &rusqlite::Connection, piece: &str) -> Result<String, String> {
    let leading = piece.len() - piece.trim_start().len();
    let trailing = piece.len() - piece.trim_end().len();
    let trimmed = piece.trim();
    if trimmed.is_empty() {
        return Ok(piece.into());
    }
    let translation: Option<String> = conn
        .query_row(
            "SELECT translated_text FROM glossary WHERE source_text=?1 COLLATE NOCASE",
            [trimmed],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("无法读取内置词表: {e}"))?;
    let Some(translation) = translation else {
        return Ok(piece.into());
    };
    Ok(format!(
        "{}{}{}",
        &piece[..leading],
        translation,
        if trailing == 0 {
            ""
        } else {
            &piece[piece.len() - trailing..]
        }
    ))
}

fn translation_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("无法初始化翻译网络客户端: {error}"))
}

fn transport_error(service: &str, error: reqwest::Error) -> String {
    if error.is_timeout() {
        format!(
            "{service} 在 {} 秒内没有响应，已停止等待。请检查网络、API 地址和代理设置。",
            REQUEST_TIMEOUT.as_secs()
        )
    } else if error.is_connect() {
        format!("{service} 连接失败。请检查网络、API 地址和代理设置：{error}")
    } else {
        format!("{service} 请求失败：{error}")
    }
}

fn api_error_detail(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("message"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| {
            let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
            if compact.is_empty() {
                "服务没有提供错误详情".into()
            } else {
                compact.chars().take(500).collect()
            }
        })
}

async fn require_success(service: &str, response: Response) -> Result<Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    let hint = match status.as_u16() {
        400 => "请求参数、API 地址或模型名称不正确",
        401 | 403 => "API 密钥无效、受限或没有该模型的权限",
        404 => "API 地址或模型不存在",
        429 => "已触发速率限制或免费额度已用完",
        500..=599 => "服务端暂时不可用",
        _ => "请求未成功",
    };
    Err(format!(
        "{service} 返回 HTTP {}（{hint}）：{}",
        status.as_u16(),
        api_error_detail(&body)
    ))
}

fn openai_chat_completions_url(endpoint: &str) -> Result<String, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err("翻译 API 地址不能为空".into());
    }
    let mut url = Url::parse(endpoint)
        .map_err(|_| "翻译 API 地址格式无效，必须是完整的 http:// 或 https:// 地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("翻译 API 地址只支持 http:// 或 https://".into());
    }

    let is_google = url.host_str() == Some("generativelanguage.googleapis.com");
    let current_path = url.path().trim_end_matches('/').to_string();
    if is_google && current_path.contains(":generateContent") {
        return Err(format!(
            "这里需要填写 Google 的 OpenAI-compatible 基础地址，而不是 generateContent 地址：{GOOGLE_OPENAI_ENDPOINT}"
        ));
    }
    let next_path = if current_path.ends_with("/chat/completions") {
        current_path
    } else if is_google {
        match current_path.as_str() {
            "" | "/" => "/v1beta/openai/chat/completions".into(),
            "/v1beta" => "/v1beta/openai/chat/completions".into(),
            "/v1beta/openai" => "/v1beta/openai/chat/completions".into(),
            _ => format!("{current_path}/chat/completions"),
        }
    } else {
        format!("{current_path}/chat/completions")
    };
    url.set_path(&next_path);
    Ok(url.to_string())
}

async fn call_ollama(
    endpoint: &str,
    model: &str,
    text: &str,
    target_language: &str,
) -> Result<String, String> {
    let base = endpoint.trim_end_matches('/').trim_end_matches("/v1");
    let url = format!("{base}/api/chat");
    let num_predict = ((text.chars().count() as f64 * 2.2) as i64).clamp(1_024, 8_192);
    let response = translation_client()?
        .post(&url)
        .json(&json!({
            "model": model,
            "stream": false,
            "messages": translation_messages(text, target_language),
            "options": {"temperature": 0.1, "num_predict": num_predict}
        }))
        .send()
        .await
        .map_err(|error| transport_error("Ollama", error))?;
    let response = require_success("Ollama", response).await?;
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Ollama 响应读取失败: {e}"))?;
    let body: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Ollama 响应不是有效 JSON: {e}"))?;
    extract_translation_text(&body).ok_or_else(|| translation_empty_error("Ollama", &body, &raw))
}

async fn call_openai_compatible(
    endpoint: &str,
    model: &str,
    api_key: Option<&str>,
    text: &str,
    target_language: &str,
) -> Result<String, String> {
    // Prefer Google Translate for any Google-hosted endpoint (skip Gemini entirely).
    if is_google_endpoint(endpoint) {
        return call_google_translate_machine(text, target_language).await;
    }

    // Other OpenAI-compatible providers: one structured call, then simple retry,
    // then machine translation as a last resort.
    match translate_openai_once(
        endpoint,
        model,
        api_key,
        text,
        target_language,
        TranslationStyle::Structured,
    )
    .await
    {
        Ok(text) => Ok(text),
        Err(first_error) => {
            match translate_openai_once(
                endpoint,
                model,
                api_key,
                text,
                target_language,
                TranslationStyle::SimpleUserOnly,
            )
            .await
            {
                Ok(text) => Ok(text),
                Err(second_error) => {
                    match call_google_translate_machine(text, target_language).await {
                        Ok(text) => Ok(text),
                        Err(gt_error) => Err(format!(
                        "{first_error}；简化重试失败：{second_error}；Google 翻译也失败：{gt_error}"
                    )),
                    }
                }
            }
        }
    }
}

/// Native Gemini generateContent with safety thresholds lowered for private prompt translation.
async fn call_gemini_native(
    model: &str,
    api_key: Option<&str>,
    text: &str,
    target_language: &str,
) -> Result<String, String> {
    let key = api_key
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| {
            "Google Gemini 需要 API 密钥。请在设置 → 翻译 中保存密钥后再试。".to_string()
        })?;
    let model_id = model
        .trim()
        .trim_start_matches("models/")
        .trim()
        .to_string();
    if model_id.is_empty() {
        return Err("请填写 Gemini 模型名称，例如 gemini-2.5-flash".into());
    }
    let max_tokens = ((text.chars().count() as f64 * 2.5) as u64).clamp(2_048, 8_192);
    let url = gemini_generate_content_url(&model_id, key)?;
    let prompt = simple_user_translation_prompt(text, target_language);
    // Prefer BLOCK_NONE; some accounts/models accept OFF as the studio "Off" threshold.
    let safety = |category: &str| {
        json!({
            "category": category,
            "threshold": "BLOCK_NONE"
        })
    };
    let payload = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens
        },
        "safetySettings": [
            safety("HARM_CATEGORY_HARASSMENT"),
            safety("HARM_CATEGORY_HATE_SPEECH"),
            safety("HARM_CATEGORY_SEXUALLY_EXPLICIT"),
            safety("HARM_CATEGORY_DANGEROUS_CONTENT"),
            safety("HARM_CATEGORY_CIVIC_INTEGRITY")
        ]
    });
    let response = translation_client()?
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| transport_error("Gemini", error))?;
    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Gemini 响应读取失败: {e}"))?;
    if !status.is_success() {
        // If CIVIC_INTEGRITY is unknown on older API, retry without it.
        if status.as_u16() == 400 && raw.contains("CIVIC_INTEGRITY") {
            return call_gemini_native_without_civic(
                model_id.as_str(),
                key,
                text,
                target_language,
                max_tokens,
            )
            .await;
        }
        return Err(format!(
            "Gemini 返回 HTTP {}：{}",
            status.as_u16(),
            api_error_detail(&raw)
        ));
    }
    parse_gemini_generate_content(&raw)
}

#[allow(dead_code)]
fn gemini_generate_content_url(model_id: &str, key: &str) -> Result<String, String> {
    let mut url = Url::parse(&format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent"
    ))
    .map_err(|e| format!("无法构造 Gemini 地址: {e}"))?;
    url.query_pairs_mut().append_pair("key", key);
    Ok(url.to_string())
}

#[allow(dead_code)]
async fn call_gemini_native_without_civic(
    model_id: &str,
    key: &str,
    text: &str,
    target_language: &str,
    max_tokens: u64,
) -> Result<String, String> {
    let url = gemini_generate_content_url(model_id, key)?;
    let prompt = simple_user_translation_prompt(text, target_language);
    let safety = |category: &str| json!({ "category": category, "threshold": "BLOCK_NONE" });
    let payload = json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": max_tokens
        },
        "safetySettings": [
            safety("HARM_CATEGORY_HARASSMENT"),
            safety("HARM_CATEGORY_HATE_SPEECH"),
            safety("HARM_CATEGORY_SEXUALLY_EXPLICIT"),
            safety("HARM_CATEGORY_DANGEROUS_CONTENT")
        ]
    });
    let response = translation_client()?
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| transport_error("Gemini", error))?;
    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Gemini 响应读取失败: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "Gemini 返回 HTTP {}：{}",
            status.as_u16(),
            api_error_detail(&raw)
        ));
    }
    parse_gemini_generate_content(&raw)
}

/// Browser-style Google Translate (client=gtx). Not the Gemini generative API.
pub(crate) async fn call_google_translate_machine(
    text: &str,
    target_language: &str,
) -> Result<String, String> {
    let tl = map_google_translate_lang(target_language);
    // GET query length limits: split on top-level prompt separators when needed.
    let pieces = split_for_machine_translate(text, 1_400);
    let mut output = String::with_capacity(text.len());
    for piece in pieces {
        if piece.trim().is_empty() {
            output.push_str(&piece);
            continue;
        }
        let translated = google_translate_chunk(&piece, &tl).await?;
        output.push_str(&translated);
    }
    let cleaned = clean_translation(&output);
    if cleaned.is_empty() {
        return Err("Google 翻译没有返回译文".into());
    }
    Ok(cleaned)
}

async fn google_translate_chunk(text: &str, tl: &str) -> Result<String, String> {
    let client = translation_client()?;
    // Prefer POST so long prompts are not truncated by GET URL limits.
    let response = client
        .post("https://translate.googleapis.com/translate_a/single")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PromptNook/0.1",
        )
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded;charset=UTF-8",
        )
        .body(form_body(&[
            ("client", "gtx"),
            ("sl", "auto"),
            ("tl", tl),
            ("dt", "t"),
            ("q", text),
        ]))
        .send()
        .await
        .map_err(|error| transport_error("Google 翻译", error))?;
    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("Google 翻译响应读取失败: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "Google 翻译返回 HTTP {}：{}",
            status.as_u16(),
            truncate_for_error(&raw)
        ));
    }
    parse_google_translate_gtx(&raw)
}

fn form_body(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding_encode(k), urlencoding_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn urlencoding_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char);
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn parse_google_translate_gtx(raw: &str) -> Result<String, String> {
    let body: Value = serde_json::from_str(raw).map_err(|e| {
        format!(
            "Google 翻译响应不是有效 JSON: {e}；片段：{}",
            truncate_for_error(raw)
        )
    })?;
    // Shape: [ [ [translated, original, ...], ... ], ... ]
    let mut result = String::new();
    if let Some(sentences) = body
        .as_array()
        .and_then(|root| root.first())
        .and_then(Value::as_array)
    {
        for sentence in sentences {
            if let Some(translated) = sentence
                .as_array()
                .and_then(|parts| parts.first())
                .and_then(Value::as_str)
            {
                result.push_str(translated);
            }
        }
    }
    let cleaned = clean_translation(&result);
    if cleaned.is_empty() {
        return Err(format!(
            "Google 翻译正文为空；片段：{}",
            truncate_for_error(raw)
        ));
    }
    Ok(cleaned)
}

fn map_google_translate_lang(target_language: &str) -> String {
    let lang = target_language.trim().to_ascii_lowercase();
    let named = [
        ("chinese", "zh-CN"),
        ("中文", "zh-CN"),
        ("english", "en"),
        ("japanese", "ja"),
        ("日本語", "ja"),
        ("korean", "ko"),
        ("spanish", "es"),
        ("español", "es"),
        ("french", "fr"),
        ("français", "fr"),
        ("german", "de"),
        ("italian", "it"),
        ("portuguese", "pt"),
        ("russian", "ru"),
        ("arabic", "ar"),
        ("hindi", "hi"),
        ("thai", "th"),
        ("vietnamese", "vi"),
        ("indonesian", "id"),
        ("turkish", "tr"),
        ("polish", "pl"),
        ("dutch", "nl"),
        ("ukrainian", "uk"),
    ];
    if let Some((_, code)) = named.iter().find(|(name, _)| lang == *name) {
        return (*code).to_string();
    }
    let code = target_language.trim();
    if !code.is_empty()
        && code
            .chars()
            .all(|character| character.is_ascii_alphabetic() || character == '-')
    {
        code.to_string()
    } else {
        "en".into()
    }
}

/// Split long prompts on top-level separators so each GET request stays under URL limits.
fn split_for_machine_translate(text: &str, max_chars: usize) -> Vec<String> {
    if text.chars().count() <= max_chars {
        return vec![text.to_string()];
    }
    let mut pieces = Vec::new();
    let mut current = String::new();
    let mut current_len = 0usize;
    let mut start = 0usize;
    for (index, character) in text.char_indices() {
        if matches!(character, ',' | '，' | ';' | '；' | '\n') {
            let segment = &text[start..=index];
            let segment_len = segment.chars().count();
            if current_len > 0 && current_len + segment_len > max_chars {
                pieces.push(std::mem::take(&mut current));
                current_len = 0;
            }
            current.push_str(segment);
            current_len += segment_len;
            start = index + character.len_utf8();
        }
    }
    if start < text.len() {
        let tail = &text[start..];
        let tail_len = tail.chars().count();
        if current_len > 0 && current_len + tail_len > max_chars {
            pieces.push(current);
            pieces.push(tail.to_string());
        } else {
            current.push_str(tail);
            pieces.push(current);
        }
    } else if !current.is_empty() {
        pieces.push(current);
    }
    if pieces.is_empty() {
        vec![text.to_string()]
    } else {
        pieces
    }
}

fn parse_gemini_generate_content(raw: &str) -> Result<String, String> {
    let body: Value = serde_json::from_str(raw).map_err(|e| {
        format!(
            "Gemini 响应不是有效 JSON: {e}；片段：{}",
            truncate_for_error(raw)
        )
    })?;

    if let Some(reason) = body
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return Err(format!(
            "Gemini blocked this input ({reason}). This is controlled by the provider's safety policy; try another configured provider or enter the translation manually."
        ));
    }

    if let Some(finish) = body
        .pointer("/candidates/0/finishReason")
        .and_then(Value::as_str)
    {
        if finish.eq_ignore_ascii_case("SAFETY")
            || finish.eq_ignore_ascii_case("PROHIBITED_CONTENT")
            || finish.contains("PROHIBITED")
        {
            return Err(
                "Gemini blocked the translation because of its safety policy. Try another configured provider or enter the translation manually."
                    .into(),
            );
        }
        if finish.eq_ignore_ascii_case("MAX_TOKENS") {
            return Err("Gemini 输出长度不足，译文被截断。请换更大输出额度的模型后重试。".into());
        }
    }

    // Standard: candidates[0].content.parts[*].text
    if let Some(parts) = body
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
    {
        let mut joined = String::new();
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !joined.is_empty() {
                    joined.push('\n');
                }
                joined.push_str(text);
            }
        }
        let cleaned = clean_translation(&joined);
        if !cleaned.is_empty() {
            return Ok(cleaned);
        }
    }

    if let Some(text) = extract_translation_text(&body) {
        return Ok(text);
    }

    Err(format!(
        "Gemini 没有返回译文。响应片段：{}",
        truncate_for_error(raw)
    ))
}

#[derive(Clone, Copy)]
enum TranslationStyle {
    /// system + user, with max_tokens when the provider accepts it
    Structured,
    /// single user message only — more reliable for some Gemini OpenAI-compat builds
    SimpleUserOnly,
}

fn is_google_endpoint(endpoint: &str) -> bool {
    endpoint.contains("generativelanguage.googleapis.com")
}

async fn translate_openai_once(
    endpoint: &str,
    model: &str,
    api_key: Option<&str>,
    text: &str,
    target_language: &str,
    style: TranslationStyle,
) -> Result<String, String> {
    let mut url = openai_chat_completions_url(endpoint)?;
    let client = translation_client()?;
    let google = is_google_endpoint(&url);
    let max_tokens = ((text.chars().count() as f64 * 2.5) as u64).clamp(2_048, 8_192);

    // Google OpenAI-compat accepts Bearer; some proxies only accept ?key=
    if google {
        if let Some(key) = api_key.filter(|v| !v.trim().is_empty()) {
            if let Ok(mut parsed) = Url::parse(&url) {
                parsed.query_pairs_mut().append_pair("key", key);
                url = parsed.to_string();
            }
        }
    }

    let messages = match style {
        TranslationStyle::Structured => translation_messages(text, target_language),
        TranslationStyle::SimpleUserOnly => vec![json!({
            "role": "user",
            "content": simple_user_translation_prompt(text, target_language),
        })],
    };

    // Gemini OpenAI-compat has been observed to return empty content when max_tokens
    // is rejected or when system prompts trip safety. Prefer a minimal body for Google.
    let payload = if google {
        json!({
            "model": model,
            "temperature": 0.2,
            "messages": messages,
        })
    } else {
        json!({
            "model": model,
            "temperature": 0.1,
            "max_tokens": max_tokens,
            "messages": messages,
        })
    };

    let mut request = client.post(&url).json(&payload);
    if let Some(key) = api_key.filter(|v| !v.is_empty()) {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| transport_error("翻译服务", error))?;
    let status = response.status();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("翻译服务响应读取失败: {e}"))?;
    if !status.is_success() {
        let hint = match status.as_u16() {
            400 => "请求参数、API 地址或模型名称不正确",
            401 | 403 => "API 密钥无效、受限或没有该模型的权限",
            404 => "API 地址或模型不存在",
            429 => "已触发速率限制或免费额度已用完",
            500..=599 => "服务端暂时不可用",
            _ => "请求未成功",
        };
        return Err(format!(
            "翻译服务返回 HTTP {}（{hint}）：{}",
            status.as_u16(),
            api_error_detail(&raw)
        ));
    }
    let body: Value = serde_json::from_str(&raw).map_err(|e| {
        format!(
            "翻译服务响应不是有效 JSON: {e}；片段：{}",
            truncate_for_error(&raw)
        )
    })?;
    if let Some(finish) = body
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
    {
        if finish == "length" {
            return Err(
                "翻译结果被模型输出长度截断。请换支持更长输出的模型，或缩短 Prompt 后重试。".into(),
            );
        }
        if finish == "content_filter" || finish.eq_ignore_ascii_case("safety") {
            return Err(
                "The translation provider applied a content filter. Try another configured provider or enter the translation manually.".into(),
            );
        }
    }
    if let Some(text) = extract_translation_text(&body) {
        return Ok(text);
    }
    Err(translation_empty_error("翻译服务", &body, &raw))
}

fn simple_user_translation_prompt(text: &str, target_language: &str) -> String {
    format!(
        "Translate the complete image-generation prompt below to {target_language}.\n\
         Preserve commas, parentheses, weights, <lora:...>, score_* tokens, and text already written in the target language.\
         Return only the complete translated prompt.\n\n{text}"
    )
}

fn translation_messages(text: &str, target_language: &str) -> Vec<Value> {
    vec![
        json!({
            "role": "system",
            "content": format!(
                "You are a professional translator for image-generation prompts. \
                 Output language: {target_language}. \
                 Translate the full prompt in one reply. \
                 Keep commas, parentheses, weights, <lora:...> and score_* tokens. \
                 Preserve text already written in the target language. \
                 Return only the translated prompt text."
            )
        }),
        json!({
            "role": "user",
            "content": format!(
                "Translate this complete prompt to {target_language}. \
                 One full output only:\n\n{text}"
            )
        }),
    ]
}

fn extract_translation_text(body: &Value) -> Option<String> {
    let pointers = [
        "/choices/0/message/content",
        "/choices/0/delta/content",
        "/choices/0/text",
        "/choices/0/message/reasoning_content",
        "/message/content",
        "/response",
        "/output_text",
        "/output",
        "/text",
        "/candidates/0/content/parts/0/text",
        "/candidates/0/content/parts/0/inlineData",
    ];
    for pointer in pointers {
        if let Some(text) = value_as_plain_text(body.pointer(pointer)) {
            let cleaned = clean_translation(&text);
            if !cleaned.is_empty() {
                return Some(cleaned);
            }
        }
    }

    // Multimodal content arrays under choices[0].message.content
    if let Some(parts) = body
        .pointer("/choices/0/message/content")
        .and_then(Value::as_array)
    {
        let joined = join_content_parts(parts);
        let cleaned = clean_translation(&joined);
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }

    // Last resort: walk JSON for the longest string that looks like a prompt translation.
    if let Some(text) = deepest_text_candidate(body) {
        let cleaned = clean_translation(&text);
        if looks_like_translation_output(&cleaned) {
            return Some(cleaned);
        }
    }
    None
}

fn looks_like_translation_output(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.chars().count() < 8 {
        return false;
    }
    // Reject known metadata enums / roles.
    if matches!(
        trimmed,
        "stop"
            | "length"
            | "content_filter"
            | "assistant"
            | "user"
            | "system"
            | "chat.completion"
            | "chat.completion.chunk"
    ) {
        return false;
    }
    let has_cjk = trimmed
        .chars()
        .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c) || ('\u{3400}'..='\u{4dbf}').contains(&c));
    let has_prompt_separators = trimmed.contains(',')
        || trimmed.contains('，')
        || trimmed.contains('\n')
        || trimmed.contains('(');
    has_cjk || (has_prompt_separators && trimmed.chars().count() >= 16)
}

fn join_content_parts(parts: &[Value]) -> String {
    let mut joined = String::new();
    for part in parts {
        let piece = part
            .get("text")
            .and_then(Value::as_str)
            .or_else(|| part.get("content").and_then(Value::as_str))
            .or_else(|| part.as_str())
            .unwrap_or("");
        if piece.is_empty() {
            continue;
        }
        if !joined.is_empty() {
            joined.push('\n');
        }
        joined.push_str(piece);
    }
    joined
}

fn value_as_plain_text(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if value.is_null() {
        return None;
    }
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(parts) = value.as_array() {
        let joined = join_content_parts(parts);
        if !joined.is_empty() {
            return Some(joined);
        }
    }
    // Some gateways wrap: { "value": "..." } or { "text": "..." }
    if let Some(obj) = value.as_object() {
        for key in ["text", "content", "value", "output"] {
            if let Some(text) = obj.get(key).and_then(Value::as_str) {
                if !text.trim().is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }
    None
}

fn deepest_text_candidate(value: &Value) -> Option<String> {
    let mut best = String::new();
    fn walk(node: &Value, best: &mut String) {
        match node {
            Value::String(s) => {
                let t = s.trim();
                // Prefer longer human text; skip pure ids / urls.
                if t.chars().count() > best.chars().count()
                    && t.chars().count() >= 2
                    && !t.starts_with("http")
                    && !t.starts_with("chatcmpl")
                    && !t.starts_with("model/")
                {
                    *best = t.to_string();
                }
            }
            Value::Array(items) => {
                for item in items {
                    walk(item, best);
                }
            }
            Value::Object(map) => {
                for (key, item) in map {
                    // Skip metadata-ish keys.
                    if matches!(
                        key.as_str(),
                        "id" | "object"
                            | "created"
                            | "model"
                            | "system_fingerprint"
                            | "usage"
                            | "logprobs"
                            | "index"
                    ) {
                        continue;
                    }
                    walk(item, best);
                }
            }
            _ => {}
        }
    }
    walk(value, &mut best);
    if best.is_empty() {
        None
    } else {
        Some(best)
    }
}

fn truncate_for_error(raw: &str) -> String {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(280).collect()
}

fn translation_empty_error(service: &str, body: &Value, raw: &str) -> String {
    if let Some(refusal) = body
        .pointer("/choices/0/message/refusal")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("{service} 拒绝翻译：{refusal}");
    }
    let finish = body
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
        .unwrap_or("");
    if finish.contains("content_filter")
        || finish.contains("PROHIBITED")
        || finish.eq_ignore_ascii_case("safety")
    {
        return format!(
            "{service} applied a content filter ({finish}). Try another configured provider or enter the translation manually."
        );
    }
    // Gemini sometimes returns null content without content_filter.
    let content_null = body
        .pointer("/choices/0/message/content")
        .map(|v| v.is_null())
        .unwrap_or(false);
    let hint = if content_null {
        "message.content 为 null（常见于安全策略静默拦截）"
    } else if finish.is_empty() {
        "响应里没有可用文本字段"
    } else {
        "响应结构无法解析或正文为空"
    };
    format!(
        "{service} 没有返回译文（{hint}；finish_reason={finish}）。响应片段：{}",
        truncate_for_error(raw)
    )
}

fn clean_translation(value: &str) -> String {
    let mut text = value.trim().to_string();
    // Strip ```lang ... ``` fences that many chat models wrap around long prompts.
    if text.starts_with("```") {
        if let Some(first_line_end) = text.find('\n') {
            text = text[first_line_end + 1..].to_string();
        } else {
            text = text.trim_start_matches('`').to_string();
        }
        if let Some(end) = text.rfind("```") {
            text = text[..end].to_string();
        }
    }
    text = text
        .trim()
        .trim_matches('`')
        .trim_matches('"')
        .trim()
        .to_string();
    // Some models prefix with "Translation:" / "译文："
    for prefix in [
        "Translation:",
        "translation:",
        "译文：",
        "译文:",
        "中文：",
        "中文:",
    ] {
        if let Some(rest) = text.strip_prefix(prefix) {
            text = rest.trim().to_string();
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_provider_markdown_wrapping() {
        assert_eq!(clean_translation("  `最佳质量` \n"), "最佳质量");
        assert_eq!(clean_translation("\"肖像\""), "肖像");
        assert_eq!(
            clean_translation("```text\n杰作, 最佳质量\n```"),
            "杰作, 最佳质量"
        );
        assert_eq!(clean_translation("译文：侧身站立"), "侧身站立");
    }

    #[test]
    fn extracts_openai_and_array_content() {
        let body = json!({
            "choices": [{
                "message": { "content": "  masterwork, portrait  " }
            }]
        });
        assert_eq!(
            extract_translation_text(&body).as_deref(),
            Some("masterwork, portrait")
        );
        let array_body = json!({
            "choices": [{
                "message": {
                    "content": [
                        {"type": "text", "text": "第一段"},
                        {"type": "text", "text": "第二段"}
                    ]
                }
            }]
        });
        assert_eq!(
            extract_translation_text(&array_body).as_deref(),
            Some("第一段\n第二段")
        );
    }

    #[test]
    fn parses_google_translate_gtx_payload() {
        let raw = r#"[[["在画廊, ","At the gallery, ",null,null,3],["肖像","portrait",null,null,3]],null,"en"]"#;
        assert_eq!(parse_google_translate_gtx(raw).unwrap(), "在画廊, 肖像");
    }

    #[test]
    fn splits_long_prompts_on_delimiters() {
        let source = format!("{}{}", "word, ".repeat(200), "end");
        let pieces = split_for_machine_translate(&source, 100);
        assert!(pieces.len() > 1);
        assert_eq!(pieces.join(""), source);
    }

    #[test]
    fn parses_gemini_native_generate_content_parts() {
        let raw = r#"{
          "candidates": [{
            "content": {
              "parts": [{"text": "  在画廊, 肖像, (柔光:1.2)  "}],
              "role": "model"
            },
            "finishReason": "STOP"
          }]
        }"#;
        assert_eq!(
            parse_gemini_generate_content(raw).unwrap(),
            "在画廊, 肖像, (柔光:1.2)"
        );
    }

    #[test]
    fn gemini_native_reports_prompt_block_reason() {
        let raw = r#"{
          "promptFeedback": { "blockReason": "PROHIBITED_CONTENT" },
          "candidates": []
        }"#;
        let err = parse_gemini_generate_content(raw).unwrap_err();
        assert!(err.contains("输入阶段拦截") || err.contains("PROHIBITED"));
    }

    #[test]
    fn extracts_null_content_as_missing_not_false_positive() {
        let body = json!({
            "choices": [{
                "finish_reason": "stop",
                "message": { "role": "assistant", "content": null }
            }],
            "model": "gemini-test",
            "object": "chat.completion"
        });
        assert!(extract_translation_text(&body).is_none());
        let err = translation_empty_error("翻译服务", &body, "{}");
        assert!(err.contains("null") || err.contains("content"));
    }

    #[test]
    fn normalizes_google_openai_compatible_endpoints() {
        for endpoint in [
            "https://generativelanguage.googleapis.com",
            "https://generativelanguage.googleapis.com/v1beta",
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        ] {
            assert_eq!(
                openai_chat_completions_url(endpoint).unwrap(),
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            );
        }
    }

    #[test]
    fn rejects_google_native_generate_content_endpoint_with_actionable_hint() {
        let error = openai_chat_completions_url(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        )
        .unwrap_err();
        assert!(error.contains("OpenAI-compatible"));
        assert!(error.contains(GOOGLE_OPENAI_ENDPOINT));
    }

    #[test]
    fn preserves_complete_proxy_endpoint_and_extracts_json_error() {
        assert_eq!(
            openai_chat_completions_url("https://example.test/v1/chat/completions").unwrap(),
            "https://example.test/v1/chat/completions"
        );
        assert_eq!(
            api_error_detail(r#"{"error":{"message":"API key not valid"}}"#),
            "API key not valid"
        );
    }
}

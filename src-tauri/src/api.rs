use crate::{codegen, mcp, AttachedFile, ChatResponse, ImageResponse, Message};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

#[allow(unused_imports)]
use log::{debug, error, info, warn};

// ── Retry helper ──────────────────────────────────────────────────────────────

/// Send an HTTP request with exponential back-off on 429 / 5xx errors.
/// Falls back to a plain `.send()` if the builder cannot be cloned.
async fn send_with_retry(
    request: reqwest::RequestBuilder,
    max_retries: u32,
) -> Result<reqwest::Response, String> {
    let mut last_err = String::new();
    for attempt in 0..=max_retries {
        if attempt > 0 {
            // 1 s, 2 s, 4 s … capped at 16 s
            let delay_ms = 1_000u64 * 2u64.pow(attempt - 1);
            tokio::time::sleep(std::time::Duration::from_millis(delay_ms.min(16_000))).await;
            warn!("[api] Retrying request (attempt {}/{})", attempt, max_retries);
        }

        let req = match request.try_clone() {
            Some(r) => r,
            // Body is not cloneable (e.g. streaming) — send once, no retries
            None => return request.send().await.map_err(|e| e.to_string()),
        };

        match req.send().await {
            Ok(resp) => {
                let status = resp.status();
                if status.as_u16() == 429 || status.is_server_error() {
                    last_err = format!("HTTP {}", status);
                    warn!("[api] Transient failure ({}), will retry", status);
                    continue;
                }
                return Ok(resp);
            }
            Err(e) => {
                last_err = e.to_string();
                if !e.is_timeout() && !e.is_connect() {
                    // Non-transient error — give up immediately
                    return Err(last_err);
                }
            }
        }
    }
    Err(format!(
        "Request failed after {} retries: {}",
        max_retries, last_err
    ))
}

const OPENROUTER_ENDPOINT: &str = "https://openrouter.ai/api/v1";
const XAI_ENDPOINT: &str = "https://api.x.ai/v1";
const KILOCODE_ENDPOINT: &str = "https://api.kilocode.ai/v1";

pub async fn send_chat_message(
    prompt: String,
    history: Vec<Message>,
    model_id: String,
    publisher: String,
    endpoint: String,
    api_key: String,
    project_id: String,
    use_1m_context: bool,
    use_memory: bool,
    use_grounding: bool,
    thinking_level: Option<String>,
    include_thoughts: bool,
    custom_url: Option<String>,
    custom_login: Option<String>,
    custom_password: Option<String>,
    attached_file: Option<AttachedFile>,
    service_tier: Option<String>,
    use_search: bool,
) -> Result<ChatResponse, String> {
    let client = Client::new();

    let mut url = build_url(
        &endpoint,
        &publisher,
        &model_id,
        &project_id,
        custom_url.as_deref(),
    )?;

    let mut payload = build_payload(
        &publisher,
        &prompt,
        &history,
        use_1m_context,
        use_memory,
        use_grounding,
        thinking_level.as_deref(),
        include_thoughts,
        attached_file.as_ref(),
        &endpoint,
        &model_id,
        service_tier.as_deref(),
        use_search,
    )?;

    // If payload signals xAI Responses API, redirect URL and strip sentinel
    if payload.get("_xai_use_responses_api").and_then(|v| v.as_bool()).unwrap_or(false) {
        payload.as_object_mut().map(|m| m.remove("_xai_use_responses_api"));
        url = format!("{}/responses", XAI_ENDPOINT);
    }

    let request = apply_auth_headers(
        client.post(&url).json(&payload),
        &endpoint,
        &publisher,
        &api_key,
        custom_login.as_deref(),
        custom_password.as_deref(),
        thinking_level.as_deref(),
        use_memory,
    );

    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    parse_response(&body, &publisher, include_thoughts, &prompt)
}

// ── Auth helper ──────────────────────────────────────────────────────────────

/// Attach the correct Authorization (and optional Anthropic beta) headers to a request.
pub(crate) fn apply_auth_headers(
    mut request: reqwest::RequestBuilder,
    endpoint: &str,
    publisher: &str,
    api_key: &str,
    custom_login: Option<&str>,
    custom_password: Option<&str>,
    thinking_level: Option<&str>,
    use_memory: bool,
) -> reqwest::RequestBuilder {
    match endpoint {
        "openrouter" => {
            request = request
                .header("Authorization", format!("Bearer {}", api_key))
                .header("HTTP-Referer", "https://grok-agent.app")
                .header("X-Title", "Grok Agent");
        }
        "xai" | "kilocode" => {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
        "custom" => {
            if let (Some(login), Some(password)) = (custom_login, custom_password) {
                if !login.is_empty() && !password.is_empty() {
                    let credentials = BASE64.encode(format!("{}:{}", login, password));
                    request = request.header("Authorization", format!("Basic {}", credentials));
                } else if !password.is_empty() {
                    request = request.header("Authorization", format!("Bearer {}", password));
                }
            } else if let Some(password) = custom_password {
                if !password.is_empty() {
                    request = request.header("Authorization", format!("Bearer {}", password));
                }
            }
        }
        _ => {}
    }

    if publisher == "anthropic" {
        let mut beta_headers: Vec<&str> = Vec::new();
        if let Some(level) = thinking_level {
            if level != "none" && !level.is_empty() {
                beta_headers.push("interleaved-thinking-2025-05-14");
            }
        }
        if use_memory {
            beta_headers.push("context-management-2025-06-27");
        }
        if !beta_headers.is_empty() {
            request = request.header("anthropic-beta", beta_headers.join(","));
        }
    }

    request
}

// ── SSE streaming ─────────────────────────────────────────────────────────────

/// Parse a single SSE `data: ...` line and emit a `chat-stream-token` event if it
/// carries a text delta.  Mutates the running token-count accumulators.
fn process_sse_line(
    line: &str,
    publisher: &str,
    task_id: &str,
    app_handle: &AppHandle,
    full_content: &mut String,
    input_tokens: &mut u32,
    output_tokens: &mut u32,
) {
    if !line.starts_with("data: ") {
        return;
    }
    let data = &line[6..];
    if data == "[DONE]" {
        return;
    }

    let Ok(json) = serde_json::from_str::<Value>(data) else { return };

    // ── Extract text delta ──────────────────────────────────────────────────
    let token: Option<String> = if publisher == "anthropic" {
        // {"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}
        json.get("delta")
            .filter(|d| {
                d.get("type").and_then(|t| t.as_str()) == Some("text_delta")
            })
            .and_then(|d| d.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()))
    } else {
        // OpenAI/xAI: {"choices":[{"delta":{"content":"…"}}]}
        json.get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|ch| ch.get("delta"))
            .and_then(|d| d.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string())
    };

    if let Some(tok) = token {
        if !tok.is_empty() {
            full_content.push_str(&tok);
            let _ = app_handle.emit(
                "chat-stream-token",
                json!({ "taskId": task_id, "content": tok }),
            );
        }
    }

    // ── Extract usage (arrives in the last chunk for both formats) ──────────
    if let Some(usage) = json.get("usage") {
        if let Some(n) = usage
            .get("prompt_tokens")
            .or_else(|| usage.get("input_tokens"))
            .and_then(|t| t.as_u64())
        {
            *input_tokens = n as u32;
        }
        if let Some(n) = usage
            .get("completion_tokens")
            .or_else(|| usage.get("output_tokens"))
            .and_then(|t| t.as_u64())
        {
            *output_tokens = n as u32;
        }
    }
    // Anthropic: message_start has usage inside "message"
    if let Some(msg) = json.get("message") {
        if let Some(usage) = msg.get("usage") {
            if let Some(n) = usage.get("input_tokens").and_then(|t| t.as_u64()) {
                *input_tokens = n as u32;
            }
        }
    }
}

/// Stream a chat completion token-by-token, emitting `chat-stream-token` events
/// and a final `chat-stream-done` event.  Falls back to buffered mode for
/// endpoints that do not support streaming (e.g. xAI Responses API / search).
pub async fn stream_chat_message(
    app_handle: AppHandle,
    task_id: String,
    prompt: String,
    history: Vec<Message>,
    model_id: String,
    publisher: String,
    endpoint: String,
    api_key: String,
    project_id: String,
    use_1m_context: bool,
    use_memory: bool,
    use_grounding: bool,
    thinking_level: Option<String>,
    include_thoughts: bool,
    custom_url: Option<String>,
    custom_login: Option<String>,
    custom_password: Option<String>,
    attached_file: Option<AttachedFile>,
    service_tier: Option<String>,
    use_search: bool,
) -> Result<(), String> {
    let client = Client::new();

    let url = build_url(&endpoint, &publisher, &model_id, &project_id, custom_url.as_deref())?;

    let mut payload = build_payload(
        &publisher,
        &prompt,
        &history,
        use_1m_context,
        use_memory,
        use_grounding,
        thinking_level.as_deref(),
        include_thoughts,
        attached_file.as_ref(),
        &endpoint,
        &model_id,
        service_tier.as_deref(),
        use_search,
    )?;

    // xAI Responses API (use_search) does not support streaming — fall back.
    if payload
        .get("_xai_use_responses_api")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        let result = send_chat_message(
            prompt.clone(), history, model_id, publisher, endpoint, api_key,
            project_id, use_1m_context, use_memory, use_grounding, thinking_level,
            include_thoughts, custom_url, custom_login, custom_password,
            attached_file, service_tier, use_search,
        )
        .await?;
        let _ = app_handle.emit(
            "chat-stream-token",
            json!({ "taskId": task_id, "content": result.content }),
        );
        let _ = app_handle.emit(
            "chat-stream-done",
            json!({
                "taskId": task_id,
                "inputTokens": result.input_tokens,
                "outputTokens": result.output_tokens,
            }),
        );
        return Ok(());
    }

    // Enable streaming for OpenAI/xAI (Anthropic already has stream:true in payload).
    if publisher != "anthropic" {
        payload["stream"] = json!(true);
        // stream requires messages format, not Responses API format
        payload.as_object_mut().map(|m| m.remove("_xai_use_responses_api"));
    }

    let request = apply_auth_headers(
        client.post(&url).json(&payload),
        &endpoint,
        &publisher,
        &api_key,
        custom_login.as_deref(),
        custom_password.as_deref(),
        thinking_level.as_deref(),
        use_memory,
    );

    let response = request
        .send()
        .await
        .map_err(|e| format!("Stream request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let mut full_content = String::new();
    let mut input_tokens: u32 = (prompt.len() / 4) as u32;
    let mut output_tokens: u32 = 0;
    let mut buffer = String::new();

    let mut byte_stream = response.bytes_stream();
    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream read error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        // Drain complete lines from the buffer
        loop {
            match buffer.find('\n') {
                Some(pos) => {
                    let line = buffer[..pos].trim_end_matches('\r').to_string();
                    buffer = buffer[pos + 1..].to_string();
                    process_sse_line(
                        &line,
                        &publisher,
                        &task_id,
                        &app_handle,
                        &mut full_content,
                        &mut input_tokens,
                        &mut output_tokens,
                    );
                }
                None => break,
            }
        }
    }

    if output_tokens == 0 {
        output_tokens = (full_content.len() / 4) as u32;
    }

    let _ = app_handle.emit(
        "chat-stream-done",
        json!({
            "taskId": task_id,
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
        }),
    );

    Ok(())
}

/// Map aspect ratio string to (width, height) per xAI docs
fn aspect_ratio_to_dims(ratio: &str) -> (u32, u32) {
    match ratio {
        "16:9"  => (1344, 768),
        "9:16"  => (768, 1344),
        "3:2"   => (1152, 768),
        "2:3"   => (768, 1152),
        "4:3"   => (1152, 864),
        "3:4"   => (864, 1152),
        _       => (1024, 1024), // 1:1 default
    }
}

/// Extract cost in USD from `usage.cost_in_usd_ticks`.
/// xAI defines: 1 USD = 10,000,000,000 ticks.
fn ticks_to_usd(body: &Value) -> f64 {
    body.get("usage")
        .and_then(|u| u.get("cost_in_usd_ticks"))
        .and_then(|t| t.as_i64())
        .map(|ticks| ticks as f64 / 10_000_000_000.0)
        .unwrap_or(0.0)
}

/// Build the xAI base URL for image requests, optionally scoped to a region.
/// Supported regions: "us-east-1", "eu-west-1".  Anything else → global api.x.ai.
fn xai_image_base(region: Option<&str>) -> String {
    match region {
        Some("us-east-1") => "https://us-east-1.api.x.ai/v1".to_string(),
        Some("eu-west-1")  => "https://eu-west-1.api.x.ai/v1".to_string(),
        _ => XAI_ENDPOINT.to_string(),
    }
}

pub async fn generate_image(
    prompt: String,
    api_key: String,
    edit_image: Option<String>,
    _edit_image_mime_type: Option<String>,
    model_id: Option<String>,
    _search_mode: Option<String>,
    aspect_ratio: Option<String>,
    region: Option<String>,
    resolution: Option<String>,
) -> Result<ImageResponse, String> {
    let client = Client::new();
    let model = model_id.unwrap_or_else(|| "grok-imagine-image-quality".to_string());
    let base = xai_image_base(region.as_deref());
    let (width, height) = aspect_ratio_to_dims(aspect_ratio.as_deref().unwrap_or("1:1"));
    // "1k" | "2k" — only send when explicitly provided (API defaults to 1k)
    let res_str = resolution.as_deref().unwrap_or("1k");

    if let Some(image_data) = edit_image {
        // Image editing endpoint
        let url = format!("{}/images/edits", base);
        info!("[generate_image] POST {} model={} {}x{} res={} region={:?}", url, model, width, height, res_str, region);
        let payload = json!({
            "model": model,
            "prompt": prompt,
            "image": {
                "url": format!("data:image/png;base64,{}", image_data),
                "type": "image_url"
            },
            "n": 1,
            "width": width,
            "height": height,
            "resolution": res_str,
            "response_format": "b64_json",
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let cost_usd = ticks_to_usd(&body);

        if let Some(data) = body.get("data").and_then(|d| d.as_array()).and_then(|arr| arr.first()) {
            if let Some(b64) = data.get("b64_json").and_then(|b| b.as_str()) {
                info!("[generate_image] edit done cost=${:.4}", cost_usd);
                return Ok(ImageResponse { image: b64.to_string(), cost_usd });
            }
        }
        Err("No image data in response".to_string())
    } else {
        // Image generation endpoint
        let url = format!("{}/images/generations", base);
        info!("[generate_image] POST {} model={} {}x{} res={} region={:?}", url, model, width, height, res_str, region);
        let payload = json!({
            "model": model,
            "prompt": prompt,
            "n": 1,
            "width": width,
            "height": height,
            "resolution": res_str,
            "response_format": "b64_json",
        });

        let response = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("API error {}: {}", status, body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let cost_usd = ticks_to_usd(&body);

        if let Some(data) = body.get("data").and_then(|d| d.as_array()).and_then(|arr| arr.first()) {
            if let Some(b64) = data.get("b64_json").and_then(|b| b.as_str()) {
                info!("[generate_image] generation done cost=${:.4}", cost_usd);
                return Ok(ImageResponse { image: b64.to_string(), cost_usd });
            }
        }
        Err("No image data in response".to_string())
    }
}

pub async fn generate_video(
    app_handle: tauri::AppHandle,
    prompt: String,
    api_key: String,
    model_id: Option<String>,
    duration_seconds: Option<u32>,
    aspect_ratio: Option<String>,
) -> Result<Value, String> {
    let client = Client::new();
    let model = model_id.unwrap_or_else(|| "grok-imagine-video".to_string());
    let url = format!("{}/videos/generations", XAI_ENDPOINT);
    info!("[generate_video] POST {} model={}", url, model);

    let mut payload = json!({
        "model": model,
        "prompt": prompt,
        "duration": duration_seconds.unwrap_or(10),
    });
    if let Some(ref ar) = aspect_ratio {
        if !ar.is_empty() {
            payload["aspect_ratio"] = json!(ar);
        }
    }

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        info!("[generate_video] Submit error {}: {}", status, body);
        return Err(format!("API error {}: {}", status, body));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let request_id = body
        .get("request_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing request_id in response")?
        .to_string();

    info!("[generate_video] request_id={} — polling every 5s (max 10 min)", request_id);
    let _ = app_handle.emit("video-progress", json!({ "message": "Request submitted, waiting for xAI to process...", "elapsed": 0 }));

    let poll_url = format!("{}/videos/{}", XAI_ENDPOINT, request_id);
    let start = std::time::Instant::now();

    for poll in 1u32..=120 {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        let elapsed = start.elapsed().as_secs();

        let poll_resp = client
            .get(&poll_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("Poll failed: {}", e))?;

        if !poll_resp.status().is_success() {
            let status = poll_resp.status();
            let body = poll_resp.text().await.unwrap_or_default();
            info!("[generate_video] Poll #{} error {}: {}", poll, status, body);
            return Err(format!("Poll error {}: {}", status, body));
        }

        let poll_body: Value = poll_resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse poll response: {}", e))?;

        let status_str = poll_body
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown");

        info!("[generate_video] Poll #{} status={} elapsed={}s", poll, status_str, elapsed);
        let _ = app_handle.emit("video-progress", json!({
            "message": format!("Processing… {}s elapsed (poll #{})", elapsed, poll),
            "elapsed": elapsed,
            "poll": poll,
            "status": status_str
        }));

        match status_str {
            "succeeded" | "done" => {
                if let Some(video) = poll_body.get("video") {
                    if let Some(url_val) = video.get("url").and_then(|u| u.as_str()) {
                        // Prefer video.id; fall back to request_id for extension calls
                        let video_id = video
                            .get("id")
                            .and_then(|i| i.as_str())
                            .unwrap_or(&request_id)
                            .to_string();
                        info!("[generate_video] Done in {}s — url={} id={}", elapsed, url_val, video_id);
                        return Ok(json!({ "url": url_val, "videoId": video_id }));
                    }
                }
                return Err("Video succeeded but no URL found".to_string());
            }
            "failed" => {
                let err = poll_body
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("Unknown error");
                info!("[generate_video] Failed: {}", err);
                return Err(format!("Video generation failed: {}", err));
            }
            _ => continue,
        }
    }
    Err("Video generation timed out after 10 minutes".to_string())
}

/// Extend an existing video by appending another segment.
/// Uses POST /v1/videos/extensions with the source video_id.
pub async fn extend_video(
    app_handle: tauri::AppHandle,
    video_id: String,
    api_key: String,
    model_id: Option<String>,
    duration_seconds: Option<u32>,
    prompt: Option<String>,
) -> Result<Value, String> {
    let client = Client::new();
    let model = model_id.unwrap_or_else(|| "grok-imagine-video".to_string());
    let url = format!("{}/videos/extensions", XAI_ENDPOINT);
    info!("[extend_video] POST {} model={} video_id={}", url, model, video_id);

    let mut payload = json!({
        "model": model,
        "video_id": video_id,
        "duration": duration_seconds.unwrap_or(10),
    });
    if let Some(ref p) = prompt {
        if !p.is_empty() {
            payload["prompt"] = json!(p);
        }
    }

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let body: Value = response.json().await.map_err(|e| format!("Parse error: {}", e))?;

    let request_id = body
        .get("request_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing request_id")?
        .to_string();

    info!("[extend_video] request_id={} — polling", request_id);
    let _ = app_handle.emit("video-progress", json!({ "message": "Extension submitted, processing…", "elapsed": 0 }));

    let poll_url = format!("{}/videos/{}", XAI_ENDPOINT, request_id);
    let start = std::time::Instant::now();

    for poll in 1u32..=120 {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        let elapsed = start.elapsed().as_secs();

        let poll_resp = client
            .get(&poll_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|e| format!("Poll failed: {}", e))?;

        if !poll_resp.status().is_success() {
            let status = poll_resp.status();
            let body = poll_resp.text().await.unwrap_or_default();
            return Err(format!("Poll error {}: {}", status, body));
        }

        let poll_body: Value = poll_resp.json().await.map_err(|e| format!("Parse error: {}", e))?;
        let status_str = poll_body.get("status").and_then(|s| s.as_str()).unwrap_or("unknown");

        let _ = app_handle.emit("video-progress", json!({
            "message": format!("Extending… {}s elapsed (poll #{})", elapsed, poll),
            "elapsed": elapsed,
            "poll": poll,
            "status": status_str
        }));

        match status_str {
            "succeeded" | "done" => {
                if let Some(video) = poll_body.get("video") {
                    if let Some(url_val) = video.get("url").and_then(|u| u.as_str()) {
                        let new_video_id = video
                            .get("id")
                            .and_then(|i| i.as_str())
                            .unwrap_or(&request_id)
                            .to_string();
                        info!("[extend_video] Done in {}s — url={}", elapsed, url_val);
                        return Ok(json!({ "url": url_val, "videoId": new_video_id }));
                    }
                }
                return Err("Extension succeeded but no URL found".to_string());
            }
            "failed" => {
                let err = poll_body.get("error").and_then(|e| e.as_str()).unwrap_or("Unknown error");
                return Err(format!("Video extension failed: {}", err));
            }
            _ => continue,
        }
    }
    Err("Video extension timed out".to_string())
}

pub async fn download_video_to_disk(url: String, filename: String) -> Result<String, String> {
    let client = Client::new();
    info!("[download_video] GET {}", url);

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read video bytes: {}", e))?;

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let downloads = home.join("Downloads");
    std::fs::create_dir_all(&downloads)
        .map_err(|e| format!("Could not create Downloads directory: {}", e))?;

    let path = downloads.join(&filename);
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write video file: {}", e))?;

    let path_str = path.to_string_lossy().to_string();
    info!("[download_video] Saved {} bytes → {}", bytes.len(), path_str);
    Ok(path_str)
}

pub async fn generate_speech(
    text: String,
    api_key: String,
    voice_id: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    let client = Client::new();
    let url = format!("{}/tts", XAI_ENDPOINT);
    let payload = json!({
        "text": text,
        "voice_id": voice_id.unwrap_or_else(|| "eve".to_string()),
        "language": language.unwrap_or_else(|| "en".to_string()),
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read audio data: {}", e))?;

    Ok(BASE64.encode(bytes))
}
pub(crate) fn build_url(
    endpoint: &str,
    _publisher: &str,
    _model_id: &str,
    _project_id: &str,
    custom_url: Option<&str>,
) -> Result<String, String> {
    match endpoint {
        "custom" => {
            custom_url
                .map(|u| u.to_string())
                .ok_or_else(|| "Custom URL required".to_string())
        }
        "openrouter" => {
            Ok(format!("{}/chat/completions", OPENROUTER_ENDPOINT))
        }
        "xai" => {
            // use_search is baked into the payload — URL selection handled in build_openai_payload
            Ok(format!("{}/chat/completions", XAI_ENDPOINT))
        }
        "kilocode" => {
            Ok(format!("{}/chat/completions", KILOCODE_ENDPOINT))
        }
        _ => Err(format!("Unknown endpoint: {}", endpoint)),
    }
}

pub(crate) fn build_payload(
    publisher: &str,
    prompt: &str,
    history: &[Message],
    use_1m_context: bool,
    use_memory: bool,
    _use_grounding: bool,
    thinking_level: Option<&str>,
    _include_thoughts: bool,
    attached_file: Option<&AttachedFile>,
    _endpoint: &str,
    model_id: &str,
    _service_tier: Option<&str>,
    use_search: bool,
) -> Result<Value, String> {
    match publisher {
        "anthropic" => build_anthropic_payload(
            prompt,
            history,
            use_1m_context,
            use_memory,
            thinking_level,
            attached_file,
        ),
        "xai" | "openrouter" | "kilocode" => build_openai_payload(
            prompt,
            history,
            attached_file,
            model_id,
            thinking_level,
            use_search,
        ),
        _ => Err(format!("Unknown publisher: {}", publisher)),
    }
}

fn build_anthropic_payload(
    prompt: &str,
    history: &[Message],
    _use_1m_context: bool,
    use_memory: bool,
    thinking_level: Option<&str>,
    attached_file: Option<&AttachedFile>,
) -> Result<Value, String> {
    let mut messages: Vec<Value> = history
        .iter()
        .map(|m| {
            json!({
                "role": m.role,
                "content": m.content
            })
        })
        .collect();

    let mut content = Vec::new();

    if let Some(file) = attached_file {
        if file.mime_type.starts_with("image/") {
            content.push(json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": file.mime_type,
                    "data": file.data
                }
            }));
        } else if file.mime_type == "application/pdf" {
            content.push(json!({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": file.mime_type,
                    "data": file.data
                }
            }));
        } else {
            if let Ok(decoded) = BASE64.decode(&file.data) {
                if let Ok(text) = String::from_utf8(decoded) {
                    content.push(json!({
                        "type": "text",
                        "text": format!("[File: {}]\n{}\n[End of file]", file.path, text)
                    }));
                }
            }
        }
    }

    content.push(json!({
        "type": "text",
        "text": prompt
    }));

    messages.push(json!({
        "role": "user",
        "content": content
    }));

    let mut payload = json!({
        "anthropic_version": "2023-06-01",
        "messages": messages,
        "stream": true
    });

    // Add extended thinking if enabled
    if let Some(level) = thinking_level {
        if level != "none" && !level.is_empty() {
            let budget_tokens = match level {
                "low" => 4096,
                "medium" => 16384,
                "high" => 65536,
                _ => 16384,
            };
            payload["max_tokens"] = json!(std::cmp::max(64000, budget_tokens + 1));
            payload["thinking"] = json!({
                "type": "enabled",
                "budget_tokens": budget_tokens
            });
        } else {
            payload["max_tokens"] = json!(64000);
        }
    } else {
        payload["max_tokens"] = json!(64000);
    }

    if use_memory {
        payload["tools"] = json!([{
            "type": "memory_20250818",
            "name": "memory"
        }]);
    }

    Ok(payload)
}



fn build_openai_payload(
    prompt: &str,
    history: &[Message],
    attached_file: Option<&AttachedFile>,
    model_id: &str,
    thinking_level: Option<&str>,
    use_search: bool,
) -> Result<Value, String> {
    let mut messages: Vec<Value> = history
        .iter()
        .map(|m| {
            json!({
                "role": m.role,
                "content": m.content
            })
        })
        .collect();

    let mut content_parts: Vec<Value> = Vec::new();

    if let Some(file) = attached_file {
        if file.mime_type.starts_with("image/") {
            content_parts.push(json!({
                "type": "image_url",
                "image_url": {
                    "url": format!("data:{};base64,{}", file.mime_type, file.data)
                }
            }));
        } else {
            if let Ok(decoded) = BASE64.decode(&file.data) {
                if let Ok(text) = String::from_utf8(decoded) {
                    content_parts.push(json!({
                        "type": "text",
                        "text": format!("[File: {}]\n{}\n[End of file]", file.path, text)
                    }));
                }
            }
        }
    }

    content_parts.push(json!({
        "type": "text",
        "text": prompt
    }));

    let user_content = if content_parts.len() == 1 {
        json!(prompt)
    } else {
        json!(content_parts)
    };

    messages.push(json!({
        "role": "user",
        "content": user_content
    }));

    let mut payload = json!({
        "model": model_id,
        "messages": messages,
        "stream": false
    });

    if use_search {
        // xAI deprecated search_parameters (returns 410).
        // New approach: Responses API at /v1/responses with tools=[{type:"x_search"}].
        // We embed a sentinel so send_chat_message can redirect to the correct endpoint.
        payload["_xai_use_responses_api"] = json!(true);
        payload["tools"] = json!([{ "type": "x_search" }]);
        // Responses API uses "input" not "messages"
        if let Some(msgs) = payload.get("messages").cloned() {
            payload["input"] = msgs;
            payload.as_object_mut().map(|m| m.remove("messages"));
        }
        // Responses API uses "stream" differently — keep false for now
        payload.as_object_mut().map(|m| m.remove("stream"));
    }

    // xAI reasoning: only "effort" field — valid values: low, medium, high, xhigh
    // multi-agent: controls agent count (low/medium=4 agents, high/xhigh=16 agents)
    if let Some(level) = thinking_level {
        if !level.is_empty() && level != "none" {
            payload["reasoning"] = json!({ "effort": level });
        }
    }

    Ok(payload)
}

fn parse_response(body: &str, publisher: &str, _include_thoughts: bool, prompt: &str) -> Result<ChatResponse, String> {
    let raw_json = body.to_string();
    let input_estimate = (prompt.len() / 4) as u32;
    
    match publisher {
        "anthropic" => parse_anthropic_response(body, raw_json, input_estimate),
        "openrouter" | "xai" | "kilocode" => parse_openai_response(body, raw_json, input_estimate),
        _ => Ok(ChatResponse {
            content: body.to_string(),
            raw_json,
            input_tokens: input_estimate,
            output_tokens: (body.len() / 4) as u32,
        }),
    }
}

fn parse_anthropic_response(body: &str, raw_json: String, input_estimate: u32) -> Result<ChatResponse, String> {
    let mut full_text = String::new();
    let mut input_tokens: u32 = input_estimate;
    let mut output_tokens: u32 = 0;

    for line in body.lines() {
        if line.starts_with("data: ") {
            let data_str = &line[6..];
            if data_str.is_empty() || data_str == "[DONE]" {
                continue;
            }

            if let Ok(data) = serde_json::from_str::<Value>(data_str) {
                if let Some(delta) = data.get("delta") {
                    if delta.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                        if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                            full_text.push_str(text);
                        }
                    }
                }
                if let Some(content_block) = data.get("content_block") {
                    if content_block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = content_block.get("text").and_then(|t| t.as_str()) {
                            full_text.push_str(text);
                        }
                    }
                }
                if let Some(usage) = data.get("usage") {
                    if let Some(input) = usage.get("input_tokens").and_then(|t| t.as_u64()) {
                        input_tokens = input as u32;
                    }
                    if let Some(output) = usage.get("output_tokens").and_then(|t| t.as_u64()) {
                        output_tokens = output as u32;
                    }
                }
                if let Some(msg) = data.get("message") {
                    if let Some(usage) = msg.get("usage") {
                        if let Some(input) = usage.get("input_tokens").and_then(|t| t.as_u64()) {
                            input_tokens = input as u32;
                        }
                        if let Some(output) = usage.get("output_tokens").and_then(|t| t.as_u64()) {
                            output_tokens = output as u32;
                        }
                    }
                }
            }
        }
    }

    if full_text.is_empty() {
        if let Ok(data) = serde_json::from_str::<Value>(body) {
            if let Some(content) = data.get("content").and_then(|c| c.as_array()) {
                for block in content {
                    if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            full_text.push_str(text);
                        }
                    }
                }
            }
            if let Some(usage) = data.get("usage") {
                if let Some(input) = usage.get("input_tokens").and_then(|t| t.as_u64()) {
                    input_tokens = input as u32;
                }
                if let Some(output) = usage.get("output_tokens").and_then(|t| t.as_u64()) {
                    output_tokens = output as u32;
                }
            }
        }
    }

    if output_tokens == 0 {
        output_tokens = (full_text.len() / 4) as u32;
    }

    Ok(ChatResponse {
        content: full_text,
        raw_json,
        input_tokens,
        output_tokens,
    })
}



fn parse_openai_response(body: &str, raw_json: String, input_estimate: u32) -> Result<ChatResponse, String> {
    let mut full_text = String::new();
    let mut reasoning_text = String::new();
    let mut input_tokens: u32 = input_estimate;
    let mut output_tokens: u32 = 0;

    if let Ok(data) = serde_json::from_str::<Value>(body) {
        // --- Chat Completions API shape: choices[0].message.content ---
        if let Some(choices) = data.get("choices").and_then(|c| c.as_array()) {
            if let Some(choice) = choices.first() {
                if let Some(message) = choice.get("message") {
                    if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
                        full_text.push_str(content);
                    }
                    if let Some(reasoning) = message.get("reasoning_content").and_then(|r| r.as_str()) {
                        reasoning_text.push_str(reasoning);
                    }
                }
            }
        }

        // --- xAI Responses API shape: output[].content[].text ---
        if full_text.is_empty() {
            if let Some(output_blocks) = data.get("output").and_then(|o| o.as_array()) {
                for block in output_blocks {
                    let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if block_type == "message" {
                        if let Some(content_arr) = block.get("content").and_then(|c| c.as_array()) {
                            for content_block in content_arr {
                                if content_block.get("type").and_then(|t| t.as_str()) == Some("output_text") {
                                    if let Some(text) = content_block.get("text").and_then(|t| t.as_str()) {
                                        full_text.push_str(text);
                                    }
                                }
                            }
                        }
                    } else if block_type == "reasoning" {
                        if let Some(enc) = block.get("encrypted_content").and_then(|e| e.as_str()) {
                            if !enc.is_empty() {
                                reasoning_text.push_str("[encrypted reasoning]\n");
                            }
                        }
                        // plain summary text
                        if let Some(summary) = block.get("summary").and_then(|s| s.as_array()) {
                            for s in summary {
                                if let Some(t) = s.get("text").and_then(|t| t.as_str()) {
                                    reasoning_text.push_str(t);
                                    reasoning_text.push('\n');
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(usage) = data.get("usage") {
            if let Some(prompt_tokens) = usage.get("prompt_tokens")
                .or_else(|| usage.get("input_tokens"))
                .and_then(|t| t.as_u64()) {
                input_tokens = prompt_tokens as u32;
            }
            if let Some(completion_tokens) = usage.get("completion_tokens")
                .or_else(|| usage.get("output_tokens"))
                .and_then(|t| t.as_u64()) {
                output_tokens = completion_tokens as u32;
            }
        }
    }

    let mut output = String::new();

    if !reasoning_text.is_empty() {
        output.push_str("REASONING\n");
        output.push_str(&"=".repeat(50));
        output.push('\n');
        output.push_str(reasoning_text.trim());
        output.push_str("\n\n");
        output.push_str("ANSWER\n");
        output.push_str(&"=".repeat(50));
        output.push('\n');
    }
    output.push_str(full_text.trim());

    if output_tokens == 0 {
        output_tokens = (output.len() / 4) as u32;
    }

    Ok(ChatResponse {
        content: output,
        raw_json,
        input_tokens,
        output_tokens,
    })
}

// --- Coding Agent ---

const CODING_AGENT_SYSTEM_PROMPT: &str = r#"You are an expert coding agent that builds and modifies software by using tools. You MUST use the provided tools to complete tasks — NEVER just describe what to do, actually do it by calling the tools.

Available tools:
- write_file: Create or overwrite files (auto-creates parent directories)
- read_file: Read file contents
- edit_file: Targeted find-and-replace edits on existing files
- delete_file: Delete a single file (auto-backs up as .bak before deleting). Use this instead of rm.
- run_command: Execute shell commands (install deps, build, test, git, gh CLI, etc.)
- list_directory: View the file tree of a directory
- search_files: Search for a pattern across files (grep-style)
- fetch_url: Fetch a web page and return its readable text. Use for reading docs, checking APIs, or web research.

TASK FOCUS — READ THIS FIRST:
- Start by doing the task, not by reading every file in the project.
- Only read files that are DIRECTLY relevant to what was asked.
- For simple tasks (write a file, delete a file, rename something): do it immediately in 1-2 tool calls.
- Do NOT scan or read the entire codebase unless the task explicitly requires full understanding of it.
- Wrong: reading package.json, Cargo.toml, README, App.tsx, models.ts just to write a FEATURES.md.
- Right: write_file("FEATURES.md", content) immediately.
- If asked to delete a file: call delete_file immediately. Do not read it first.
- If asked to write a file: call write_file immediately with the content.

AMBIGUOUS / OPEN-ENDED PROMPTS — CODE MODE RULES:
- You are in CODE MODE. Your job is to IMPLEMENT, not to plan or advise.
- "How to improve X", "what can be better", "improve this", "enhance this", "make it better":
    1. Read only the most relevant source files (not the entire project).
    2. Pick 2-3 specific concrete improvements.
    3. IMPLEMENT them immediately: edit_file or write_file the actual source code changes.
    4. Run a build/test command to verify.
    5. Summarise what you changed in plain text.
- "How to do X": DO IT. Write the code, run the commands, complete the work.
- The phrase "Plan complete" is STRICTLY FORBIDDEN in code mode. Never output it.
- Never end your response with "Let me know if you'd like to proceed". Always proceed.
- If you find a PLAN.md or FEATURES.md, read it for context — then IMPLEMENT the code described, do not re-document it.
- If the codebase is large and you are unsure which 2-3 improvements to make, pick the simplest high-value ones: add error handling, improve a UI label, fix a known issue, add a missing feature edge case.

CRITICAL RULES:
1. ALWAYS call tools to perform actions. Do not just explain code — write it using write_file.
2. When asked to create something, immediately call write_file to create the files.
3. After creating files, use run_command to verify they work (e.g., run the script, build the project).
4. If a command fails, read the error and fix it by calling edit_file or write_file again.
5. Continue calling tools until the task is fully complete.
6. For new projects, start by creating the main files with write_file.

PATHS:
- All file paths are relative to the working directory (provided separately).
- Use "." to refer to the working directory itself (e.g., list_directory with path ".").
- Use simple relative paths like "src/main.py", "package.json" — do NOT repeat the working directory name.
- Example: if working dir is /Users/user/src/myapp, use "src/index.ts" NOT "myapp/src/index.ts".

SAFETY:
- NEVER delete, remove, or overwrite the user's existing LOCAL source files.
- If the user asks to delete LOCAL files, REFUSE and explain that local file deletion is not allowed for safety.
- The write_file tool auto-backs up any existing file before overwriting.
- Commands like rm, git clean are blocked and will fail.
- git rm is blocked UNLESS used with --cached (which keeps local files).
- Only create NEW files or edit existing files when explicitly asked to modify code.
- Remote-only operations (gh repo delete, git push --force, git rm --cached) are allowed.
- When asked to "remove files from a repo but keep local files":
  1. Use "git rm --cached -r ." to unstage all files (keeps local copies)
  2. Then "git commit -m 'Remove all files'" and "git push" to update the remote
  3. Or use "gh repo delete <owner/name> --yes" then "gh repo create <owner/name> --public" to reset the remote

GIT & GITHUB:
- You have full access to git and the GitHub CLI (gh) via run_command.
- When the user asks to PUSH EXISTING CODE to a repo:
  1. Do NOT create new files or overwrite existing files — the code already exists in the working directory.
  2. Check if git is already initialized: run_command with "git rev-parse --is-inside-work-tree"
  3. If not initialized: run_command with "git init && git branch -M main"
  4. If no .gitignore exists, create one appropriate for the project type
  5. Stage and commit: run_command with "git add . && git commit -m 'Initial commit'"
  6. Add remote and push: run_command with "git remote add origin <URL> && git push -u origin main"
- If the remote repo does not exist, create it with: "gh repo create <owner/name> --public --source=. --push"
- If push fails due to existing content, try: "git pull --rebase origin main" then push again.
- If push fails with "remote already exists", use: "git remote set-url origin <URL>"
- NEVER delete, overwrite, or modify the user's existing source files when they only ask to push code.
- Always use the exact repo URL the user provides."#;

const PLAN_MODE_SYSTEM_PROMPT: &str = r#"You are an expert software architect that creates detailed project plans. You MUST use the provided tools to write planning files to disk.

Available tools:
- write_file: Create or overwrite files (auto-creates parent directories)
- read_file: Read file contents
- list_directory: View the file tree of a directory

YOUR TASK — PLANNING ONLY:
1. WRITE PLAN.md FIRST — immediately, in your very first tool call. Do not read files before writing. Use the working directory listing already provided plus your own knowledge to write a comprehensive plan.
2. Only AFTER writing PLAN.md may you optionally read 1-2 specific files to refine or update it.
3. Write relevant config/scaffold files if the user requested them (package.json, tsconfig.json, etc.).
4. STOP after writing.

CRITICAL RULES:
1. Your FIRST tool call MUST be write_file("PLAN.md", ...) — never read_file or list_directory first.
2. Do NOT write any application source code — no components, pages, utilities, hooks, or styles.
3. Do NOT run any commands — no npm install, no builds, no dev servers, no git commands.
4. Read at most 2 files total. Reading more wastes context and prevents you from writing.
5. After writing PLAN.md, output exactly the text "Plan complete" and STOP. This phrase is ONLY valid in Plan mode.

PATHS:
- All file paths are relative to the working directory (provided separately).
- Use simple relative paths like "PLAN.md", "package.json" — do NOT repeat the working directory name."#;

pub async fn coding_agent_chat(
    messages: Vec<Value>,
    model_id: String,
    publisher: String,
    endpoint: String,
    api_key: String,
    project_id: String,
    working_dir: String,
    agent_timeout: Option<u64>,
    agent_mode: Option<String>,
    thinking_level: Option<String>,
    skills_context: Option<String>,
    block_file_deletion: bool,
    app_handle: AppHandle,
    cancel_flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
    mcp_state: mcp::McpState,
) -> Result<Value, String> {
    let client = Client::new();

    // Build tool list: built-in tools + all connected MCP tools
    let mut tools = codegen::agent_tools_schema();
    {
        let mcp_tools = mcp::get_all_tools(&mcp_state).await;
        if !mcp_tools.is_empty() {
            info!("[agent] Adding {} MCP tool(s) to schema", mcp_tools.len());
        }
        for (_server, namespaced_name, tool) in &mcp_tools {
            tools.push(json!({
                "name": namespaced_name,
                "description": format!("[MCP] {}", tool.description.as_deref().unwrap_or(&tool.name)),
                "input_schema": tool.input_schema.clone()
                    .unwrap_or(json!({"type": "object", "properties": {}}))
            }));
        }
    }

    let max_iterations = 15;

    info!("[agent] Starting — model={}, publisher={}, endpoint={}, working_dir={}", model_id, publisher, endpoint, working_dir);
    let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Starting agent: model={}, endpoint={}, working_dir={}", model_id, endpoint, working_dir)}));

    // Only auto-create if directory doesn't already exist — user-selected dirs must exist
    let wd_path = std::path::Path::new(&working_dir);
    if !wd_path.exists() {
        let err = format!("Working directory does not exist: {}. Please create it or select a different directory.", working_dir);
        info!("[agent] ERROR: {}", err);
        return Err(err);
    }

    // Pre-scan working directory to give model context
    let dir_listing = match codegen::exec_list_directory(&working_dir, ".", 2).await {
        Ok(listing) => listing,
        Err(_) => "empty directory".to_string(),
    };
    let context_prefix = format!(
        "[Working directory: {}]\n[Current files:\n{}]\n\nUser request: ",
        working_dir, dir_listing
    );

    // Normalize conversation format per publisher and inject context into first user message
    let mut conversation = messages.clone();
    if let Some(first) = conversation.first_mut() {
        if let Some(content) = first.get("content").and_then(|c| c.as_str()) {
            // Plain string content
            first["content"] = json!(format!("{}{}", context_prefix, content));
        } else if let Some(arr) = first.get("content").and_then(|c| c.as_array()) {
            // Array content (image + text) — prepend context to the text part
            let mut new_arr = arr.clone();
            let mut prepended = false;
            for item in new_arr.iter_mut() {
                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        item["text"] = json!(format!("{}{}", context_prefix, text));
                        prepended = true;
                        break;
                    }
                }
            }
            if !prepended {
                new_arr.push(json!({"type": "text", "text": context_prefix.trim_end()}));
            }
            first["content"] = json!(new_arr);
        }
    }

    // Track whether the agent actually wrote/edited/deleted any file this session.
    // Used to detect "Plan complete" responses that did nothing concrete.
    let mut files_modified = false;

    // Cumulative token counts across all iterations (emitted in coding-agent-complete).
    let mut total_input_tokens: u32 = 0;
    let mut total_output_tokens: u32 = 0;

    // Read-gate: count consecutive iterations where only read_file/list_directory were called.
    // After the threshold, inject a hard "stop reading, write now" message.
    let mut read_only_streak: u32 = 0;
    let read_gate_threshold: u32 = 3;

    for iteration in 0..max_iterations {
        if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
            info!("[agent] Cancelled by user at iteration {}", iteration);
                let _ = app_handle.emit("coding-agent-complete", json!({"iteration": iteration, "stop_reason": "user_cancelled", "totalInputTokens": total_input_tokens, "totalOutputTokens": total_output_tokens}));
                return Ok(json!({"text": "Stopped by user", "iterations": iteration, "stop_reason": "user_cancelled"}));
        }

        // Read-gate: if the agent has spent too many iterations only reading, force a write
        if read_only_streak >= read_gate_threshold {
            info!("[agent] Read-gate triggered at iteration {} (streak={})", iteration, read_only_streak);
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Read-gate: {} read-only iterations — injecting write nudge", read_only_streak), "iteration": iteration}));
            conversation.push(json!({
                "role": "user",
                "content": "STOP READING FILES. You have already read enough context. You MUST call write_file RIGHT NOW to produce your output. Do not call read_file or list_directory again. Write the file immediately."
            }));
            read_only_streak = 0;
        }

        let agent_model_id = if publisher == "anthropic" {
            model_id.replace("streamRawPredict", "rawPredict")
        } else {
            model_id.replace("streamGenerateContent", "generateContent")
        };
        // grok-4.20-multi-agent requires the Responses API — Chat Completions returns 400
        let use_responses_api = agent_model_id.contains("multi-agent") && endpoint == "xai";
        let url = if use_responses_api {
            format!("{}/responses", XAI_ENDPOINT)
        } else {
            build_url(&endpoint, &publisher, &agent_model_id, &project_id, None)?
        };
        info!("[agent] Iteration {} — POST {} (responses_api={})", iteration, url, use_responses_api);
        let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Iteration {} — calling API: {}", iteration, url), "iteration": iteration}));

        let base_prompt = if agent_mode.as_deref() == Some("plan") {
            PLAN_MODE_SYSTEM_PROMPT
        } else {
            CODING_AGENT_SYSTEM_PROMPT
        };
        // Prepend active Agent Skills instructions if any are loaded
        let prompt_with_skills;
        let system_prompt: &str = if let Some(ref ctx) = skills_context {
            prompt_with_skills = format!("{}\n\n{}", ctx, base_prompt);
            &prompt_with_skills
        } else {
            base_prompt
        };

        let payload = if publisher == "anthropic" {
            let mut p = json!({
                "anthropic_version": "2023-06-01",
                "system": system_prompt,
                "messages": conversation,
                "max_tokens": 64000,
                "tools": tools,
                "stream": false
            });
            p["thinking"] = json!({
                "type": "enabled",
                "budget_tokens": 32768
            });
            p
        } else {
            // OpenAI-compatible tools schema (shared by both paths)
            let openai_tools: Vec<Value> = tools.iter().map(|t| {
                let mut params = t["input_schema"].clone();
                params.as_object_mut().map(|o| o.remove("additionalProperties"));
                json!({
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": params
                    }
                })
            }).collect();

            if use_responses_api {
                // xAI Responses API format — required by grok-4.20-multi-agent.
                // Client-side tools require beta access and are not available generally;
                // send without tools so the model returns a text-only research response.
                let mut input = vec![json!({"role": "system", "content": system_prompt})];
                input.extend(conversation.clone());
                let mut p = json!({
                    "model": agent_model_id,
                    "input": input,
                });
                if let Some(ref level) = thinking_level {
                    if !level.is_empty() && level != "none" {
                        p["reasoning"] = json!({ "effort": level });
                    }
                }
                p
            } else {
                // Standard Chat Completions format (xAI, OpenRouter, Kilo Code)
                let mut openai_messages = vec![json!({"role": "system", "content": system_prompt})];
                openai_messages.extend(conversation.clone());

                let mut p = json!({
                    "model": agent_model_id,
                    "messages": openai_messages,
                    "tools": openai_tools,
                    "tool_choice": "auto",
                    "max_tokens": 16384,
                    "temperature": 0.0
                });
                if let Some(ref level) = thinking_level {
                    if !level.is_empty() && level != "none" {
                        p["reasoning"] = json!({ "effort": level });
                    }
                }
                p
            }
        };

        let mut request = client.post(&url).json(&payload);
        match endpoint.as_str() {
            "openrouter" => {
                request = request
                    .header("Authorization", format!("Bearer {}", api_key))
                    .header("HTTP-Referer", "https://grok-agent.app")
                    .header("X-Title", "Grok Agent");
            }
            "xai" | "kilocode" => {
                request = request.header("Authorization", format!("Bearer {}", api_key));
            }
            "custom" => {
                if !api_key.is_empty() {
                    request = request.header("Authorization", format!("Bearer {}", api_key));
                }
            }
            _ => {}
        }
        if publisher == "anthropic" {
            request = request.header("anthropic-beta", "interleaved-thinking-2025-05-14");
        }
        let timeout_secs = agent_timeout.unwrap_or(900);
        request = request.timeout(std::time::Duration::from_secs(timeout_secs));

        let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Calling {} (iteration {})...", if publisher == "anthropic" { "Claude" } else { "Grok" }, iteration + 1), "iteration": iteration}));

        let response = send_with_retry(request, 3).await.map_err(|e| {
            let err = format!("Request failed after retries: {}", e);
            info!("[agent] {}", err);
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": err, "iteration": iteration}));
            err
        })?;
        let status = response.status();
        info!("[agent] Response status: {}", status);
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let err = format!("API error {}: {}", status, body);
            info!("[agent] ERROR: {}", err);
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": err, "iteration": iteration}));
            return Err(format!("API error {}: {}", status, body));
        }

        let raw_body = response.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
        info!("[agent] Raw response length: {} bytes", raw_body.len());
        info!("[agent] Response preview: {}", &raw_body[..raw_body.len().min(500)]);
        let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Response: {} bytes", raw_body.len()), "iteration": iteration}));

        let body: Value = serde_json::from_str(&raw_body).map_err(|e| format!("Failed to parse response: {}", e))?;

        // Accumulate token usage from this iteration
        if let Some(usage) = body.get("usage") {
            if let Some(n) = usage.get("input_tokens").or_else(|| usage.get("prompt_tokens")).and_then(|t| t.as_u64()) {
                total_input_tokens += n as u32;
            }
            if let Some(n) = usage.get("output_tokens").or_else(|| usage.get("completion_tokens")).and_then(|t| t.as_u64()) {
                total_output_tokens += n as u32;
            }
        }

        if publisher == "anthropic" {
            let content = body.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
            let stop_reason = body.get("stop_reason").and_then(|s| s.as_str()).unwrap_or("");
            info!("[agent] stop_reason={}, content_blocks={}", stop_reason, content.len());
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Response: stop_reason={}, content_blocks={}", stop_reason, content.len()), "iteration": iteration}));

            let mut text_parts = Vec::new();
            let mut tool_uses = Vec::new();

            for block in &content {
                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                info!("[agent]   block type={}", block_type);
                match block_type {
                    "text" => {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            text_parts.push(text.to_string());
                            let _ = app_handle.emit("coding-agent-text", json!({"text": text, "iteration": iteration}));
                        }
                    }
                    "thinking" => {
                        if let Some(text) = block.get("thinking").and_then(|t| t.as_str()) {
                            let _ = app_handle.emit("coding-agent-thinking", json!({"text": text, "iteration": iteration}));
                        }
                    }
                    "tool_use" => { tool_uses.push(block.clone()); }
                    _ => {}
                }
            }

            if tool_uses.is_empty() {
                let joined_text = text_parts.join("\n");
                let plan_complete_response = joined_text.to_lowercase().contains("plan complete")
                    || joined_text.to_lowercase().contains("plan is complete")
                    || (joined_text.to_lowercase().contains("plan") && joined_text.len() < 1200);

                if plan_complete_response && !files_modified && iteration < max_iterations - 2 {
                    info!("[agent] Detected plan-only response with no file writes — re-injecting implementation prompt");
                    let _ = app_handle.emit("coding-agent-debug", json!({"msg": "Plan-only response detected — forcing implementation", "iteration": iteration}));
                    conversation.push(json!({"role": "assistant", "content": content}));
                    conversation.push(json!({"role": "user", "content": "You described improvements but did not implement any. Stop describing. Pick ONE small, concrete improvement from what you described and implement it RIGHT NOW using write_file or edit_file. Just do it — no more planning text."}));
                    continue;
                }

                info!("[agent] No tool calls — completing (stop_reason={})", stop_reason);
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("No tool calls, completing. stop_reason={}", stop_reason), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-complete", json!({"iteration": iteration, "stop_reason": stop_reason, "totalInputTokens": total_input_tokens, "totalOutputTokens": total_output_tokens}));
                return Ok(json!({"text": joined_text, "iterations": iteration + 1, "stop_reason": stop_reason}));
            }

            info!("[agent] {} tool call(s) to execute", tool_uses.len());
            // If all tools this iteration were reads, increment the read streak
            let has_write = tool_uses.iter().any(|t| {
                matches!(t.get("name").and_then(|n| n.as_str()).unwrap_or(""), "write_file" | "edit_file" | "delete_file")
            });
            if !has_write { read_only_streak += 1; } else { read_only_streak = 0; }
            conversation.push(json!({"role": "assistant", "content": content}));
            let mut tool_results: Vec<Value> = Vec::new();

            for tool_use in &tool_uses {
                let tool_name = tool_use.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let tool_id = tool_use.get("id").and_then(|i| i.as_str()).unwrap_or("");
                let input = tool_use.get("input").cloned().unwrap_or(json!({}));

                info!("[agent] Executing tool={}, id={}, input={}", tool_name, tool_id, input);
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Executing: {} — {}", tool_name, input), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-tool-call", json!({"tool": tool_name, "input": input, "tool_use_id": tool_id, "iteration": iteration}));
                if matches!(tool_name, "write_file" | "edit_file" | "delete_file") {
                    files_modified = true;
                    read_only_streak = 0;
                }
                // Route: MCP tool (mcp__server__tool) or built-in
                 let result = if tool_name.starts_with("mcp__") {
                     mcp::call_namespaced_tool(&mcp_state, tool_name, &input).await
                 } else {
                     execute_tool(&working_dir, tool_name, &input, block_file_deletion).await
                 };
                let (content_val, is_error) = match &result {
                    Ok(val) => {
                        info!("[agent] Tool {} OK: {}...", tool_name, &val[..val.len().min(200)]);
                        (val.clone(), false)
                    }
                    Err(e) => {
                        info!("[agent] Tool {} ERROR: {}", tool_name, e);
                        (e.clone(), true)
                    }
                };
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Tool result: {} — error={} — {}", tool_name, is_error, &content_val[..content_val.len().min(300)]), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-tool-result", json!({"tool": tool_name, "result": content_val, "is_error": is_error, "tool_use_id": tool_id, "iteration": iteration}));
                tool_results.push(json!({"type": "tool_result", "tool_use_id": tool_id, "content": content_val, "is_error": is_error}));
            }
            conversation.push(json!({"role": "user", "content": tool_results}));
        } else if use_responses_api {
            // ── xAI Responses API response parsing ───────────────────────────
            // Response shape: { output: [ {type:"message"|"function_call", ...} ] }
            let output = body["output"].as_array().cloned().unwrap_or_default();
            let mut text_content = String::new();
            let mut function_calls: Vec<Value> = Vec::new();

            for item in &output {
                match item.get("type").and_then(|t| t.as_str()) {
                    Some("message") => {
                        if let Some(content_arr) = item.get("content").and_then(|c| c.as_array()) {
                            for cb in content_arr {
                                if cb.get("type").and_then(|t| t.as_str()) == Some("output_text") {
                                    if let Some(text) = cb.get("text").and_then(|t| t.as_str()) {
                                        text_content.push_str(text);
                                        let _ = app_handle.emit("coding-agent-text", json!({"text": text, "iteration": iteration}));
                                    }
                                }
                            }
                        }
                    }
                    Some("function_call") => {
                        function_calls.push(item.clone());
                    }
                    _ => {}
                }
            }

            if !function_calls.is_empty() {
                // Add function_call items to conversation (they become part of `input` next turn)
                for fc in &function_calls {
                    conversation.push(fc.clone());
                }

                let mut had_write = false;
                for fc in &function_calls {
                    let fn_name = fc.get("name").and_then(|n| n.as_str()).unwrap_or("");
                    let fn_args_str = fc.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}");
                    // Responses API uses `call_id`; fall back to `id`
                    let call_id = fc.get("call_id")
                        .or_else(|| fc.get("id"))
                        .and_then(|i| i.as_str())
                        .unwrap_or(fn_name);
                    let fn_args: Value = serde_json::from_str(fn_args_str).unwrap_or(json!({}));

                    info!("[agent] Responses API executing tool={}", fn_name);
                    let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Executing: {} — {}", fn_name, fn_args), "iteration": iteration}));
                    let _ = app_handle.emit("coding-agent-tool-call", json!({"tool": fn_name, "input": fn_args, "tool_use_id": call_id, "iteration": iteration}));
                    if matches!(fn_name, "write_file" | "edit_file" | "delete_file") {
                        files_modified = true;
                        read_only_streak = 0;
                        had_write = true;
                    }

                    let result = if fn_name.starts_with("mcp__") {
                         mcp::call_namespaced_tool(&mcp_state, fn_name, &fn_args).await
                     } else {
                         execute_tool(&working_dir, fn_name, &fn_args, block_file_deletion).await
                     };
                     let (content_val, is_error) = match &result {
                         Ok(val) => (val.clone(), false),
                         Err(e) => (e.clone(), true),
                     };
                     let _ = app_handle.emit("coding-agent-tool-result", json!({"tool": fn_name, "result": content_val, "is_error": is_error, "tool_use_id": call_id, "iteration": iteration}));

                    // Responses API tool result format
                    conversation.push(json!({
                        "type": "function_call_output",
                        "call_id": call_id,
                        "output": content_val,
                    }));
                }
                if !had_write { read_only_streak += 1; }
                continue;
            } else {
                // No tool calls — text-only final response
                let plan_complete_response = text_content.to_lowercase().contains("plan complete")
                    || text_content.to_lowercase().contains("plan is complete")
                    || (text_content.to_lowercase().contains("plan") && text_content.len() < 1200);

                if plan_complete_response && !files_modified && iteration < max_iterations - 2 {
                    let _ = app_handle.emit("coding-agent-debug", json!({"msg": "Plan-only response — forcing implementation", "iteration": iteration}));
                    conversation.push(json!({"role": "user", "content": "You described improvements but did not implement any. Stop describing. Implement RIGHT NOW using write_file or edit_file."}));
                    continue;
                }

                let _ = app_handle.emit("coding-agent-complete", json!({"iteration": iteration, "stop_reason": "stop", "totalInputTokens": total_input_tokens, "totalOutputTokens": total_output_tokens}));
                return Ok(json!({"text": text_content, "iterations": iteration + 1, "stop_reason": "stop"}));
            }
        } else {
            // ── Standard Chat Completions response handling ──────────────────
            let message = body["choices"][0]["message"].clone();
            let content = message.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let tool_calls = message.get("tool_calls").and_then(|t| t.as_array()).cloned().unwrap_or_default();

            if !tool_calls.is_empty() {
                // Add assistant message to conversation
                conversation.push(message.clone());

                // Execute each tool call
                let mut tool_results = Vec::new();
                for tool_call in &tool_calls {
                    let fn_name = tool_call.get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("");
                    let fn_args_str = tool_call.get("function")
                        .and_then(|f| f.get("arguments"))
                        .and_then(|a| a.as_str())
                        .unwrap_or("{}");
                    let fn_args: Value = serde_json::from_str(fn_args_str).unwrap_or(json!({}));

                    info!("[agent] OpenAI executing tool={}, args={}", fn_name, fn_args);
                    let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Executing: {} — {}", fn_name, fn_args), "iteration": iteration}));
                    let _ = app_handle.emit("coding-agent-tool-call", json!({"tool": fn_name, "input": fn_args, "tool_use_id": fn_name, "iteration": iteration}));
                    if matches!(fn_name, "write_file" | "edit_file" | "delete_file") {
                        files_modified = true;
                        read_only_streak = 0;
                    }

                    let result = if fn_name.starts_with("mcp__") {
                         mcp::call_namespaced_tool(&mcp_state, fn_name, &fn_args).await
                     } else {
                         execute_tool(&working_dir, fn_name, &fn_args, block_file_deletion).await
                     };
                     let (content_val, is_error) = match &result {
                         Ok(val) => (val.clone(), false),
                         Err(e) => (e.clone(), true),
                     };
                     let _ = app_handle.emit("coding-agent-tool-result", json!({"tool": fn_name, "result": content_val, "is_error": is_error, "tool_use_id": fn_name, "iteration": iteration}));

                    tool_results.push(json!({
                        "role": "tool",
                        "tool_call_id": tool_call.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                        "content": content_val,
                    }));
                }

                // Each tool result is a separate message in OpenAI format
                for tool_result in tool_results {
                    conversation.push(tool_result);
                }
                // If no write happened this iteration, count it toward the read streak
                if !tool_calls.iter().any(|t| {
                    matches!(t.get("function").and_then(|f| f.get("name")).and_then(|n| n.as_str()).unwrap_or(""), "write_file" | "edit_file" | "delete_file")
                }) {
                    read_only_streak += 1;
                }
                continue;
            } else {
                // No tool calls — check if the model just described a plan without implementing anything
                let plan_complete_response = content.to_lowercase().contains("plan complete")
                    || content.to_lowercase().contains("plan is complete")
                    || (content.to_lowercase().contains("plan") && content.len() < 1200);

                if plan_complete_response && !files_modified && iteration < max_iterations - 2 {
                    // Re-inject: force the agent to actually write something
                    info!("[agent] Detected plan-only response with no file writes — re-injecting implementation prompt");
                    let _ = app_handle.emit("coding-agent-debug", json!({"msg": "Plan-only response detected — forcing implementation", "iteration": iteration}));
                    conversation.push(json!({"role": "assistant", "content": content}));
                    conversation.push(json!({"role": "user", "content": "You described improvements but did not implement any. Stop describing. Pick ONE small, concrete improvement from what you described and implement it RIGHT NOW using write_file or edit_file. Just do it — no more planning text."}));
                    continue;
                }

                // Normal final response
                if !content.is_empty() {
                    let _ = app_handle.emit("coding-agent-text", json!({"text": content, "iteration": iteration}));
                }
                let _ = app_handle.emit("coding-agent-complete", json!({"iteration": iteration, "stop_reason": "stop", "totalInputTokens": total_input_tokens, "totalOutputTokens": total_output_tokens}));
                return Ok(json!({
                    "text": content,
                    "iterations": iteration + 1,
                    "stop_reason": "stop"
                }));
            }
        }
    }
    let _ = app_handle.emit("coding-agent-complete", json!({"iteration": max_iterations, "stop_reason": "max_iterations", "totalInputTokens": total_input_tokens, "totalOutputTokens": total_output_tokens}));
    Ok(json!({"text": "Agent completed (reached iteration limit)", "iterations": max_iterations, "stop_reason": "max_iterations"}))
}

async fn execute_tool(
    working_dir: &str,
    tool_name: &str,
    input: &Value,
    block_file_deletion: bool,
) -> Result<String, String> {
    match tool_name {
        "read_file" => {
            let path = input.get("path").and_then(|p| p.as_str()).unwrap_or("");
            codegen::exec_read_file(working_dir, path).await
        }
        "write_file" => {
            let path = input.get("path").and_then(|p| p.as_str()).unwrap_or("");
            let content = input.get("content").and_then(|c| c.as_str()).unwrap_or("");
            codegen::exec_write_file(working_dir, path, content).await
        }
        "edit_file" => {
            let path = input.get("path").and_then(|p| p.as_str()).unwrap_or("");
            let old_text = input.get("old_text").and_then(|t| t.as_str()).unwrap_or("");
            let new_text = input.get("new_text").and_then(|t| t.as_str()).unwrap_or("");
            codegen::exec_edit_file(working_dir, path, old_text, new_text).await
        }
        "run_command" => {
            let command = input.get("command").and_then(|c| c.as_str()).unwrap_or("");
            let result = codegen::exec_run_command(working_dir, command, block_file_deletion).await?;
            Ok(json!({"exit_code": result.exit_code, "stdout": result.stdout, "stderr": result.stderr}).to_string())
        }
        "list_directory" => {
            let path = input.get("path").and_then(|p| p.as_str()).unwrap_or(".");
            let depth = input.get("max_depth").and_then(|d| d.as_u64()).unwrap_or(3) as u32;
            codegen::exec_list_directory(working_dir, path, depth).await
        }
        "delete_file" => {
            let path = input.get("path").and_then(|p| p.as_str()).unwrap_or("");
            codegen::exec_delete_file(working_dir, path).await
        }
        "fetch_url" => {
            let url = input.get("url").and_then(|u| u.as_str()).unwrap_or("");
            let max_chars = input.get("max_chars").and_then(|m| m.as_u64()).map(|v| v as usize);
            codegen::exec_fetch_url(url, max_chars).await
        }
        _ => Err(format!("Unknown tool: {}", tool_name)),
    }
}



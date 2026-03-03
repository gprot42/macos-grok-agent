use crate::{codegen, AttachedFile, ChatResponse, Message};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::Client;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const VERTEX_AI_ENDPOINT: &str = "https://aiplatform.googleapis.com";
const AI_STUDIO_ENDPOINT: &str = "https://generativelanguage.googleapis.com";
const OPENROUTER_ENDPOINT: &str = "https://openrouter.ai/api/v1";
const XAI_ENDPOINT: &str = "https://api.x.ai/v1";
const KILOCODE_ENDPOINT: &str = "https://api.kilocode.ai/v1";

pub async fn send_chat_message(
    prompt: String,
    history: Vec<Message>,
    model_id: String,
    ai_studio_model_id: Option<String>,
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
) -> Result<ChatResponse, String> {
    let client = Client::new();

    let url = build_url(
        &endpoint,
        &publisher,
        &model_id,
        ai_studio_model_id.as_deref(),
        &project_id,
        custom_url.as_deref(),
    )?;

    let payload = build_payload(
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
    )?;

    let mut request = client.post(&url).json(&payload);

    match endpoint.as_str() {
        "ai_studio" => {
            request = request.header("x-goog-api-key", &api_key);
        }
        "vertex_ai" => {
            // Always prefer service account for Vertex AI
            let token = if crate::auth::has_service_account_key() {
                crate::auth::get_access_token().await?
            } else if !api_key.is_empty() {
                // Fallback to API key if no service account (shouldn't happen but just in case)
                api_key.clone()
            } else {
                return Err("Vertex AI requires a service account. Place your key at ~/.cortex-agent/vertex-key.json".to_string());
            };
            request = request.header("Authorization", format!("Bearer {}", token));
        }
        "openrouter" => {
            request = request
                .header("Authorization", format!("Bearer {}", api_key))
                .header("HTTP-Referer", "https://cortex-agent.app")
                .header("X-Title", "Cortex Agent");
        }
        "xai" | "kilocode" => {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
        "custom" => {
            // Custom endpoint authentication: support both Basic auth (login:password) and Bearer token
            if let (Some(login), Some(password)) = (&custom_login, &custom_password) {
                if !login.is_empty() && !password.is_empty() {
                    // Use Basic authentication
                    use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
                    let credentials = BASE64.encode(format!("{}:{}", login, password));
                    request = request.header("Authorization", format!("Basic {}", credentials));
                } else if !password.is_empty() {
                    // Use Bearer token if only password is provided
                    request = request.header("Authorization", format!("Bearer {}", password));
                }
            } else if let Some(ref password) = custom_password {
                if !password.is_empty() {
                    request = request.header("Authorization", format!("Bearer {}", password));
                }
            }
        }
        _ => {}
    }

    if publisher == "anthropic" {
        let mut beta_headers = Vec::new();
        // Extended thinking for Claude 4 models
        if let Some(ref level) = thinking_level {
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

pub async fn generate_image(
    prompt: String,
    api_key: String,
    edit_image: Option<String>,
    edit_image_mime_type: Option<String>,
    model_id: Option<String>,
) -> Result<String, String> {
    let client = Client::new();
    let model = model_id.unwrap_or_else(|| "gemini-3-pro-image-preview".to_string());
    let url = format!(
        "{}/v1beta/models/{}:generateContent",
        AI_STUDIO_ENDPOINT, model
    );

    let mut parts = vec![json!({"text": prompt})];

    if let Some(image_data) = edit_image {
        // Use provided MIME type, default to image/png if not specified
        let mime_type = edit_image_mime_type.unwrap_or_else(|| "image/png".to_string());
        parts.push(json!({
            "inline_data": {
                "mime_type": mime_type,
                "data": image_data
            }
        }));
    }

    let payload = json!({
        "contents": [{
            "parts": parts
        }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    });

    let response = client
        .post(&url)
        .header("x-goog-api-key", &api_key)
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

    if let Some(candidates) = body.get("candidates").and_then(|c| c.as_array()) {
        if let Some(first) = candidates.first() {
            if let Some(parts) = first
                .get("content")
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.as_array())
            {
                for part in parts {
                    if let Some(inline_data) = part.get("inlineData") {
                        if let Some(data) = inline_data.get("data").and_then(|d| d.as_str()) {
                            return Ok(data.to_string());
                        }
                    }
                }
            }
        }
    }

    Err("No image data in response".to_string())
}

/// Deep Research using the Interactions API
/// This uses the background execution pattern with polling
pub async fn deep_research(
    prompt: String,
    api_key: String,
    timeout_minutes: u32,
) -> Result<ChatResponse, String> {
    let client = Client::new();
    
    // Step 1: Start the research task in background
    let create_url = format!("{}/v1beta/interactions", AI_STUDIO_ENDPOINT);
    
    let create_payload = json!({
        "input": prompt,
        "agent": "deep-research-pro-preview-12-2025",
        "background": true
    });
    
    let create_response = client
        .post(&create_url)
        .header("x-goog-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&create_payload)
        .send()
        .await
        .map_err(|e| format!("Failed to start research: {}", e))?;
    
    if !create_response.status().is_success() {
        let status = create_response.status();
        let body = create_response.text().await.unwrap_or_default();
        return Err(format!("Failed to start research {}: {}", status, body));
    }
    
    let create_body: Value = create_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse create response: {}", e))?;
    
    let interaction_id = create_body
        .get("id")
        .and_then(|id| id.as_str())
        .ok_or_else(|| "No interaction ID in response".to_string())?;
    
    // Step 2: Poll for completion
    let poll_url = format!("{}/v1beta/interactions/{}", AI_STUDIO_ENDPOINT, interaction_id);
    let max_attempts = (timeout_minutes * 6) as usize; // 10s intervals = 6 per minute
    
    for attempt in 0..max_attempts {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        
        let poll_response = client
            .get(&poll_url)
            .header("x-goog-api-key", &api_key)
            .send()
            .await
            .map_err(|e| format!("Poll request failed: {}", e))?;
        
        if !poll_response.status().is_success() {
            let status = poll_response.status();
            let body = poll_response.text().await.unwrap_or_default();
            return Err(format!("Poll failed {}: {}", status, body));
        }
        
        let poll_body: Value = poll_response
            .json()
            .await
            .map_err(|e| format!("Failed to parse poll response: {}", e))?;
        
        let status = poll_body
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown");
        
        match status {
            "completed" => {
                // Extract the final output
                if let Some(outputs) = poll_body.get("outputs").and_then(|o| o.as_array()) {
                    if let Some(last_output) = outputs.last() {
                        if let Some(text) = last_output.get("text").and_then(|t| t.as_str()) {
                            return Ok(ChatResponse {
                                content: text.to_string(),
                                raw_json: serde_json::to_string(&poll_body).unwrap_or_default(),
                                input_tokens: 0,
                                output_tokens: 0,
                            });
                        }
                    }
                }
                return Err("No output text in completed research".to_string());
            }
            "failed" => {
                let error = poll_body
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("Unknown error");
                return Err(format!("Research failed: {}", error));
            }
            "running" | "pending" => {
                // Continue polling
                continue;
            }
            _ => {
                // Unknown status, log and continue
                eprintln!("Unknown research status: {} (attempt {})", status, attempt);
            }
        }
    }
    
    Err(format!("Research timed out after {} minutes", timeout_minutes))
}

pub async fn layout_parse(
    file_data: String,
    mime_type: String,
    mode: String,
    api_key: String,
    system_prompt: String,
) -> Result<String, String> {
    let client = Client::new();

    let model = "gemini-2.5-flash";
    let url = format!(
        "{}/v1beta/models/{}:generateContent",
        AI_STUDIO_ENDPOINT, model
    );

    let payload = json!({
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": file_data
                    }
                },
                {
                    "text": match mode.as_str() {
                        "ocr" => "Parse this document completely. Extract all text, layout elements, headings, tables, figures, headers, and footers with full structural awareness.",
                        "rag" => "Create context-aware chunks from this document optimized for search and RAG retrieval. Each chunk must include ancestral headings and be self-contained.",
                        "structured" => "Extract all structured data from this document into a clean JSON format. Include tables, key-value pairs, figures, sections, and any financial or form data.",
                        _ => "Parse this document and extract its content."
                    }
                }
            ]
        }],
        "generationConfig": {
            "maxOutputTokens": 65536
        }
    });

    let response = client
        .post(&url)
        .header("x-goog-api-key", &api_key)
        .header("Content-Type", "application/json")
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

    if let Some(candidates) = body.get("candidates").and_then(|c| c.as_array()) {
        if let Some(first) = candidates.first() {
            if let Some(parts) = first
                .get("content")
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.as_array())
            {
                let mut result = String::new();
                for part in parts {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        result.push_str(text);
                    }
                }
                if !result.is_empty() {
                    return Ok(result);
                }
            }
        }
    }

    Err("No content in response".to_string())
}

pub async fn speech_to_text(
    audio_data: String,
    mime_type: String,
    language_code: String,
    api_key: String,
    _project_id: String,
) -> Result<String, String> {
    let client = Client::new();

    let model = "gemini-2.5-flash";
    let url = format!(
        "{}/v1beta/models/{}:generateContent",
        AI_STUDIO_ENDPOINT, model
    );

    let lang_label = match language_code.as_str() {
        "en-US" => "English (US)",
        "en-GB" => "English (UK)",
        "ja-JP" => "Japanese",
        "zh-CN" => "Chinese (Simplified)",
        "zh-TW" => "Chinese (Traditional)",
        "ko-KR" => "Korean",
        "es-ES" => "Spanish",
        "fr-FR" => "French",
        "de-DE" => "German",
        "pt-BR" => "Portuguese (Brazil)",
        "it-IT" => "Italian",
        "hi-IN" => "Hindi",
        "ar-SA" => "Arabic",
        "ru-RU" => "Russian",
        "th-TH" => "Thai",
        "vi-VN" => "Vietnamese",
        _ => &language_code,
    };

    let payload = json!({
        "systemInstruction": {
            "parts": [{"text": format!(
                "You are a verbatim speech transcription tool. Your ONLY job is to listen to the audio and write down EXACTLY what was said, word for word, in {}. \
                Rules: \
                1. Output ONLY the exact words spoken. Nothing else. \
                2. Do NOT interpret, summarize, continue, or elaborate. \
                3. Do NOT add any labels, timestamps, commentary, or markdown. \
                4. If the audio is silent or unintelligible, output: [inaudible] \
                5. Preserve natural sentence punctuation.",
                lang_label
            )}]
        },
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": mime_type,
                        "data": audio_data
                    }
                },
                {
                    "text": "Transcribe this audio verbatim."
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.0,
            "topP": 1.0,
            "topK": 1,
            "maxOutputTokens": 65536
        }
    });

    let response = client
        .post(&url)
        .header("x-goog-api-key", &api_key)
        .header("Content-Type", "application/json")
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

    if let Some(candidates) = body.get("candidates").and_then(|c| c.as_array()) {
        if let Some(first) = candidates.first() {
            if let Some(parts) = first
                .get("content")
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.as_array())
            {
                let mut result = String::new();
                for part in parts {
                    if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                        result.push_str(text);
                    }
                }
                if !result.is_empty() {
                    return Ok(result);
                }
            }
        }
    }

    Err("No transcript in response. The audio may be too short, silent, or in an unsupported format.".to_string())
}

fn build_url(
    endpoint: &str,
    publisher: &str,
    model_id: &str,
    ai_studio_model_id: Option<&str>,
    project_id: &str,
    custom_url: Option<&str>,
) -> Result<String, String> {
    match endpoint {
        "custom" => {
            custom_url
                .map(|u| u.to_string())
                .ok_or_else(|| "Custom URL required".to_string())
        }
        "ai_studio" => {
            let model = ai_studio_model_id.unwrap_or(model_id.split(':').next().unwrap_or(model_id));
            Ok(format!(
                "{}/v1beta/models/{}:streamGenerateContent",
                AI_STUDIO_ENDPOINT, model
            ))
        }
        "vertex_ai" => {
            let parts: Vec<&str> = model_id.split(':').collect();
            let model_path = parts.first().unwrap_or(&model_id);
            let method = parts.get(1).unwrap_or(&"predict");
            Ok(format!(
                "{}/v1/projects/{}/locations/global/publishers/{}/models/{}:{}",
                VERTEX_AI_ENDPOINT, project_id, publisher, model_path, method
            ))
        }
        "openrouter" => {
            Ok(format!("{}/chat/completions", OPENROUTER_ENDPOINT))
        }
        "xai" => {
            Ok(format!("{}/chat/completions", XAI_ENDPOINT))
        }
        "kilocode" => {
            Ok(format!("{}/chat/completions", KILOCODE_ENDPOINT))
        }
        _ => Err(format!("Unknown endpoint: {}", endpoint)),
    }
}

fn build_payload(
    publisher: &str,
    prompt: &str,
    history: &[Message],
    use_1m_context: bool,
    use_memory: bool,
    use_grounding: bool,
    thinking_level: Option<&str>,
    include_thoughts: bool,
    attached_file: Option<&AttachedFile>,
    endpoint: &str,
    model_id: &str,
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
        "google" => build_google_payload(
            prompt,
            history,
            use_grounding,
            thinking_level,
            include_thoughts,
            attached_file,
            endpoint,
            model_id,
        ),
        "openrouter" | "xai" | "kilocode" => build_openai_payload(
            prompt,
            history,
            attached_file,
            model_id,
            thinking_level,
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
        "anthropic_version": "vertex-2023-10-16",
        "messages": messages,
        "max_tokens": 64000,
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
            payload["thinking"] = json!({
                "type": "enabled",
                "budget_tokens": budget_tokens
            });
        }
    }

    if use_memory {
        payload["tools"] = json!([{
            "type": "memory_20250818",
            "name": "memory"
        }]);
    }

    Ok(payload)
}

fn build_google_payload(
    prompt: &str,
    history: &[Message],
    use_grounding: bool,
    thinking_level: Option<&str>,
    include_thoughts: bool,
    attached_file: Option<&AttachedFile>,
    endpoint: &str,
    model_id: &str,
) -> Result<Value, String> {
    let mut contents: Vec<Value> = history
        .iter()
        .map(|m| {
            let role = if m.role == "assistant" { "model" } else { "user" };
            json!({
                "role": role,
                "parts": [{"text": m.content}]
            })
        })
        .collect();

    let mut parts = Vec::new();

    if let Some(file) = attached_file {
        if file.mime_type.starts_with("image/") {
            parts.push(json!({
                "inline_data": {
                    "mime_type": file.mime_type,
                    "data": file.data
                }
            }));
        } else {
            if let Ok(decoded) = BASE64.decode(&file.data) {
                if let Ok(text) = String::from_utf8(decoded) {
                    parts.push(json!({
                        "text": format!("[File: {}]\n{}\n[End of file]", file.path, text)
                    }));
                }
            }
        }
    }

    parts.push(json!({"text": prompt}));

    contents.push(json!({
        "role": "user",
        "parts": parts
    }));

    let mut generation_config = json!({
        "maxOutputTokens": 65536
    });

    // Only add thinking config for models that support it
    let supports_thinking = model_id.contains("thinking") || 
                            model_id.contains("gemini-3") || 
                            model_id.contains("gemini-2.0-flash-thinking");
    
    if let Some(level) = thinking_level {
        if supports_thinking && level != "none" {
            generation_config["thinkingConfig"] = json!({
                "includeThoughts": include_thoughts,
                "thinkingLevel": level
            });
        }
    }

    let mut payload = json!({
        "contents": contents,
        "generationConfig": generation_config
    });

    if use_grounding {
        let grounding_tool = if endpoint == "ai_studio" {
            json!({"googleSearch": {}})
        } else {
            json!({"google_search": {}})
        };
        payload["tools"] = json!([grounding_tool]);
    }

    Ok(payload)
}

fn build_openai_payload(
    prompt: &str,
    history: &[Message],
    attached_file: Option<&AttachedFile>,
    model_id: &str,
    thinking_level: Option<&str>,
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

    if let Some(level) = thinking_level {
        if level != "none" {
            let budget = match level {
                "low" => 1024,
                "medium" => 4096,
                "high" => 16384,
                _ => 4096,
            };
            payload["reasoning"] = json!({
                "effort": level,
                "budget_tokens": budget
            });
        }
    }

    Ok(payload)
}

fn parse_response(body: &str, publisher: &str, include_thoughts: bool, prompt: &str) -> Result<ChatResponse, String> {
    let raw_json = body.to_string();
    let input_estimate = (prompt.len() / 4) as u32;
    
    match publisher {
        "anthropic" => parse_anthropic_response(body, raw_json, input_estimate),
        "google" => parse_google_response(body, include_thoughts, raw_json, input_estimate),
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

fn parse_google_response(body: &str, include_thoughts: bool, raw_json: String, input_estimate: u32) -> Result<ChatResponse, String> {
    let mut full_text = String::new();
    let mut thoughts_text = String::new();
    let mut grounding_sources = Vec::new();
    let mut input_tokens: u32 = input_estimate;
    let mut output_tokens: u32 = 0;

    let parse_candidate = |data: &Value| -> (String, String, Vec<(String, String)>, u32, u32) {
        let mut text = String::new();
        let mut thoughts = String::new();
        let mut sources = Vec::new();
        let mut in_tokens: u32 = 0;
        let mut out_tokens: u32 = 0;

        if let Some(candidates) = data.get("candidates").and_then(|c| c.as_array()) {
            if let Some(candidate) = candidates.first() {
                if let Some(parts) = candidate
                    .get("content")
                    .and_then(|c| c.get("parts"))
                    .and_then(|p| p.as_array())
                {
                    for part in parts {
                        if part.get("thought").and_then(|t| t.as_bool()).unwrap_or(false) {
                            if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                thoughts.push_str(t);
                                thoughts.push('\n');
                            }
                        } else if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                }

                if let Some(grounding) = candidate.get("groundingMetadata") {
                    if let Some(chunks) = grounding.get("groundingChunks").and_then(|c| c.as_array()) {
                        for chunk in chunks {
                            if let Some(web) = chunk.get("web") {
                                let title = web.get("title").and_then(|t| t.as_str()).unwrap_or("Source");
                                let uri = web.get("uri").and_then(|u| u.as_str()).unwrap_or("#");
                                sources.push((title.to_string(), uri.to_string()));
                            }
                        }
                    }
                }
            }
        }

        if let Some(usage) = data.get("usageMetadata") {
            if let Some(prompt_tokens) = usage.get("promptTokenCount").and_then(|t| t.as_u64()) {
                in_tokens = prompt_tokens as u32;
            }
            if let Some(candidates_tokens) = usage.get("candidatesTokenCount").and_then(|t| t.as_u64()) {
                out_tokens = candidates_tokens as u32;
            }
        }

        (text, thoughts, sources, in_tokens, out_tokens)
    };

    if body.trim().starts_with('[') {
        if let Ok(arr) = serde_json::from_str::<Vec<Value>>(body) {
            for item in arr {
                let (t, th, s, i, o) = parse_candidate(&item);
                full_text.push_str(&t);
                thoughts_text.push_str(&th);
                grounding_sources.extend(s);
                if i > 0 { input_tokens = i; }
                output_tokens += o;
            }
        }
    } else {
        for line in body.lines() {
            let line = line.trim().trim_end_matches(',');
            if line.is_empty() {
                continue;
            }
            if let Ok(data) = serde_json::from_str::<Value>(line) {
                let (t, th, s, i, o) = parse_candidate(&data);
                full_text.push_str(&t);
                thoughts_text.push_str(&th);
                grounding_sources.extend(s);
                if i > 0 { input_tokens = i; }
                output_tokens += o;
            }
        }
    }

    let mut output = String::new();

    if !thoughts_text.is_empty() && include_thoughts {
        output.push_str("DEEP THINKING PROCESS\n");
        output.push_str(&"=".repeat(50));
        output.push('\n');
        output.push_str(thoughts_text.trim());
        output.push_str("\n\n");
    }

    if !grounding_sources.is_empty() {
        output.push_str("SEARCH SOURCES\n");
        output.push_str(&"=".repeat(50));
        output.push('\n');
        let mut seen = std::collections::HashSet::new();
        let mut idx = 1;
        for (title, uri) in &grounding_sources {
            if seen.insert(uri.clone()) {
                output.push_str(&format!("[{}] {} ({})\n", idx, title, uri));
                idx += 1;
            }
        }
        output.push('\n');
    }

    if !output.is_empty() {
        output.push_str("FINAL ANSWER\n");
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

fn parse_openai_response(body: &str, raw_json: String, input_estimate: u32) -> Result<ChatResponse, String> {
    let mut full_text = String::new();
    let mut reasoning_text = String::new();
    let mut input_tokens: u32 = input_estimate;
    let mut output_tokens: u32 = 0;

    if let Ok(data) = serde_json::from_str::<Value>(body) {
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

        if let Some(usage) = data.get("usage") {
            if let Some(prompt_tokens) = usage.get("prompt_tokens").and_then(|t| t.as_u64()) {
                input_tokens = prompt_tokens as u32;
            }
            if let Some(completion_tokens) = usage.get("completion_tokens").and_then(|t| t.as_u64()) {
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
- run_command: Execute shell commands (install deps, build, test, etc.)
- list_directory: View the file tree of a directory

CRITICAL RULES:
1. ALWAYS call tools to perform actions. Do not just explain code — write it using write_file.
2. When asked to create something, immediately call write_file to create the files.
3. After creating files, use run_command to verify they work (e.g., run the script, build the project).
4. If a command fails, read the error and fix it by calling edit_file or write_file again.
5. Continue calling tools until the task is fully complete.
6. For new projects, start by creating the main files with write_file."#;

pub async fn coding_agent_chat(
    messages: Vec<Value>,
    model_id: String,
    publisher: String,
    endpoint: String,
    api_key: String,
    project_id: String,
    working_dir: String,
    app_handle: AppHandle,
) -> Result<Value, String> {
    let client = Client::new();
    let tools = codegen::agent_tools_schema();
    let max_iterations = 10;

    // Normalize conversation format per publisher
    let mut conversation: Vec<Value> = if publisher == "google" {
        messages.iter().map(|m| {
            json!({
                "role": if m["role"] == "user" { "user" } else { "model" },
                "parts": [{"text": m["content"].as_str().unwrap_or("")}]
            })
        }).collect()
    } else {
        messages
    };

    eprintln!("[CodingAgent] Starting — model={}, publisher={}, endpoint={}, working_dir={}", model_id, publisher, endpoint, working_dir);
    let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Starting agent: model={}, endpoint={}, working_dir={}", model_id, endpoint, working_dir)}));

    // Only auto-create if directory doesn't already exist — user-selected dirs must exist
    let wd_path = std::path::Path::new(&working_dir);
    if !wd_path.exists() {
        let err = format!("Working directory does not exist: {}. Please create it or select a different directory.", working_dir);
        eprintln!("[CodingAgent] ERROR: {}", err);
        return Err(err);
    }

    for iteration in 0..max_iterations {
        let agent_model_id = if publisher == "anthropic" {
            model_id.replace("streamRawPredict", "rawPredict")
        } else {
            model_id.replace("streamGenerateContent", "generateContent")
        };
        // For Google on Vertex, use the global endpoint with non-streaming generateContent
        let url = if publisher == "google" && endpoint == "vertex_ai" {
            let mid_str = agent_model_id.as_str();
            let parts: Vec<&str> = mid_str.split(':').collect();
            let model_path = parts.first().copied().unwrap_or(mid_str);
            format!(
                "{}/v1/projects/{}/locations/global/publishers/google/models/{}:generateContent",
                VERTEX_AI_ENDPOINT, project_id, model_path
            )
        } else {
            build_url(&endpoint, &publisher, &agent_model_id, None, &project_id, None)?
        };
        eprintln!("[CodingAgent] Iteration {} — POST {}", iteration, url);
        let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Iteration {} — calling API: {}", iteration, url), "iteration": iteration}));

        let payload = if publisher == "anthropic" {
            let mut p = json!({
                "anthropic_version": "vertex-2023-10-16",
                "system": CODING_AGENT_SYSTEM_PROMPT,
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
            json!({
                "system_instruction": { "parts": [{"text": CODING_AGENT_SYSTEM_PROMPT}] },
                "contents": conversation,
                "tools": [{ "function_declarations": tools.iter().map(|t| {
                    let mut params = t["input_schema"].clone();
                    params.as_object_mut().map(|o| o.remove("additionalProperties"));
                    json!({ "name": t["name"], "description": t["description"], "parameters": params })
                }).collect::<Vec<_>>() }],
                "tool_config": { "function_calling_config": { "mode": "AUTO" } },
                "generationConfig": { "maxOutputTokens": 64000, "temperature": 0.0 }
            })
        };

        let mut request = client.post(&url).json(&payload);
        match endpoint.as_str() {
            "ai_studio" => { request = request.header("x-goog-api-key", &api_key); }
            "vertex_ai" => {
                let token = if crate::auth::has_service_account_key() {
                    crate::auth::get_access_token().await?
                } else {
                    return Err("Vertex AI requires a service account.".to_string());
                };
                request = request.header("Authorization", format!("Bearer {}", token));
            }
            "openrouter" | "xai" | "kilocode" => {
                request = request.header("Authorization", format!("Bearer {}", api_key));
            }
            _ => {}
        }
        if publisher == "anthropic" {
            request = request.header("anthropic-beta", "interleaved-thinking-2025-05-14");
        }
        request = request.timeout(std::time::Duration::from_secs(120));

        let _ = app_handle.emit("coding-agent-text", json!({"text": format!("Calling {} (iteration {})...", if publisher == "google" { "Gemini" } else { "Claude" }, iteration + 1), "iteration": iteration}));

        let response = request.send().await.map_err(|e| {
            let err = format!("Request failed (timeout or network error): {}", e);
            eprintln!("[CodingAgent] {}", err);
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": err, "iteration": iteration}));
            err
        })?;
        let status = response.status();
        eprintln!("[CodingAgent] Response status: {}", status);
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let err = format!("API error {}: {}", status, body);
            eprintln!("[CodingAgent] ERROR: {}", err);
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": err, "iteration": iteration}));
            return Err(format!("API error {}: {}", status, body));
        }

        let raw_body = response.text().await.map_err(|e| format!("Failed to read response body: {}", e))?;
        eprintln!("[CodingAgent] Raw response length: {} bytes", raw_body.len());
        eprintln!("[CodingAgent] Response preview: {}", &raw_body[..raw_body.len().min(500)]);
        let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Response: {} bytes", raw_body.len()), "iteration": iteration}));

        let body: Value = if publisher == "google" {
            // generateContent returns a single JSON object; streamGenerateContent returns an array
            let parsed: Value = serde_json::from_str(&raw_body)
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            if parsed.is_array() {
                // Merge streamed chunks into one response
                let chunks = parsed.as_array().unwrap();
                let mut all_parts: Vec<Value> = Vec::new();
                let mut finish_reason = String::new();
                for chunk in chunks {
                    if let Some(candidates) = chunk.get("candidates").and_then(|c| c.as_array()) {
                        if let Some(first) = candidates.first() {
                            if let Some(parts) = first.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
                                all_parts.extend(parts.iter().cloned());
                            }
                            if let Some(fr) = first.get("finishReason").and_then(|f| f.as_str()) {
                                finish_reason = fr.to_string();
                            }
                        }
                    }
                }
                json!({"candidates": [{"content": {"parts": all_parts}, "finishReason": finish_reason}]})
            } else {
                parsed
            }
        } else {
            serde_json::from_str(&raw_body).map_err(|e| format!("Failed to parse response: {}", e))?
        };

        if publisher == "anthropic" {
            let content = body.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
            let stop_reason = body.get("stop_reason").and_then(|s| s.as_str()).unwrap_or("");
            eprintln!("[CodingAgent] stop_reason={}, content_blocks={}", stop_reason, content.len());
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Response: stop_reason={}, content_blocks={}", stop_reason, content.len()), "iteration": iteration}));

            let mut text_parts = Vec::new();
            let mut tool_uses = Vec::new();

            for block in &content {
                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                eprintln!("[CodingAgent]   block type={}", block_type);
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
                eprintln!("[CodingAgent] No tool calls — completing (stop_reason={})", stop_reason);
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("No tool calls, completing. stop_reason={}", stop_reason), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-complete", json!({"iteration": iteration, "stop_reason": stop_reason}));
                return Ok(json!({"text": text_parts.join("\n"), "iterations": iteration + 1, "stop_reason": stop_reason}));
            }

            eprintln!("[CodingAgent] {} tool call(s) to execute", tool_uses.len());
            conversation.push(json!({"role": "assistant", "content": content}));
            let mut tool_results: Vec<Value> = Vec::new();

            for tool_use in &tool_uses {
                let tool_name = tool_use.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let tool_id = tool_use.get("id").and_then(|i| i.as_str()).unwrap_or("");
                let input = tool_use.get("input").cloned().unwrap_or(json!({}));

                eprintln!("[CodingAgent] Executing tool={}, id={}, input={}", tool_name, tool_id, input);
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Executing: {} — {}", tool_name, input), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-tool-call", json!({"tool": tool_name, "input": input, "tool_use_id": tool_id, "iteration": iteration}));
                let result = execute_tool(&working_dir, tool_name, &input).await;
                let (content_val, is_error) = match &result {
                    Ok(val) => {
                        eprintln!("[CodingAgent] Tool {} OK: {}...", tool_name, &val[..val.len().min(200)]);
                        (val.clone(), false)
                    }
                    Err(e) => {
                        eprintln!("[CodingAgent] Tool {} ERROR: {}", tool_name, e);
                        (e.clone(), true)
                    }
                };
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Tool result: {} — error={} — {}", tool_name, is_error, &content_val[..content_val.len().min(300)]), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-tool-result", json!({"tool": tool_name, "result": content_val, "is_error": is_error, "tool_use_id": tool_id, "iteration": iteration}));
                tool_results.push(json!({"type": "tool_result", "tool_use_id": tool_id, "content": content_val, "is_error": is_error}));
            }
            conversation.push(json!({"role": "user", "content": tool_results}));
        } else {
            // Google Gemini tool-use handling
            let candidates = body.get("candidates").and_then(|c| c.as_array()).cloned().unwrap_or_default();
            let first = candidates.first().cloned().unwrap_or(json!({}));
            let parts = first.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()).cloned().unwrap_or_default();
            let finish_reason = first.get("finishReason").and_then(|f| f.as_str()).unwrap_or("");

            eprintln!("[CodingAgent] Google response: parts={}, finishReason={}", parts.len(), finish_reason);
            let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Google response: parts={}, finishReason={}", parts.len(), finish_reason), "iteration": iteration}));

            let mut text_parts = Vec::new();
            let mut function_calls = Vec::new();

            for part in &parts {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    eprintln!("[CodingAgent]   text part: {}...", &text[..text.len().min(100)]);
                    text_parts.push(text.to_string());
                    let _ = app_handle.emit("coding-agent-text", json!({"text": text, "iteration": iteration}));
                }
                if let Some(fc) = part.get("functionCall") {
                    eprintln!("[CodingAgent]   functionCall: {}", fc);
                    function_calls.push(fc.clone());
                }
            }

            if function_calls.is_empty() {
                eprintln!("[CodingAgent] Google: no function calls, completing");
                let _ = app_handle.emit("coding-agent-complete", json!({"iteration": iteration, "stop_reason": finish_reason}));
                return Ok(json!({"text": text_parts.join("\n"), "iterations": iteration + 1, "stop_reason": finish_reason}));
            }

            // Add model response to conversation
            conversation.push(json!({
                "role": "model",
                "parts": parts
            }));

            // Execute function calls and build responses
            let mut response_parts: Vec<Value> = Vec::new();
            for fc in &function_calls {
                let fn_name = fc.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let fn_args = fc.get("args").cloned().unwrap_or(json!({}));

                eprintln!("[CodingAgent] Google executing tool={}, args={}", fn_name, fn_args);
                let _ = app_handle.emit("coding-agent-debug", json!({"msg": format!("Executing: {} — {}", fn_name, fn_args), "iteration": iteration}));
                let _ = app_handle.emit("coding-agent-tool-call", json!({"tool": fn_name, "input": fn_args, "tool_use_id": fn_name, "iteration": iteration}));

                let result = execute_tool(&working_dir, fn_name, &fn_args).await;
                let (content_val, is_error) = match &result {
                    Ok(val) => {
                        eprintln!("[CodingAgent] Google tool {} OK: {}...", fn_name, &val[..val.len().min(200)]);
                        (val.clone(), false)
                    }
                    Err(e) => {
                        eprintln!("[CodingAgent] Google tool {} ERROR: {}", fn_name, e);
                        (e.clone(), true)
                    }
                };
                let _ = app_handle.emit("coding-agent-tool-result", json!({"tool": fn_name, "result": content_val, "is_error": is_error, "tool_use_id": fn_name, "iteration": iteration}));

                response_parts.push(json!({
                    "functionResponse": {
                        "name": fn_name,
                        "response": { "result": content_val, "is_error": is_error }
                    }
                }));
            }

            conversation.push(json!({
                "role": "user",
                "parts": response_parts
            }));
        }
    }
    let _ = app_handle.emit("coding-agent-complete", json!({"iteration": max_iterations, "stop_reason": "max_iterations"}));
    Ok(json!({"text": "Agent completed (reached iteration limit)", "iterations": max_iterations, "stop_reason": "max_iterations"}))
}

async fn execute_tool(working_dir: &str, tool_name: &str, input: &Value) -> Result<String, String> {
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
            let result = codegen::exec_run_command(working_dir, command).await?;
            Ok(json!({"exit_code": result.exit_code, "stdout": result.stdout, "stderr": result.stderr}).to_string())
        }
        "list_directory" => {
            let path = input.get("path").and_then(|p| p.as_str()).unwrap_or(".");
            let depth = input.get("max_depth").and_then(|d| d.as_u64()).unwrap_or(3) as u32;
            codegen::exec_list_directory(working_dir, path, depth).await
        }
        _ => Err(format!("Unknown tool: {}", tool_name)),
    }
}



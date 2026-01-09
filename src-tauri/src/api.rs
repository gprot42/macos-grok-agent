use crate::{AttachedFile, ChatResponse, Message};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::Client;
use serde_json::{json, Value};

const VERTEX_AI_ENDPOINT: &str = "https://aiplatform.googleapis.com";
const AI_STUDIO_ENDPOINT: &str = "https://generativelanguage.googleapis.com";

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
    )?;

    let mut request = client.post(&url).json(&payload);

    if endpoint == "ai_studio" {
        request = request.header("x-goog-api-key", &api_key);
    } else if endpoint == "vertex_ai" {
        request = request.header("Authorization", format!("Bearer {}", api_key));
    }

    if publisher == "anthropic" {
        let mut beta_headers = Vec::new();
        if use_1m_context {
            beta_headers.push("context-1m-2025-08-07");
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
) -> Result<String, String> {
    let client = Client::new();
    let url = format!(
        "{}/v1beta/models/gemini-3-pro-image-preview:generateContent",
        AI_STUDIO_ENDPOINT
    );

    let mut parts = vec![json!({"text": prompt})];

    if let Some(image_data) = edit_image {
        parts.push(json!({
            "inline_data": {
                "mime_type": "image/png",
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
) -> Result<Value, String> {
    match publisher {
        "anthropic" => build_anthropic_payload(
            prompt,
            history,
            use_1m_context,
            use_memory,
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
        ),
        _ => Err(format!("Unknown publisher: {}", publisher)),
    }
}

fn build_anthropic_payload(
    prompt: &str,
    history: &[Message],
    _use_1m_context: bool,
    use_memory: bool,
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

    if let Some(level) = thinking_level {
        generation_config["thinkingConfig"] = json!({
            "includeThoughts": include_thoughts,
            "thinkingLevel": level
        });
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

fn parse_response(body: &str, publisher: &str, include_thoughts: bool, prompt: &str) -> Result<ChatResponse, String> {
    let raw_json = body.to_string();
    let input_estimate = (prompt.len() / 4) as u32;
    
    match publisher {
        "anthropic" => parse_anthropic_response(body, raw_json, input_estimate),
        "google" => parse_google_response(body, include_thoughts, raw_json, input_estimate),
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

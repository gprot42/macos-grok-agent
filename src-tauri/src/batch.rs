//! xAI Batch API for Grok Imagine video.
//!
//! Batches are submitted as a JSONL file: each line is a normal
//! `POST /v1/videos/generations` request body, so the payload matches the
//! realtime API exactly. Flow: upload the JSONL (`POST /v1/files`), create the
//! batch with `input_file_id`, then poll status and page through results.
//!
//! Image and video requests are billed at standard rates in a batch (no batch
//! discount); the value is fire-and-forget throughput. Result video URLs are
//! signed and expire about an hour after the results are fetched.

use log::info;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const XAI_ENDPOINT: &str = "https://api.x.ai/v1";
/// Keep a single batch to a sane size for an interactive app.
const MAX_BATCH_PROMPTS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchVideoItem {
    /// Unique within the batch; echoed back as `batch_request_id` in results.
    #[serde(rename = "customId")]
    pub custom_id: String,
    pub prompt: String,
}

/// Settings shared by every video in the batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchVideoSettings {
    pub model: String,
    #[serde(rename = "durationSeconds")]
    pub duration_seconds: u32,
    pub resolution: String,
    #[serde(rename = "aspectRatio")]
    pub aspect_ratio: String,
    #[serde(rename = "withAudio")]
    pub with_audio: bool,
}

/// One JSONL line per prompt, each a realtime `/v1/videos/generations` body.
pub fn build_video_jsonl(items: &[BatchVideoItem], s: &BatchVideoSettings) -> Result<String, String> {
    if items.is_empty() {
        return Err("Add at least one prompt.".to_string());
    }
    if items.len() > MAX_BATCH_PROMPTS {
        return Err(format!(
            "Too many prompts ({}). Maximum is {} per batch.",
            items.len(),
            MAX_BATCH_PROMPTS
        ));
    }
    if !(1..=15).contains(&s.duration_seconds) {
        return Err("Batch videos must be 1–15 seconds (batches can't chain extensions).".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = String::new();
    for item in items {
        let prompt = item.prompt.trim();
        if prompt.is_empty() {
            return Err(format!("Prompt {} is empty.", item.custom_id));
        }
        if !seen.insert(item.custom_id.as_str()) {
            return Err(format!("Duplicate request id {}.", item.custom_id));
        }
        let line = json!({
            "custom_id": item.custom_id,
            "method": "POST",
            "url": "/v1/videos/generations",
            "body": {
                "model": s.model,
                "prompt": prompt,
                "duration": s.duration_seconds,
                "resolution": s.resolution,
                "aspect_ratio": s.aspect_ratio,
                "generate_audio": s.with_audio,
            }
        });
        out.push_str(&line.to_string());
        out.push('\n');
    }
    Ok(out)
}

fn api_err(context: &str, status: reqwest::StatusCode, body: &str) -> String {
    crate::api::format_video_api_error(context, status, body)
}

async fn json_or_err(resp: reqwest::Response, context: &str) -> Result<Value, String> {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        info!("[batch] {} failed {}: {}", context, status, body);
        return Err(api_err(context, status, &body));
    }
    serde_json::from_str(&body).map_err(|e| format!("{}: could not parse response: {}", context, e))
}

/// Upload the JSONL and create the batch. Returns the batch object.
pub async fn create_video_batch(
    api_key: &str,
    name: &str,
    items: Vec<BatchVideoItem>,
    settings: BatchVideoSettings,
) -> Result<Value, String> {
    let jsonl = build_video_jsonl(&items, &settings)?;
    let client = Client::new();

    let part = reqwest::multipart::Part::bytes(jsonl.into_bytes())
        .file_name("grok-agent-video-batch.jsonl")
        .mime_str("application/jsonl")
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("purpose", "batch").part("file", part);
    info!("[batch] uploading JSONL with {} video requests", items.len());
    let file = json_or_err(
        client
            .post(format!("{}/files", XAI_ENDPOINT))
            .bearer_auth(api_key)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Upload failed: {}", e))?,
        "Uploading the batch file",
    )
    .await?;
    let file_id = file
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("The upload response had no file id")?
        .to_string();

    let batch = json_or_err(
        client
            .post(format!("{}/batches", XAI_ENDPOINT))
            .bearer_auth(api_key)
            .json(&json!({ "name": name, "input_file_id": file_id }))
            .send()
            .await
            .map_err(|e| format!("Batch creation failed: {}", e))?,
        "Creating the batch",
    )
    .await?;
    info!("[batch] created {:?} from file {}", batch.get("batch_id"), file_id);
    Ok(batch)
}

pub async fn list_batches(api_key: &str, pagination_token: Option<String>) -> Result<Value, String> {
    let mut req = Client::new()
        .get(format!("{}/batches", XAI_ENDPOINT))
        .bearer_auth(api_key)
        .query(&[("limit", "100")]);
    if let Some(t) = pagination_token.filter(|t| !t.is_empty()) {
        req = req.query(&[("pagination_token", t)]);
    }
    json_or_err(req.send().await.map_err(|e| e.to_string())?, "Listing batches").await
}

pub async fn get_batch(api_key: &str, batch_id: &str) -> Result<Value, String> {
    json_or_err(
        Client::new()
            .get(format!("{}/batches/{}", XAI_ENDPOINT, batch_id))
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?,
        "Loading the batch",
    )
    .await
}

/// All results for a batch (follows pagination, capped for safety).
pub async fn batch_results(api_key: &str, batch_id: &str) -> Result<Value, String> {
    let client = Client::new();
    let mut all: Vec<Value> = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..50 {
        let mut req = client
            .get(format!("{}/batches/{}/results", XAI_ENDPOINT, batch_id))
            .bearer_auth(api_key)
            .query(&[("limit", "100")]);
        if let Some(t) = &token {
            req = req.query(&[("pagination_token", t.as_str())]);
        }
        let page = json_or_err(req.send().await.map_err(|e| e.to_string())?, "Loading batch results").await?;
        if let Some(items) = page.get("results").and_then(|r| r.as_array()) {
            all.extend(items.iter().cloned());
        }
        token = page
            .get("pagination_token")
            .and_then(|t| t.as_str())
            .filter(|t| !t.is_empty())
            .map(String::from);
        if token.is_none() {
            break;
        }
    }
    Ok(json!({ "results": all }))
}

pub async fn cancel_batch(api_key: &str, batch_id: &str) -> Result<Value, String> {
    json_or_err(
        Client::new()
            .post(format!("{}/batches/{}:cancel", XAI_ENDPOINT, batch_id))
            .bearer_auth(api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?,
        "Cancelling the batch",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> BatchVideoSettings {
        BatchVideoSettings {
            model: "grok-imagine-video-1.5-lite".into(),
            duration_seconds: 6,
            resolution: "480p".into(),
            aspect_ratio: "9:16".into(),
            with_audio: true,
        }
    }
    fn item(id: &str, p: &str) -> BatchVideoItem {
        BatchVideoItem { custom_id: id.into(), prompt: p.into() }
    }

    #[test]
    fn builds_one_realtime_body_per_line() {
        let jsonl = build_video_jsonl(&[item("v-1", " a cat "), item("v-2", "a dog")], &settings()).unwrap();
        let lines: Vec<Value> = jsonl.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["custom_id"], "v-1");
        assert_eq!(lines[0]["method"], "POST");
        assert_eq!(lines[0]["url"], "/v1/videos/generations");
        assert_eq!(lines[0]["body"]["prompt"], "a cat");
        assert_eq!(lines[0]["body"]["model"], "grok-imagine-video-1.5-lite");
        assert_eq!(lines[1]["body"]["duration"], 6);
        assert_eq!(lines[1]["body"]["aspect_ratio"], "9:16");
    }

    #[test]
    fn rejects_bad_input() {
        assert!(build_video_jsonl(&[], &settings()).is_err());
        assert!(build_video_jsonl(&[item("v-1", "  ")], &settings()).is_err());
        assert!(build_video_jsonl(&[item("v-1", "a"), item("v-1", "b")], &settings()).is_err());
        let mut long = settings();
        long.duration_seconds = 30;
        assert!(build_video_jsonl(&[item("v-1", "a")], &long).is_err());
    }
}

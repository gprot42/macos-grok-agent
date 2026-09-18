//! Live (streaming) transcription via `wss://api.x.ai/v1/stt`.
//!
//! The webview cannot set an `Authorization` header on a WebSocket, and xAI says to
//! never expose the key client-side — so the socket lives here. The frontend streams
//! PCM16 mic chunks through `live_transcribe_audio`; every server event is forwarded
//! to the webview as a `stt-live` Tauri event.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use serde_json::{json, Value};
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue, Message};

const XAI_STT_WS: &str = "wss://api.x.ai/v1/stt";
pub const LIVE_EVENT: &str = "stt-live";

enum LiveMsg {
    Audio(Vec<u8>),
    /// Flush: tells the server no more audio is coming (`audio.done`).
    Done,
}

struct LiveSession {
    id: u64,
    tx: mpsc::UnboundedSender<LiveMsg>,
}

static SESSION: LazyLock<Mutex<Option<LiveSession>>> = LazyLock::new(|| Mutex::new(None));
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
pub async fn start(
    app: AppHandle,
    bearer: String,
    model_id: Option<String>,
    sample_rate: u32,
    language: Option<String>,
    diarize: bool,
    filler_words: bool,
    keyterms: Vec<String>,
    endpointing_ms: Option<u32>,
) -> Result<Value, String> {
    // Only one live session at a time — drop any previous one.
    stop_internal(false).await;

    let model = model_id
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| crate::api::STT_DEFAULT_MODEL.to_string());

    let mut url = format!(
        "{}?model={}&sample_rate={}&encoding=pcm&interim_results=true",
        XAI_STT_WS,
        enc(&model),
        sample_rate
    );
    if let Some(lang) = language.as_deref().map(str::trim).filter(|l| !l.is_empty() && *l != "auto") {
        url.push_str(&format!("&language={}", enc(lang)));
    }
    if diarize {
        url.push_str("&diarize=true");
    }
    if filler_words {
        url.push_str("&filler_words=true");
    }
    if let Some(ms) = endpointing_ms {
        url.push_str(&format!("&endpointing={}", ms.min(5000)));
    }
    for term in keyterms.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).take(100) {
        let t: String = term.chars().take(50).collect();
        url.push_str(&format!("&keyterm={}", enc(&t)));
    }

    info!("[live_stt] connecting {}", url);
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("Invalid WebSocket request: {}", e))?;
    request.headers_mut().insert(
        "Authorization",
        HeaderValue::from_str(&format!("Bearer {}", bearer))
            .map_err(|e| format!("Invalid credential: {}", e))?,
    );

    let (ws, _) = tokio_tungstenite::connect_async(request).await.map_err(|e| {
        let msg = e.to_string();
        if msg.contains("401") || msg.contains("403") {
            format!(
                "Live transcription was refused ({}). Check your xAI API key in Settings — \
                 SuperGrok sign-in may not include the streaming transcription API.",
                msg
            )
        } else {
            format!("Could not connect to live transcription: {}", msg)
        }
    })?;
    let (mut sink, mut stream) = ws.split();

    // Wait for `transcript.created` before any audio is sent (per xAI docs).
    let created = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    let v: Value = serde_json::from_str(&t).unwrap_or(Value::Null);
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("transcript.created") => return Ok(()),
                        Some("error") => {
                            return Err(v
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("Unknown error")
                                .to_string())
                        }
                        _ => {}
                    }
                }
                Ok(Message::Close(f)) => return Err(format!("Connection closed: {:?}", f)),
                Err(e) => return Err(e.to_string()),
                _ => {}
            }
        }
        Err("Connection closed before the session was created".to_string())
    })
    .await
    .map_err(|_| "Timed out waiting for the transcription session to start".to_string())?;
    created.map_err(|e| format!("Live transcription failed to start: {}", e))?;

    let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (tx, mut rx) = mpsc::unbounded_channel::<LiveMsg>();
    *SESSION.lock().await = Some(LiveSession { id, tx });
    info!("[live_stt] session {} ready model={} rate={}", id, model, sample_rate);

    // Writer: mic chunks → binary frames; Done → `audio.done` then stop writing.
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let res = match msg {
                LiveMsg::Audio(bytes) => sink.send(Message::Binary(bytes.into())).await,
                LiveMsg::Done => {
                    let r = sink
                        .send(Message::Text(json!({ "type": "audio.done" }).to_string().into()))
                        .await;
                    if r.is_err() {
                        let _ = sink.close().await;
                    }
                    break;
                }
            };
            if let Err(e) = res {
                warn!("[live_stt] send failed: {}", e);
                break;
            }
        }
    });

    // Reader: forward every server event to the webview, then announce close.
    let app_reader = app.clone();
    tokio::spawn(async move {
        let mut reason = "closed".to_string();
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    if let Ok(mut v) = serde_json::from_str::<Value>(&t) {
                        let is_done = v.get("type").and_then(|t| t.as_str()) == Some("transcript.done");
                        if let Some(obj) = v.as_object_mut() {
                            obj.insert("session".to_string(), json!(id));
                        }
                        let _ = app_reader.emit(LIVE_EVENT, v);
                        if is_done {
                            reason = "done".to_string();
                            break;
                        }
                    }
                }
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    reason = format!("error: {}", e);
                    break;
                }
                _ => {}
            }
        }
        info!("[live_stt] session {} ended ({})", id, reason);
        let mut guard = SESSION.lock().await;
        if guard.as_ref().is_some_and(|s| s.id == id) {
            *guard = None;
        }
        let _ = app_reader.emit(
            LIVE_EVENT,
            json!({ "type": "session.closed", "session": id, "reason": reason }),
        );
    });

    Ok(json!({ "session": id, "model": model, "sampleRate": sample_rate }))
}

/// Push one base64 PCM16 (mono, little-endian) chunk to the live session.
pub async fn push_audio(audio_base64: String) -> Result<(), String> {
    let bytes = BASE64
        .decode(audio_base64)
        .map_err(|e| format!("Invalid audio chunk: {}", e))?;
    let guard = SESSION.lock().await;
    match guard.as_ref() {
        Some(s) => s
            .tx
            .send(LiveMsg::Audio(bytes))
            .map_err(|_| "Live transcription session has ended".to_string()),
        None => Err("No live transcription session".to_string()),
    }
}

async fn stop_internal(flush: bool) {
    let mut guard = SESSION.lock().await;
    if let Some(s) = guard.as_ref() {
        if flush {
            // Keep the session registered until the reader sees `transcript.done`.
            let _ = s.tx.send(LiveMsg::Done);
            return;
        }
    }
    // Dropping the sender ends the writer task, which drops the sink and closes the socket.
    *guard = None;
}

/// Flush remaining audio; the server replies with `transcript.done` and closes.
pub async fn stop() -> Result<(), String> {
    stop_internal(true).await;
    Ok(())
}

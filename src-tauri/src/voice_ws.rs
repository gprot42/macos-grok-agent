//! Live Agent (speech-to-speech) WebSocket, proxied in Rust.
//!
//! xAI recommends proxying realtime connections through a backend, and the
//! browser flow (ephemeral client secret in `Sec-WebSocket-Protocol`) is
//! refused with 401 when the secret was minted from a SuperGrok OAuth token.
//! Here the socket opens with a real `Authorization` header instead, trying
//! each candidate credential in order (SuperGrok first, then a saved xAI API
//! key) and moving on only when the server answers 401/403. Frames are relayed
//! to the webview as `voice-ws` events; the webview sends with `voice_ws_send`.

use futures_util::{SinkExt, StreamExt};
use log::{info, warn};
use serde_json::{json, Value};
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, http::HeaderValue, protocol::CloseFrame, Error as WsError, Message,
};

const XAI_REALTIME_WS: &str = "wss://api.x.ai/v1/realtime";
pub const VOICE_EVENT: &str = "voice-ws";

/// A credential to try, with a label safe to show the user.
pub struct Candidate {
    pub label: String,
    pub bearer: String,
}

enum Outgoing {
    Text(String),
    Close,
}

struct Session {
    id: u64,
    tx: mpsc::UnboundedSender<Outgoing>,
}

static SESSION: LazyLock<Mutex<Option<Session>>> = LazyLock::new(|| Mutex::new(None));
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

/// The server's error message from a rejected handshake (body may be chunked).
fn rejection_detail(resp: &tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>) -> String {
    let raw = resp
        .body()
        .as_ref()
        .map(|b| String::from_utf8_lossy(b).to_string())
        .unwrap_or_default();
    // The body may arrive un-dechunked ("20\r\n{…}\r\n0\r\n") — keep just the JSON object.
    let text = match (raw.find('{'), raw.rfind('}')) {
        (Some(a), Some(b)) if b > a => raw[a..=b].to_string(),
        _ => raw,
    };
    serde_json::from_str::<Value>(text.trim())
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or_else(|| text.trim().to_string())
}

pub async fn connect(app: AppHandle, candidates: Vec<Candidate>, model: String) -> Result<Value, String> {
    close().await;
    if candidates.is_empty() {
        return Err("No xAI credential — sign in with SuperGrok or add an xAI API key in Settings.".into());
    }
    let url = format!("{}?model={}", XAI_REALTIME_WS, enc(&model));
    let mut refused: Vec<String> = Vec::new();

    for cand in &candidates {
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|e| format!("Invalid realtime URL: {}", e))?;
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&format!("Bearer {}", cand.bearer))
                .map_err(|_| format!("The {} credential has invalid characters", cand.label))?,
        );
        info!("[voice_ws] connecting model={} with {}", model, cand.label);

        let ws = match tokio_tungstenite::connect_async(request).await {
            Ok((ws, _)) => ws,
            Err(WsError::Http(resp)) if matches!(resp.status().as_u16(), 401 | 403) => {
                let detail = rejection_detail(&resp);
                warn!("[voice_ws] {} refused ({}): {}", cand.label, resp.status(), detail);
                refused.push(format!("{} → {} {}", cand.label, resp.status().as_u16(), detail));
                continue;
            }
            Err(WsError::Http(resp)) => {
                return Err(format!(
                    "xAI rejected the voice connection ({}): {}",
                    resp.status(),
                    rejection_detail(&resp)
                ))
            }
            Err(e) => return Err(format!("Could not connect to the voice agent: {}", e)),
        };

        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (mut sink, mut stream) = ws.split();
        let (tx, mut rx) = mpsc::unbounded_channel::<Outgoing>();
        *SESSION.lock().await = Some(Session { id, tx });

        // Writer: webview frames → server.
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let res = match msg {
                    Outgoing::Text(t) => sink.send(Message::Text(t.into())).await,
                    Outgoing::Close => {
                        let _ = sink
                            .send(Message::Close(Some(CloseFrame {
                                code: 1000.into(),
                                reason: "user disconnect".into(),
                            })))
                            .await;
                        break;
                    }
                };
                if let Err(e) = res {
                    warn!("[voice_ws] send failed: {}", e);
                    break;
                }
            }
        });

        // Reader: server frames → webview events, then announce the close.
        let app_reader = app.clone();
        tokio::spawn(async move {
            let (mut code, mut reason) = (1006u16, String::from("connection lost"));
            while let Some(msg) = stream.next().await {
                match msg {
                    Ok(Message::Text(t)) => {
                        let _ = app_reader.emit(VOICE_EVENT, json!({ "session": id, "kind": "message", "data": t.as_str() }));
                    }
                    Ok(Message::Close(frame)) => {
                        if let Some(f) = frame {
                            code = f.code.into();
                            reason = f.reason.to_string();
                        } else {
                            code = 1000;
                            reason.clear();
                        }
                        break;
                    }
                    Err(e) => {
                        reason = e.to_string();
                        break;
                    }
                    _ => {}
                }
            }
            let mut guard = SESSION.lock().await;
            if guard.as_ref().is_some_and(|s| s.id == id) {
                *guard = None;
            }
            drop(guard);
            info!("[voice_ws] session {} closed ({} {})", id, code, reason);
            let _ = app_reader.emit(
                VOICE_EVENT,
                json!({ "session": id, "kind": "close", "code": code, "reason": reason }),
            );
        });

        info!("[voice_ws] session {} open with {}", id, cand.label);
        return Ok(json!({
            "session": id,
            "credential": cand.label,
            "fallbackUsed": !refused.is_empty(),
        }));
    }

    let only_oauth = candidates.len() == 1 && candidates[0].label.starts_with("SuperGrok");
    Err(if only_oauth {
        format!(
            "xAI refused realtime voice for your SuperGrok sign-in ({}).\n\n\
             Add an xAI API key from console.x.ai in Settings — the Live Agent will use it \
             for voice while everything else keeps using SuperGrok.",
            refused.join("; ")
        )
    } else {
        format!("xAI refused realtime voice for every saved credential: {}", refused.join("; "))
    })
}

pub async fn send(text: String) -> Result<(), String> {
    match SESSION.lock().await.as_ref() {
        Some(s) => s.tx.send(Outgoing::Text(text)).map_err(|_| "Voice session has ended".to_string()),
        None => Err("No voice session".to_string()),
    }
}

pub async fn close() {
    if let Some(s) = SESSION.lock().await.take() {
        let _ = s.tx.send(Outgoing::Close);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::http::Response;

    #[test]
    fn rejection_detail_handles_chunked_and_plain_bodies() {
        let chunked = Response::builder()
            .status(401)
            .body(Some(b"20\r\n{\"error\":\"Unauthorized request\"}\r\n0\r\n".to_vec()))
            .unwrap();
        assert_eq!(rejection_detail(&chunked), "Unauthorized request");
        let plain = Response::builder().status(401).body(Some(b"nope".to_vec())).unwrap();
        assert_eq!(rejection_detail(&plain), "nope");
    }
}

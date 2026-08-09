//! SuperGrok / SuperGrok Heavy OAuth via the public OIDC device-code flow.
//!
//! Ported from android-tiny-ggrok (`XaiOAuthClient` / `SuperGrokAuthRepository`).
//! Uses the same public OIDC client as Grok Build / Grok CLI (`auth.x.ai`).
//!
//! Also can import an existing session from `~/.grok/auth.json` after `grok login`.

use crate::storage;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

// ── OIDC constants (public Grok CLI / Grok Build client) ──────────────────────

const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_CODE_URL: &str = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
const SCOPE: &str = "openid profile email offline_access api:access grok-cli:access";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// Refresh access token this many ms before expiry.
const REFRESH_SKEW_MS: i64 = 120_000;

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in_seconds: i64,
    pub interval_seconds: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    token_type: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at_epoch_ms: i64,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthSessionInfo {
    pub signed_in: bool,
    pub email: Option<String>,
    pub expires_at_epoch_ms: Option<i64>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedAuth {
    pub bearer_token: String,
    pub mode: String,
    pub label: String,
}

// ── Time helpers ──────────────────────────────────────────────────────────────

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── JWT helpers (no signature verification — display / expiry only) ───────────

fn decode_jwt_claims(jwt: &str) -> Option<Value> {
    let parts: Vec<&str> = jwt.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    serde_json::from_slice(&payload).ok()
}

fn extract_email_from_jwt(jwt: &str) -> Option<String> {
    let claims = decode_jwt_claims(jwt)?;
    claims
        .get("email")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            claims
                .get("preferred_username")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
}

// ── HTTP OAuth ────────────────────────────────────────────────────────────────

fn http_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub async fn request_device_code() -> Result<DeviceCodeResponse, String> {
    let client = http_client();
    let resp = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .map_err(|e| format!("Device code request failed: {}", e))?;

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Device code request failed HTTP {}: {}",
            status.as_u16(),
            raw.chars().take(300).collect::<String>()
        ));
    }

    let json: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid device code JSON: {}", e))?;

    let device_code = json
        .get("device_code")
        .and_then(|v| v.as_str())
        .ok_or("Missing device_code")?
        .to_string();
    let user_code = json
        .get("user_code")
        .and_then(|v| v.as_str())
        .ok_or("Missing user_code")?
        .to_string();
    let verification_uri = json
        .get("verification_uri")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("https://accounts.x.ai/oauth2/device")
        .to_string();
    let verification_uri_complete = json
        .get("verification_uri_complete")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let expires_in_seconds = json
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(1800);
    let interval_seconds = json
        .get("interval")
        .and_then(|v| v.as_i64())
        .unwrap_or(5)
        .max(1);

    Ok(DeviceCodeResponse {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete,
        expires_in_seconds,
        interval_seconds,
    })
}

enum PollResult {
    Success(TokenResponse),
    Pending(String),
    Denied(String),
    Expired(String),
    Error(String),
}

async fn poll_token(device_code: &str) -> PollResult {
    let client = http_client();
    let resp = match client
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", DEVICE_GRANT),
            ("device_code", device_code),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return PollResult::Error(e.to_string()),
    };

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();

    if status.is_success() {
        return match parse_token_response(&raw) {
            Ok(t) => PollResult::Success(t),
            Err(e) => PollResult::Error(e),
        };
    }

    let json: Option<Value> = serde_json::from_str(&raw).ok();
    let err = json
        .as_ref()
        .and_then(|j| j.get("error"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let desc = json
        .as_ref()
        .and_then(|j| j.get("error_description"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            json.as_ref()
                .and_then(|j| j.get("error"))
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            let snippet: String = raw.chars().take(200).collect();
            if snippet.is_empty() {
                format!("HTTP {}", status.as_u16())
            } else {
                snippet
            }
        });

    match err {
        "authorization_pending" | "slow_down" => PollResult::Pending(err.to_string()),
        "access_denied" => PollResult::Denied(desc),
        "expired_token" => PollResult::Expired(desc),
        _ => {
            if status.as_u16() == 400 && desc.to_lowercase().contains("pending") {
                PollResult::Pending(desc)
            } else {
                warn!("[supergrok] token poll HTTP {}: {}", status.as_u16(), raw);
                PollResult::Error(format!("HTTP {}: {}", status.as_u16(), desc))
            }
        }
    }
}

/// Poll until the user approves, the code expires, or `max_wait_ms` elapses.
async fn wait_for_authorization(
    device_code: &str,
    interval_seconds: i64,
    max_wait_ms: u64,
) -> Result<TokenResponse, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(max_wait_ms);
    let mut interval_ms = (interval_seconds.max(1) as u64) * 1000;

    while std::time::Instant::now() < deadline {
        match poll_token(device_code).await {
            PollResult::Success(tokens) => return Ok(tokens),
            PollResult::Denied(msg) => return Err(format!("Access denied: {}", msg)),
            PollResult::Expired(msg) => return Err(msg),
            PollResult::Error(msg) => return Err(msg),
            PollResult::Pending(reason) => {
                if reason == "slow_down" {
                    interval_ms = (interval_ms + 2000).min(15_000);
                }
                tokio::time::sleep(std::time::Duration::from_millis(interval_ms)).await;
            }
        }
    }
    Err("Timed out waiting for SuperGrok approval.".into())
}

async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client = http_client();
    let resp = client
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Token refresh failed HTTP {}: {}",
            status.as_u16(),
            raw.chars().take(300).collect::<String>()
        ));
    }
    parse_token_response(&raw)
}

fn parse_token_response(raw: &str) -> Result<TokenResponse, String> {
    let json: Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid token JSON: {}", e))?;
    let access = json
        .get("access_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("Token response missing access_token")?
        .to_string();
    let refresh = json
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let expires_in = json
        .get("expires_in")
        .and_then(|v| v.as_i64())
        .unwrap_or(3600);
    Ok(TokenResponse {
        access_token: access,
        refresh_token: refresh,
        expires_in,
        token_type: json
            .get("token_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        scope: json
            .get("scope")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

// ── Session persistence ───────────────────────────────────────────────────────

pub fn load_session() -> Result<Option<OAuthSession>, String> {
    storage::load_oauth_session()
}

pub fn save_session(session: &OAuthSession) -> Result<(), String> {
    storage::save_oauth_session(session)
}

pub fn clear_session() -> Result<(), String> {
    storage::clear_oauth_session()
}

pub fn session_info() -> Result<OAuthSessionInfo, String> {
    match load_session()? {
        Some(s) if !s.access_token.is_empty() => Ok(OAuthSessionInfo {
            signed_in: true,
            email: s.email,
            expires_at_epoch_ms: Some(s.expires_at_epoch_ms),
            source: Some("local".into()),
        }),
        _ => Ok(OAuthSessionInfo {
            signed_in: false,
            email: None,
            expires_at_epoch_ms: None,
            source: None,
        }),
    }
}

fn persist_tokens(tokens: &TokenResponse, keep_refresh_if_missing: Option<&str>) -> Result<OAuthSession, String> {
    let refresh = tokens
        .refresh_token
        .clone()
        .or_else(|| keep_refresh_if_missing.map(|s| s.to_string()))
        .unwrap_or_default();
    let expires_at_epoch_ms = now_epoch_ms() + tokens.expires_in.saturating_mul(1000);
    let email = extract_email_from_jwt(&tokens.access_token).or_else(|| {
        load_session()
            .ok()
            .flatten()
            .and_then(|s| s.email)
    });
    let session = OAuthSession {
        access_token: tokens.access_token.clone(),
        refresh_token: refresh,
        expires_at_epoch_ms,
        email,
    };
    save_session(&session)?;
    Ok(session)
}

/// Complete device login: poll until approved, then persist tokens.
pub async fn complete_device_login(
    device_code: String,
    interval_seconds: i64,
) -> Result<OAuthSessionInfo, String> {
    let tokens = wait_for_authorization(&device_code, interval_seconds, 15 * 60 * 1000).await?;
    let session = persist_tokens(&tokens, None)?;
    Ok(OAuthSessionInfo {
        signed_in: true,
        email: session.email,
        expires_at_epoch_ms: Some(session.expires_at_epoch_ms),
        source: Some("device_code".into()),
    })
}

/// Return a valid access token, refreshing if within skew of expiry.
pub async fn get_valid_access_token() -> Result<String, String> {
    let session = load_session()?.ok_or(
        "SuperGrok sign-in missing. Open Settings → Sign in with SuperGrok, or import from Grok CLI.",
    )?;

    let now = now_epoch_ms();
    if !session.access_token.is_empty() && session.expires_at_epoch_ms > now + REFRESH_SKEW_MS {
        return Ok(session.access_token);
    }

    if session.refresh_token.is_empty() {
        if !session.access_token.is_empty() && session.expires_at_epoch_ms > now {
            return Ok(session.access_token);
        }
        return Err(
            "SuperGrok sign-in expired. Open Settings → Sign in with SuperGrok again.".into(),
        );
    }

    match refresh_access_token(&session.refresh_token).await {
        Ok(tokens) => {
            let updated = persist_tokens(&tokens, Some(&session.refresh_token))?;
            Ok(updated.access_token)
        }
        Err(e) => {
            warn!("[supergrok] OAuth refresh failed: {}", e);
            if !session.access_token.is_empty() && session.expires_at_epoch_ms > now {
                Ok(session.access_token)
            } else {
                Err(format!(
                    "SuperGrok token refresh failed: {}. Sign in again in Settings.",
                    e
                ))
            }
        }
    }
}

// ── Import from Grok CLI ~/.grok/auth.json ────────────────────────────────────

fn default_cli_auth_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".grok")
        .join("auth.json")
}

/// Parse `expires_at` RFC3339-ish timestamps into epoch ms.
fn parse_expires_at(s: &str) -> i64 {
    // Try chrono-less parse: "2026-08-09T15:27:38.114422Z"
    // Use a simple approach via `httpdate` isn't available; use system via date or manual.
    // Prefer JWT exp claim when available; this is a best-effort fallback.
    // Format: YYYY-MM-DDTHH:MM:SS...
    let trimmed = s.trim().trim_end_matches('Z');
    let parts: Vec<&str> = trimmed.split('T').collect();
    if parts.len() != 2 {
        return now_epoch_ms() + 3600_000; // 1h fallback
    }
    let date: Vec<i64> = parts[0]
        .split('-')
        .filter_map(|p| p.parse().ok())
        .collect();
    let time_part = parts[1].split('.').next().unwrap_or("0:0:0");
    let time: Vec<i64> = time_part
        .split(':')
        .filter_map(|p| p.parse().ok())
        .collect();
    if date.len() != 3 || time.len() < 2 {
        return now_epoch_ms() + 3600_000;
    }
    // Approximate epoch without leap-second precision (good enough for refresh skew)
    let (y, m, d) = (date[0], date[1], date[2]);
    let (hh, mm) = (time[0], time[1]);
    let ss = if time.len() > 2 { time[2] } else { 0 };
    // Days from Unix epoch (1970-01-01) — civil calendar algorithm
    let y = if m <= 2 { y - 1 } else { y };
    let era = y / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    (days * 86400 + hh * 3600 + mm * 60 + ss) * 1000
}

/// Import SuperGrok session from Grok CLI `~/.grok/auth.json` (after `grok login`).
pub fn import_from_cli_auth(path: Option<String>) -> Result<OAuthSessionInfo, String> {
    let path = path
        .map(PathBuf::from)
        .unwrap_or_else(default_cli_auth_path);

    if !path.is_file() {
        return Err(format!(
            "Auth file not found: {}\nRun `grok login` in a terminal, then try Import again.",
            path.display()
        ));
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let data: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Could not parse {}: {}", path.display(), e))?;

    let (token, refresh, email, expires_at) = extract_cli_auth_entry(&data, &path)?;

    // Prefer JWT exp when present
    let expires_at_epoch_ms = decode_jwt_claims(&token)
        .and_then(|c| c.get("exp").and_then(|v| v.as_i64()))
        .map(|exp| exp * 1000)
        .unwrap_or_else(|| {
            expires_at
                .as_deref()
                .map(parse_expires_at)
                .unwrap_or_else(|| now_epoch_ms() + 3600_000)
        });

    let email = email.or_else(|| extract_email_from_jwt(&token));

    let session = OAuthSession {
        access_token: token,
        refresh_token: refresh.unwrap_or_default(),
        expires_at_epoch_ms,
        email,
    };
    save_session(&session)?;

    Ok(OAuthSessionInfo {
        signed_in: true,
        email: session.email,
        expires_at_epoch_ms: Some(session.expires_at_epoch_ms),
        source: Some(path.display().to_string()),
    })
}

fn extract_cli_auth_entry(
    data: &Value,
    path: &std::path::Path,
) -> Result<(String, Option<String>, Option<String>, Option<String>), String> {
    // Shape C: flat { "access_token" / "key": "..." }
    if let Some(token) = data
        .get("key")
        .or_else(|| data.get("access_token"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        let refresh = data
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let email = data
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let expires_at = data
            .get("expires_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        return Ok((token, refresh, email, expires_at));
    }

    // Shape A/B: map of issuer::client_id → entry
    let obj = data
        .as_object()
        .ok_or_else(|| format!("{} is empty or not a JSON object. Run `grok login`.", path.display()))?;

    let mut candidates: Vec<(&str, &Value)> = obj
        .iter()
        .filter(|(_, v)| {
            v.get("key")
                .and_then(|k| k.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        })
        .map(|(k, v)| (k.as_str(), v))
        .collect();

    if candidates.is_empty() {
        return Err(format!(
            "No access token found in {}.\nExpected a `key` field (from `grok login`).",
            path.display()
        ));
    }

    candidates.sort_by(|a, b| {
        let ea = a
            .1
            .get("expires_at")
            .or_else(|| a.1.get("create_time"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let eb = b
            .1
            .get("expires_at")
            .or_else(|| b.1.get("create_time"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        eb.cmp(ea)
    });

    let entry = candidates[0].1;
    let token = entry
        .get("key")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or("Empty token in auth entry")?;
    let refresh = entry
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let email = entry
        .get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let expires_at = entry
        .get("expires_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok((token, refresh, email, expires_at))
}

// ── Auth mode resolution ──────────────────────────────────────────────────────

pub fn normalize_auth_mode(value: Option<&str>) -> String {
    match value.map(|s| s.trim().to_uppercase()).as_deref() {
        Some("SUPERGROK_OAUTH") | Some("OAUTH") | Some("SUPERGROK") | Some("SUPERGROK_HEAVY") => {
            "SUPERGROK_OAUTH".into()
        }
        _ => "API_KEY".into(),
    }
}

/// Resolve the bearer credential for xAI API calls based on auth mode.
pub async fn resolve_xai_auth(
    auth_mode: &str,
    xai_key: Option<&str>,
    api_key: &str,
) -> Result<ResolvedAuth, String> {
    match normalize_auth_mode(Some(auth_mode)).as_str() {
        "SUPERGROK_OAUTH" => {
            let token = get_valid_access_token().await?;
            Ok(ResolvedAuth {
                bearer_token: token,
                mode: "SUPERGROK_OAUTH".into(),
                label: "SuperGrok OAuth".into(),
            })
        }
        _ => {
            let key = xai_key
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or(api_key.trim());
            if key.is_empty() {
                Err(
                    "Add your xAI API key in Settings, or sign in with SuperGrok (subscription)."
                        .into(),
                )
            } else {
                Ok(ResolvedAuth {
                    bearer_token: key.to_string(),
                    mode: "API_KEY".into(),
                    label: "API key".into(),
                })
            }
        }
    }
}

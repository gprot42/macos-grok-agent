/// Model Context Protocol (MCP) client — stdio transport.
///
/// Implements JSON-RPC 2.0 over stdin/stdout to communicate with local MCP servers
/// (e.g. @modelcontextprotocol/server-filesystem, mcp-server-git, …).
///
/// Protocol: https://modelcontextprotocol.io/specification
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

// ── Public types exposed to Tauri commands and frontend ──────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub config: McpServerConfig,
    pub connected: bool,
    pub tools: Vec<McpTool>,
    pub error: Option<String>,
}

// ── Internal connection struct ────────────────────────────────────────────────

pub(crate) struct McpConnection {
    config: McpServerConfig,
    stdin: tokio::io::BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    _child: Child, // keep process alive
    next_id: u64,
    pub tools: Vec<McpTool>,
}

impl McpConnection {
    // ── Low-level message I/O ─────────────────────────────────────────────────

    async fn send_raw(&mut self, msg: &Value) -> Result<(), String> {
        let line = serde_json::to_string(msg).map_err(|e| e.to_string())? + "\n";
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("MCP write error: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("MCP flush error: {}", e))
    }

    async fn recv_raw(&mut self) -> Result<Value, String> {
        let mut line = String::new();
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.stdout.read_line(&mut line),
        )
        .await
        {
            Ok(Ok(0)) => Err("MCP server closed connection".to_string()),
            Ok(Ok(_)) => serde_json::from_str(line.trim())
                .map_err(|e| format!("MCP parse error: {} (raw: {:?})", e, &line[..line.len().min(200)])),
            Ok(Err(e)) => Err(format!("MCP read error: {}", e)),
            Err(_) => Err("MCP request timed out (30 s)".to_string()),
        }
    }

    // ── JSON-RPC request (expects a response with matching id) ────────────────

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;

        self.send_raw(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .await?;

        // Drain notifications and wait for our response id
        loop {
            let resp = self.recv_raw().await?;
            match resp.get("id").and_then(|i| i.as_u64()) {
                Some(rid) if rid == id => {
                    if let Some(err) = resp.get("error") {
                        return Err(format!("MCP error: {}", err));
                    }
                    return Ok(resp["result"].clone());
                }
                // Might be a notification (no id) or a different request — discard
                _ => continue,
            }
        }
    }

    // ── JSON-RPC notification (fire-and-forget) ───────────────────────────────

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), String> {
        self.send_raw(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
        .await
    }

    // ── MCP initialization handshake ─────────────────────────────────────────

    async fn initialize(&mut self) -> Result<Vec<McpTool>, String> {
        // 1. initialize
        let init = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "roots": { "listChanged": false },
                        "sampling": {}
                    },
                    "clientInfo": {
                        "name": "grok-agent",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await?;

        info!(
            "[mcp] Connected to server: {}",
            init["serverInfo"]["name"].as_str().unwrap_or("unknown")
        );

        // 2. notifications/initialized
        self.notify("notifications/initialized", json!({})).await?;

        // 3. tools/list
        let tools_resp = self.request("tools/list", json!({})).await?;
        let tools: Vec<McpTool> = tools_resp["tools"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|t| serde_json::from_value(t.clone()).ok())
            .collect();

        info!(
            "[mcp] Server has {} tool(s): {}",
            tools.len(),
            tools.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", ")
        );

        self.tools = tools.clone();
        Ok(tools)
    }

    // ── Tool call ─────────────────────────────────────────────────────────────

    async fn call_tool(&mut self, tool_name: &str, args: &Value) -> Result<String, String> {
        let result = self
            .request(
                "tools/call",
                json!({ "name": tool_name, "arguments": args }),
            )
            .await?;

        let is_error = result
            .get("isError")
            .and_then(|e| e.as_bool())
            .unwrap_or(false);

        // MCP returns content blocks; collect all text blocks
        let text = result["content"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|c| {
                if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                    c.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("\n");

        if is_error {
            Err(text)
        } else {
            Ok(text)
        }
    }
}

// ── Global state ─────────────────────────────────────────────────────────────

// Wrap HashMap in a newtype so McpConnection stays private
pub struct McpState(pub(crate) Arc<Mutex<HashMap<String, McpConnection>>>);

impl McpState {
    pub fn new() -> Self {
        McpState(Arc::new(Mutex::new(HashMap::new())))
    }
}

// Allow cloning the Arc (not the inner data)
impl Clone for McpState {
    fn clone(&self) -> Self {
        McpState(self.0.clone())
    }
}

pub fn new_mcp_state() -> McpState {
    McpState::new()
}

// ── Public async API (called from Tauri commands) ─────────────────────────────

pub async fn connect_server(
    state: &McpState,
    config: McpServerConfig,
) -> Result<Vec<McpTool>, String> {
    let name = config.name.clone();

    let mut cmd = Command::new(&config.command);
    cmd.args(&config.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(env) = &config.env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start '{}': {}", config.command, e))?;

    let stdin = child.stdin.take().ok_or("Failed to get MCP stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get MCP stdout")?;

    let mut conn = McpConnection {
        config,
        stdin: tokio::io::BufWriter::new(stdin),
        stdout: BufReader::new(stdout),
        _child: child,
        next_id: 1,
        tools: vec![],
    };

    let tools = conn.initialize().await?;

    let mut lock = state.0.lock().await;
    lock.insert(name, conn);

    Ok(tools)
}

pub async fn disconnect_server(state: &McpState, name: &str) -> Result<(), String> {
    state.0.lock().await.remove(name);
    Ok(())
}

pub async fn list_servers(state: &McpState) -> Vec<McpServerStatus> {
    state.0
        .lock()
        .await
        .iter()
        .map(|(name, conn)| McpServerStatus {
            config: McpServerConfig {
                name: name.clone(),
                ..conn.config.clone()
            },
            connected: true,
            tools: conn.tools.clone(),
            error: None,
        })
        .collect()
}

/// All tools from all connected servers, with namespaced key `mcp__{server}__{tool}`.
pub async fn get_all_tools(state: &McpState) -> Vec<(String, String, McpTool)> {
    state.0
        .lock()
        .await
        .iter()
        .flat_map(|(server, conn)| {
            conn.tools.iter().map(move |t| {
                (
                    server.clone(),
                    format!("mcp__{}__{}", server, t.name),
                    t.clone(),
                )
            })
        })
        .collect()
}

/// Call a tool by its namespaced key `mcp__{server}__{tool}`.
pub async fn call_namespaced_tool(
    state: &McpState,
    namespaced: &str,
    args: &Value,
) -> Result<String, String> {
    // parse mcp__{server}__{tool} — tool name may itself contain underscores
    let without_prefix = namespaced.strip_prefix("mcp__").ok_or_else(|| {
        format!("Not an MCP tool name: {}", namespaced)
    })?;
    let sep = without_prefix
        .find("__")
        .ok_or_else(|| format!("Malformed MCP tool name: {}", namespaced))?;
    let server_name = &without_prefix[..sep];
    let tool_name = &without_prefix[sep + 2..];

    let mut lock = state.0.lock().await;
    let conn = lock
        .get_mut(server_name)
        .ok_or_else(|| format!("MCP server '{}' not connected", server_name))?;
    conn.call_tool(tool_name, args).await
}

// ── Config persistence ────────────────────────────────────────────────────────

pub async fn save_configs(configs: &[McpServerConfig]) -> Result<(), String> {
    let dir = crate::storage::get_storage_dir_pub()?;
    let path = dir.join("mcp_servers.json");
    let json = serde_json::to_string_pretty(configs)
        .map_err(|e| format!("Failed to serialize MCP configs: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write MCP configs: {}", e))
}

pub async fn load_configs() -> Result<Vec<McpServerConfig>, String> {
    let dir = crate::storage::get_storage_dir_pub()?;
    let path = dir.join("mcp_servers.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read MCP configs: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse MCP configs: {}", e))
}

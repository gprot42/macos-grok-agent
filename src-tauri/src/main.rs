#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent_chain;
mod api;
mod codegen;
mod mcp;
mod skills;
mod storage;

#[macro_use]
extern crate log;

use mcp::{McpServerConfig, McpServerStatus, McpTool, McpState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Per-task cancellation map.  Each running agent or streaming task registers a
/// unique `task_id` → `Arc<AtomicBool>` cancel flag here.
pub struct CancelMap(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

impl CancelMap {
    fn new() -> Self {
        CancelMap(Mutex::new(HashMap::new()))
    }
    pub fn register(&self, task_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.0.lock().unwrap().insert(task_id.to_string(), flag.clone());
        flag
    }
    pub fn cancel(&self, task_id: &str) {
        if let Some(flag) = self.0.lock().unwrap().get(task_id) {
            flag.store(true, Ordering::SeqCst);
        }
    }
    pub fn remove(&self, task_id: &str) {
        self.0.lock().unwrap().remove(task_id);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    #[serde(rename = "fontSize")]
    pub font_size: u32,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "openrouterKey", default, skip_serializing_if = "Option::is_none")]
    pub openrouter_key: Option<String>,
    #[serde(rename = "xaiKey", default, skip_serializing_if = "Option::is_none")]
    pub xai_key: Option<String>,
    #[serde(rename = "kilocodeKey", default, skip_serializing_if = "Option::is_none")]
    pub kilocode_key: Option<String>,
    #[serde(rename = "customLogin", default, skip_serializing_if = "Option::is_none")]
    pub custom_login: Option<String>,
    #[serde(rename = "customPassword", default, skip_serializing_if = "Option::is_none")]
    pub custom_password: Option<String>,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "agentTimeout", default, skip_serializing_if = "Option::is_none")]
    pub agent_timeout: Option<u64>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            font_size: 14,
            api_key: String::new(),
            openrouter_key: None,
            xai_key: None,
            kilocode_key: None,
            custom_login: None,
            custom_password: None,
            project_id: String::new(),
            agent_timeout: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedFile {
    pub path: String,
    pub data: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    #[serde(rename = "rawJson")]
    pub raw_json: String,
    #[serde(rename = "inputTokens")]
    pub input_tokens: u32,
    #[serde(rename = "outputTokens")]
    pub output_tokens: u32,
}

/// Return value for image generation / editing commands.
/// Includes the raw base64 image and the actual billed cost returned by the xAI API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageResponse {
    /// Raw base64-encoded image data (no data-URI prefix).
    pub image: String,
    /// Actual cost charged by xAI, in US dollars (derived from `usage.cost_in_usd_ticks`).
    #[serde(rename = "costUsd")]
    pub cost_usd: f64,
}

#[tauri::command]
async fn load_settings() -> Result<Option<AppSettings>, String> {
    storage::load_settings().await
}

#[tauri::command]
async fn save_settings(settings: AppSettings) -> Result<(), String> {
    storage::save_settings(&settings).await
}

#[tauri::command]
async fn save_api_key(api_key: String) -> Result<(), String> {
    storage::save_api_key(&api_key).await
}

#[tauri::command]
async fn send_chat_message(
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
    api::send_chat_message(
        prompt,
        history,
        model_id,
        publisher,
        endpoint,
        api_key,
        project_id,
        use_1m_context,
        use_memory,
        use_grounding,
        thinking_level,
        include_thoughts,
        custom_url,
        custom_login,
        custom_password,
        attached_file,
        service_tier,
        use_search,
    )
    .await
}

#[tauri::command]
async fn generate_image(
    prompt: String,
    api_key: String,
    edit_image: Option<String>,
    edit_image_mime_type: Option<String>,
    model_id: Option<String>,
    search_mode: Option<String>,
    aspect_ratio: Option<String>,
    // "us-east-1" | "eu-west-1" | None → global api.x.ai
    region: Option<String>,
    // "1k" | "2k" | None → API default (1k)
    resolution: Option<String>,
) -> Result<ImageResponse, String> {
    api::generate_image(
        prompt, api_key, edit_image, edit_image_mime_type,
        model_id, search_mode, aspect_ratio, region, resolution,
    )
    .await
}



#[tauri::command]
async fn coding_agent_chat(
    app_handle: tauri::AppHandle,
    messages: Vec<serde_json::Value>,
    model_id: String,
    publisher: String,
    endpoint: String,
    api_key: String,
    project_id: String,
    working_dir: String,
    agent_timeout: Option<u64>,
    agent_mode: Option<String>,
    // Optional: callers may supply a task_id for multi-run tracking.
    // Defaults to "coding-agent" for backward compatibility.
    task_id: Option<String>,
    thinking_level: Option<String>,
    active_skill_paths: Option<Vec<String>>,
    // When true (default), rm/unlink/shred commands in run_command are soft-blocked.
    // The agent receives an explanatory message and is directed to use delete_file instead.
    block_file_deletion: Option<bool>,
) -> Result<serde_json::Value, String> {
    let tid = task_id.unwrap_or_else(|| "coding-agent".to_string());
    let cancel_map = app_handle.state::<CancelMap>();
    let cancel_flag = cancel_map.register(&tid);
    let mcp_state = app_handle.state::<McpState>().inner().clone();
    // Build skills context before entering the agent loop
    let skills_context = if let Some(paths) = active_skill_paths {
        skills::build_skills_context(&paths).await
    } else {
        None
    };
    // Default: block file deletion for safety; only disable when caller opts out
    let block_del = block_file_deletion.unwrap_or(false);
    let result = api::coding_agent_chat(
        messages, model_id, publisher, endpoint, api_key, project_id,
        working_dir, agent_timeout, agent_mode, thinking_level, skills_context, block_del,
        app_handle.clone(), cancel_flag, mcp_state,
    ).await;
    cancel_map.remove(&tid);
    result
}

#[tauri::command]
fn coding_agent_stop(
    app_handle: tauri::AppHandle,
    task_id: Option<String>,
) {
    let tid = task_id.unwrap_or_else(|| "coding-agent".to_string());
    let cancel_map = app_handle.state::<CancelMap>();
    cancel_map.cancel(&tid);
    eprintln!("[CodingAgent] Stop requested for task={}", tid);
}

// ── SSE streaming command ─────────────────────────────────────────────────────

#[tauri::command]
async fn stream_chat_message(
    app_handle: tauri::AppHandle,
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
    api::stream_chat_message(
        app_handle, task_id, prompt, history, model_id, publisher, endpoint,
        api_key, project_id, use_1m_context, use_memory, use_grounding,
        thinking_level, include_thoughts, custom_url, custom_login,
        custom_password, attached_file, service_tier, use_search,
    ).await
}

// ── Agent chain commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn run_agent_pipeline(
    app_handle: tauri::AppHandle,
    pipeline: agent_chain::AgentPipeline,
    api_key: String,
    task_id: Option<String>,
) -> Result<String, String> {
    let tid = task_id.unwrap_or_else(|| format!("pipeline-{}", uuid::Uuid::new_v4()));
    agent_chain::run_pipeline(pipeline, api_key, app_handle, tid).await
}

#[tauri::command]
async fn deep_research(
    app_handle: tauri::AppHandle,
    prompt: String,
    api_key: String,
    model_id: Option<String>,
    publisher: Option<String>,
    endpoint: Option<String>,
    task_id: Option<String>,
) -> Result<ChatResponse, String> {
    let tid = task_id.unwrap_or_else(|| format!("research-{}", uuid::Uuid::new_v4()));
    agent_chain::deep_research(
        prompt,
        api_key,
        model_id.unwrap_or_else(|| "grok-4.3".to_string()),
        publisher.unwrap_or_else(|| "xai".to_string()),
        endpoint.unwrap_or_else(|| "xai".to_string()),
        app_handle,
        tid,
    ).await
}

#[tauri::command]
async fn generate_video(
    app_handle: tauri::AppHandle,
    prompt: String,
    api_key: String,
    model_id: Option<String>,
    duration_seconds: Option<u32>,
    aspect_ratio: Option<String>,
) -> Result<serde_json::Value, String> {
    api::generate_video(app_handle, prompt, api_key, model_id, duration_seconds, aspect_ratio).await
}

#[tauri::command]
async fn extend_video(
    app_handle: tauri::AppHandle,
    video_id: String,
    api_key: String,
    model_id: Option<String>,
    duration_seconds: Option<u32>,
    prompt: Option<String>,
) -> Result<serde_json::Value, String> {
    api::extend_video(app_handle, video_id, api_key, model_id, duration_seconds, prompt).await
}

#[tauri::command]
async fn generate_speech(
    text: String,
    api_key: String,
    voice_id: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    api::generate_speech(text, api_key, voice_id, language).await
}

#[tauri::command]
async fn save_sessions(sessions_json: String) -> Result<(), String> {
    storage::save_sessions(&sessions_json).await
}

#[tauri::command]
async fn load_sessions() -> Result<Option<String>, String> {
    storage::load_sessions().await
}

#[tauri::command]
async fn delete_file(path: String) -> Result<String, String> {
    codegen::exec_delete_file("", &path).await
}

#[tauri::command]
async fn list_skills(skills_dir: String) -> Result<Vec<skills::SkillMeta>, String> {
    skills::list_skills(&skills_dir).await
}

#[tauri::command]
async fn read_skill_content(skill_md_path: String) -> Result<String, String> {
    skills::read_skill_content(&skill_md_path).await
}

#[tauri::command]
async fn execute_code_snippet(
    code: String,
    language: String,
    working_dir: String,
) -> Result<serde_json::Value, String> {
    codegen::exec_code_snippet(&working_dir, &code, &language).await
}

// ── MCP commands ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn mcp_connect(
    state: tauri::State<'_, McpState>,
    config: McpServerConfig,
) -> Result<Vec<McpTool>, String> {
    mcp::connect_server(state.inner(), config).await
}

#[tauri::command]
async fn mcp_disconnect(
    state: tauri::State<'_, McpState>,
    name: String,
) -> Result<(), String> {
    mcp::disconnect_server(state.inner(), &name).await
}

#[tauri::command]
async fn mcp_list_servers(
    state: tauri::State<'_, McpState>,
) -> Result<Vec<McpServerStatus>, String> {
    Ok(mcp::list_servers(state.inner()).await)
}

#[tauri::command]
async fn mcp_save_configs(configs: Vec<McpServerConfig>) -> Result<(), String> {
    mcp::save_configs(&configs).await
}

#[tauri::command]
async fn mcp_load_configs() -> Result<Vec<McpServerConfig>, String> {
    mcp::load_configs().await
}

#[tauri::command]
async fn save_working_dir(path: String) -> Result<(), String> {
    storage::save_working_dir(&path).await
}

#[tauri::command]
async fn load_working_dir() -> Result<Option<String>, String> {
    storage::load_working_dir().await
}

#[tauri::command]
async fn get_default_working_dir(active_project: Option<String>) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    use std::path::PathBuf;

    let dir = if let Some(project) = active_project {
        // Explicit project selected — always use Cortex Projects folder
        let d = home.join("Cortex Projects").join(project);
        std::fs::create_dir_all(&d)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        d
    } else {
        // Priority 1: CORTEX_LAUNCH_DIR set by start.sh — this is the project root
        if let Ok(launch_dir) = std::env::var("CORTEX_LAUNCH_DIR") {
            let p = PathBuf::from(&launch_dir);
            if p.exists() && p.is_dir() {
                return Ok(launch_dir);
            }
        }

        // Priority 2: CWD, but skip src-tauri/ (cargo run artifact) and .app bundles
        let cwd = std::env::current_dir().unwrap_or_else(|_| home.clone());
        let cwd_str = cwd.to_string_lossy();
        let is_src_tauri = cwd_str.ends_with("/src-tauri") || cwd_str.ends_with("\\src-tauri");
        let is_app_bundle = cwd_str.contains(".app/") || cwd_str.ends_with(".app");
        let is_home = cwd == home;
        let is_root = cwd_str == "/";

        if is_src_tauri {
            // Go up one level to the actual project root
            cwd.parent().map(|p| p.to_path_buf()).unwrap_or(home)
        } else if !is_app_bundle && !is_home && !is_root {
            cwd
        } else {
            home
        }
    };

    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn download_video(url: String, filename: String) -> Result<String, String> {
    api::download_video_to_disk(url, filename).await
}

#[tauri::command]
async fn save_image(image_base64: String, filename: String) -> Result<(), String> {
    storage::save_image(&image_base64, &filename).await
}

#[tauri::command]
async fn save_output(content: String, filename: String) -> Result<String, String> {
    storage::save_output(&content, &filename).await
}

#[tauri::command]
async fn create_project(project_name: String) -> Result<String, String> {
    storage::create_project(&project_name).await
}

#[tauri::command]
async fn save_to_project(project_path: String, subfolder: String, filename: String, content: String) -> Result<String, String> {
    storage::save_to_project(&project_path, &subfolder, &filename, &content).await
}

#[tauri::command]
async fn list_projects() -> Result<Vec<String>, String> {
    storage::list_projects().await
}

#[tauri::command]
async fn get_project_path(project_name: String) -> Result<String, String> {
    storage::get_project_path(&project_name).await
}

#[tauri::command]
async fn save_image_to_project(project_path: String, filename: String, image_base64: String) -> Result<String, String> {
    storage::save_image_to_project(&project_path, &filename, &image_base64).await
}



fn main() {
    // Initialize env_logger — set RUST_LOG=debug for verbose output, info by default
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("grok_agent=info,warn")
    ).init();

    info!("Grok Agent starting");

    use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
    use tauri::Manager;

    tauri::Builder::default()
        .manage(CancelMap::new())
        .manage(mcp::new_mcp_state())
        .enable_macos_default_menu(false)
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                // Clone for the spawned thread
                let win_clone = win.clone();
                
                // Spawn a thread to handle maximization after window is fully ready
                std::thread::spawn(move || {
                    // Wait for window to be fully initialized
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    
                    // Try to maximize
                    let _ = win_clone.maximize();
                    
                    // Double-check after another delay
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if !win_clone.is_maximized().unwrap_or(true) {
                        let _ = win_clone.maximize();
                    }
                });
            }
            Ok(())
        })
        .menu(|handle| {
            // Create App submenu (macOS standard)
            let app_menu = Submenu::with_items(
                handle,
                "Grok Agent",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Grok Agent"), None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::services(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::show_all(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;
            
            // Create Edit submenu with standard actions
            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(handle, None)?,
                    &PredefinedMenuItem::redo(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;
            
            // Create Window submenu
            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(handle, None)?,
                    &PredefinedMenuItem::maximize(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::close_window(handle, None)?,
                ],
            )?;

            // Create View submenu with DevTools
            let devtools_item = MenuItem::with_id(handle, "toggle_devtools", "Toggle Developer Tools", true, Some("CmdOrCtrl+Shift+I"))?;
            let view_menu = Submenu::with_items(
                handle,
                "View",
                true,
                &[&devtools_item],
            )?;
            
            Menu::with_items(handle, &[&app_menu, &edit_menu, &view_menu, &window_menu])
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            save_api_key,
            send_chat_message,
            stream_chat_message,
            generate_image,
            save_image,
            save_output,
            create_project,
            save_to_project,
            list_projects,
            get_project_path,
            save_image_to_project,
            coding_agent_chat,
            coding_agent_stop,
            generate_video,
            extend_video,
            generate_speech,
            download_video,
            get_default_working_dir,
            delete_file,
            save_sessions,
            load_sessions,
            save_working_dir,
            load_working_dir,
            mcp_connect,
            mcp_disconnect,
            mcp_list_servers,
            mcp_save_configs,
            mcp_load_configs,
            run_agent_pipeline,
            deep_research,
            execute_code_snippet,
            list_skills,
            read_skill_content,
        ])
        .on_menu_event(|_app, event| {
            if event.id().as_ref() == "toggle_devtools" {
                if let Some(win) = _app.get_webview_window("main") {
                    if win.is_devtools_open() {
                        win.close_devtools();
                    } else {
                        win.open_devtools();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

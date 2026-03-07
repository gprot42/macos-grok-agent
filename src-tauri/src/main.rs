#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod auth;
mod codegen;
mod storage;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    #[serde(rename = "fontSize")]
    pub font_size: u32,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "aiStudioKey", default, skip_serializing_if = "Option::is_none")]
    pub ai_studio_key: Option<String>,
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
            ai_studio_key: None,
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
    api::send_chat_message(
        prompt,
        history,
        model_id,
        ai_studio_model_id,
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
) -> Result<String, String> {
    api::generate_image(prompt, api_key, edit_image, edit_image_mime_type, model_id).await
}

#[tauri::command]
async fn layout_parse(
    file_data: String,
    mime_type: String,
    mode: String,
    api_key: String,
    system_prompt: String,
) -> Result<String, String> {
    api::layout_parse(file_data, mime_type, mode, api_key, system_prompt).await
}

#[tauri::command]
async fn deep_research(
    prompt: String,
    api_key: String,
    timeout_minutes: Option<u32>,
) -> Result<ChatResponse, String> {
    api::deep_research(prompt, api_key, timeout_minutes.unwrap_or(60)).await
}

#[tauri::command]
async fn rag_create_store(api_key: String, display_name: String) -> Result<serde_json::Value, String> {
    api::rag_create_store(api_key, display_name).await
}

#[tauri::command]
async fn rag_list_stores(api_key: String) -> Result<serde_json::Value, String> {
    api::rag_list_stores(api_key).await
}

#[tauri::command]
async fn rag_delete_store(api_key: String, store_name: String) -> Result<serde_json::Value, String> {
    api::rag_delete_store(api_key, store_name).await
}

#[tauri::command]
async fn rag_upload_file(api_key: String, store_name: String, file_data: String, mime_type: String, display_name: String) -> Result<serde_json::Value, String> {
    api::rag_upload_file(api_key, store_name, file_data, mime_type, display_name).await
}

#[tauri::command]
async fn rag_list_files(api_key: String, store_name: String) -> Result<serde_json::Value, String> {
    api::rag_list_files(api_key, store_name).await
}

#[tauri::command]
async fn rag_query(api_key: String, store_names: Vec<String>, query: String, model: String) -> Result<serde_json::Value, String> {
    api::rag_query(api_key, store_names, query, model).await
}

#[tauri::command]
async fn speech_to_text(
    audio_data: String,
    mime_type: String,
    language_code: String,
    api_key: String,
    project_id: String,
) -> Result<String, String> {
    api::speech_to_text(audio_data, mime_type, language_code, api_key, project_id).await
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
) -> Result<serde_json::Value, String> {
    let cancel_flag = app_handle.state::<Arc<AtomicBool>>().inner().clone();
    cancel_flag.store(false, Ordering::SeqCst);
    api::coding_agent_chat(messages, model_id, publisher, endpoint, api_key, project_id, working_dir, agent_timeout, agent_mode, app_handle, cancel_flag).await
}

#[tauri::command]
fn coding_agent_stop(app_handle: tauri::AppHandle) {
    let cancel_flag = app_handle.state::<Arc<AtomicBool>>();
    cancel_flag.store(true, Ordering::SeqCst);
    eprintln!("[CodingAgent] Stop requested by user");
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

#[tauri::command]
fn has_service_account() -> bool {
    auth::has_service_account_key()
}

#[tauri::command]
fn get_service_account_project_id() -> Option<String> {
    auth::get_project_id_from_key()
}

#[tauri::command]
async fn get_vertex_token() -> Result<String, String> {
    auth::get_access_token().await
}

#[tauri::command]
async fn run_vertex_setup(project_id: String, remove: bool) -> Result<String, String> {
    use std::process::Command;
    use std::env;
    
    fn strip_ansi_codes(s: &str) -> String {
        let mut result = String::new();
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                if chars.peek() == Some(&'[') {
                    chars.next();
                    while let Some(&next) = chars.peek() {
                        chars.next();
                        if next.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
            } else {
                result.push(c);
            }
        }
        result
    }
    
    let script_path = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("scripts")
            .join("01-setup-vertex-sa.sh")
    } else {
        let exe_path = env::current_exe().map_err(|e| e.to_string())?;
        exe_path
            .parent()
            .unwrap()
            .join("../Resources/scripts/01-setup-vertex-sa.sh")
    };
    
    if !script_path.exists() {
        return Err(format!("Setup script not found at: {:?}", script_path));
    }
    
    let mut cmd = Command::new("bash");
    cmd.arg(&script_path);
    
    // Always use --yes for non-interactive mode from the app
    cmd.arg("--yes");
    
    if remove {
        cmd.arg("--remove");
    }
    
    cmd.arg(&project_id);
    
    let output = cmd.output().map_err(|e| format!("Failed to run script: {}", e))?;
    
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    
    if output.status.success() {
        Ok(format!("{}\n{}", stdout, stderr))
    } else {
        Err(format!("Script failed:\n{}\n{}", stdout, stderr))
    }
}

#[tauri::command]
fn get_scripts_path() -> Result<String, String> {
    use std::env;
    
    let scripts_path = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("scripts")
    } else {
        let exe_path = env::current_exe().map_err(|e| e.to_string())?;
        exe_path
            .parent()
            .unwrap()
            .join("../Resources/scripts")
    };
    
    Ok(scripts_path.to_string_lossy().to_string())
}

#[tauri::command]
fn check_gcloud_auth() -> Result<String, String> {
    use std::process::Command;
    
    let gcloud_path = find_gcloud().ok_or("gcloud CLI is not installed. Please install it from https://cloud.google.com/sdk/docs/install")?;
    
    // Try to get an access token - this will fail if auth is expired
    let output = Command::new(&gcloud_path)
        .args(["auth", "print-access-token"])
        .output()
        .map_err(|e| format!("Failed to check auth: {}", e))?;
    
    if output.status.success() {
        // Get the authenticated account
        let account_output = Command::new(&gcloud_path)
            .args(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"])
            .output()
            .map_err(|e| format!("Failed to get account: {}", e))?;
        
        let account = String::from_utf8_lossy(&account_output.stdout)
            .trim()
            .lines()
            .next()
            .unwrap_or("Unknown")
            .to_string();
        
        Ok(account)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Authentication required: {}", stderr.trim()))
    }
}

fn find_gcloud() -> Option<String> {
    use std::path::Path;
    use std::process::Command;
    
    let common_paths = [
        "/usr/local/bin/gcloud",
        "/opt/homebrew/bin/gcloud",
        "/usr/bin/gcloud",
        "/opt/google-cloud-sdk/bin/gcloud",
    ];
    
    // Check common paths first
    for path in common_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    
    // Check user's home directory for gcloud SDK
    if let Some(home) = dirs::home_dir() {
        let home_sdk = home.join("google-cloud-sdk/bin/gcloud");
        if home_sdk.exists() {
            return Some(home_sdk.to_string_lossy().to_string());
        }
    }
    
    // Try to find via shell (gets user's PATH)
    if let Ok(output) = Command::new("sh")
        .args(["-l", "-c", "which gcloud"])
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    
    None
}

#[tauri::command]
fn open_gcloud_auth() -> Result<(), String> {
    use std::process::Command;
    
    // Open Terminal.app with gcloud auth login command
    #[cfg(target_os = "macos")]
    {
        Command::new("osascript")
            .args([
                "-e",
                r#"tell application "Terminal"
                    activate
                    if (count of windows) = 0 then
                        do script "echo 'Authenticating with Google Cloud...' && gcloud auth login && echo '' && echo 'Authentication complete! You can close this window and return to Cortex Agent.'"
                    else
                        do script "echo 'Authenticating with Google Cloud...' && gcloud auth login && echo '' && echo 'Authentication complete! You can close this window and return to Cortex Agent.'" in front window
                    end if
                end tell"#,
            ])
            .output()
            .map_err(|e| format!("Failed to open Terminal: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/c", "start", "cmd", "/k", "gcloud auth login"])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        // Try common terminal emulators
        let terminals = ["gnome-terminal", "konsole", "xterm"];
        let mut opened = false;
        for term in terminals {
            if Command::new(term)
                .args(["--", "bash", "-c", "gcloud auth login; read -p 'Press Enter to close...'"])
                .spawn()
                .is_ok()
            {
                opened = true;
                break;
            }
        }
        if !opened {
            return Err("Could not open terminal. Please run 'gcloud auth login' manually.".to_string());
        }
    }
    
    Ok(())
}

fn main() {
    use tauri::menu::{Menu, MenuItem, Submenu, PredefinedMenuItem};
    use tauri::Manager;
    
    tauri::Builder::default()
        .manage(Arc::new(AtomicBool::new(false)))
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
                "Cortex Agent",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Cortex Agent"), None)?,
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
            generate_image,
            deep_research,
            layout_parse,
            speech_to_text,
            rag_create_store,
            rag_list_stores,
            rag_delete_store,
            rag_upload_file,
            rag_list_files,
            rag_query,
            coding_agent_chat,
            coding_agent_stop,
            save_image,
            save_output,
            create_project,
            save_to_project,
            list_projects,
            get_project_path,
            save_image_to_project,
            has_service_account,
            get_service_account_project_id,
            get_vertex_token,
            run_vertex_setup,
            get_scripts_path,
            check_gcloud_auth,
            open_gcloud_auth,
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

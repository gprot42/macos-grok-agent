#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod auth;
mod storage;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    #[serde(rename = "fontSize")]
    pub font_size: u32,
    #[serde(rename = "apiKey")]
    pub api_key: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            font_size: 14,
            api_key: String::new(),
            project_id: String::new(),
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
        attached_file,
    )
    .await
}

#[tauri::command]
async fn generate_image(
    prompt: String,
    api_key: String,
    edit_image: Option<String>,
) -> Result<String, String> {
    api::generate_image(prompt, api_key, edit_image).await
}

#[tauri::command]
async fn deep_research(
    prompt: String,
    api_key: String,
) -> Result<ChatResponse, String> {
    api::deep_research(prompt, api_key).await
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

fn main() {
    use tauri::menu::{Menu, Submenu, PredefinedMenuItem};
    
    tauri::Builder::default()
        .enable_macos_default_menu(false)
        .menu(|handle| {
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
            
            Menu::with_items(handle, &[&edit_menu])
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            save_api_key,
            send_chat_message,
            generate_image,
            deep_research,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

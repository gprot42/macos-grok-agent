use crate::AppSettings;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

pub fn get_storage_dir_pub() -> Result<PathBuf, String> {
    get_storage_dir()
}

fn get_storage_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let dir = home.join(".grok-agent");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create storage dir: {}", e))?;
    Ok(dir)
}

fn get_machine_id() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                for line in stdout.lines() {
                    if line.contains("IOPlatformUUID") {
                        if let Some(uuid) = line.split('"').nth(3) {
                            return uuid.to_string();
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(id) = fs::read_to_string("/etc/machine-id") {
            return id.trim().to_string();
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("wmic")
            .args(["csproduct", "get", "UUID"])
            .output()
        {
            if let Ok(stdout) = String::from_utf8(output.stdout) {
                if let Some(line) = stdout.lines().nth(1) {
                    return line.trim().to_string();
                }
            }
        }
    }

    format!(
        "{}-{}",
        whoami::username(),
        whoami::fallible::hostname().unwrap_or_else(|_| "unknown".to_string())
    )
}

fn get_encryption_key() -> [u8; 32] {
    let machine_id = get_machine_id();
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    key
}

fn encrypt(data: &str) -> Result<String, String> {
    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Cipher error: {}", e))?;

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;

    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(BASE64.encode(&combined))
}

fn decrypt(data: &str) -> Result<String, String> {
    let key = get_encryption_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Cipher error: {}", e))?;

    let combined = BASE64.decode(data).map_err(|e| format!("Decode error: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted data".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption error: {}", e))?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 error: {}", e))
}

pub async fn load_settings() -> Result<Option<AppSettings>, String> {
    let dir = get_storage_dir()?;
    let settings_path = dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;

    let mut settings: AppSettings =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))?;

    let api_key_path = dir.join("api_key.enc");
    if api_key_path.exists() {
        if let Ok(encrypted) = fs::read_to_string(&api_key_path) {
            if let Ok(decrypted) = decrypt(&encrypted) {
                settings.api_key = decrypted;
            }
        }
    }

    Ok(Some(settings))
}

pub async fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let dir = get_storage_dir()?;
    let settings_path = dir.join("settings.json");

    let mut save_settings = settings.clone();
    save_settings.api_key = String::new();

    let content = serde_json::to_string_pretty(&save_settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content).map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}

pub async fn save_api_key(api_key: &str) -> Result<(), String> {
    let dir = get_storage_dir()?;
    let api_key_path = dir.join("api_key.enc");

    if api_key.is_empty() {
        if api_key_path.exists() {
            fs::remove_file(&api_key_path)
                .map_err(|e| format!("Failed to remove API key: {}", e))?;
        }
        return Ok(());
    }

    let encrypted = encrypt(api_key)?;
    fs::write(&api_key_path, encrypted).map_err(|e| format!("Failed to write API key: {}", e))?;

    Ok(())
}

pub async fn save_image(image_base64: &str, filename: &str) -> Result<(), String> {
    let downloads = dirs::download_dir()
        .or_else(dirs::document_dir)
        .ok_or("Could not find downloads directory")?;

    let path = downloads.join(filename);
    let data = BASE64
        .decode(image_base64)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    fs::write(&path, data).map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(())
}

pub async fn save_output(content: &str, filename: &str) -> Result<String, String> {
    let downloads = dirs::download_dir()
        .or_else(dirs::document_dir)
        .ok_or("Could not find downloads directory")?;

    let path = downloads.join(filename);
    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

pub async fn create_project(project_name: &str) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let projects_dir = home.join("Cortex Projects");
    fs::create_dir_all(&projects_dir).map_err(|e| format!("Failed to create projects dir: {}", e))?;

    let project_dir = projects_dir.join(project_name);
    fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create project dir: {}", e))?;

    let subdirs = ["prompts", "outputs", "images", "files"];
    for subdir in subdirs {
        let dir_path = project_dir.join(subdir);
        fs::create_dir_all(&dir_path).map_err(|e| format!("Failed to create {}: {}", subdir, e))?;
    }

    Ok(project_dir.to_string_lossy().to_string())
}

pub async fn save_to_project(project_path: &str, subfolder: &str, filename: &str, content: &str) -> Result<String, String> {
    let path = PathBuf::from(project_path).join(subfolder).join(filename);
    
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    fs::write(&path, content).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

pub async fn list_projects() -> Result<Vec<String>, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let projects_dir = home.join("Cortex Projects");

    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let entries = fs::read_dir(&projects_dir)
        .map_err(|e| format!("Failed to read projects dir: {}", e))?;

    let mut projects = Vec::new();
    for entry in entries.flatten() {
        if entry.path().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                projects.push(name.to_string());
            }
        }
    }

    projects.sort();
    Ok(projects)
}

pub async fn get_project_path(project_name: &str) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let project_dir = home.join("Cortex Projects").join(project_name);

    if !project_dir.exists() {
        return Err("Project not found".to_string());
    }

    Ok(project_dir.to_string_lossy().to_string())
}

pub async fn save_working_dir(path: &str) -> Result<(), String> {
    let dir = get_storage_dir()?;
    fs::write(dir.join("working_dir.txt"), path)
        .map_err(|e| format!("Failed to save working dir: {}", e))
}

pub async fn load_working_dir() -> Result<Option<String>, String> {
    let dir = get_storage_dir()?;
    let path = dir.join("working_dir.txt");
    if !path.exists() { return Ok(None); }
    let s = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read working dir: {}", e))?;
    let trimmed = s.trim().to_string();
    if trimmed.is_empty() { Ok(None) } else { Ok(Some(trimmed)) }
}

pub async fn save_sessions(sessions_json: &str) -> Result<(), String> {
    let dir = get_storage_dir()?;
    let path = dir.join("sessions.json");
    fs::write(&path, sessions_json)
        .map_err(|e| format!("Failed to write sessions: {}", e))?;
    Ok(())
}

pub async fn load_sessions() -> Result<Option<String>, String> {
    let dir = get_storage_dir()?;
    let path = dir.join("sessions.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read sessions: {}", e))?;
    Ok(Some(content))
}

pub async fn save_image_to_project(project_path: &str, filename: &str, image_base64: &str) -> Result<String, String> {
    let path = PathBuf::from(project_path).join("images").join(filename);
    
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let data = BASE64
        .decode(image_base64)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    fs::write(&path, data).map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(path.to_string_lossy().to_string())
}

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub children: Option<Vec<DirEntry>>,
}

pub fn agent_tools_schema() -> Vec<Value> {
    vec![
        json!({
            "name": "read_file",
            "description": "Read the contents of a file at the given path.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute or relative file path to read" }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "write_file",
            "description": "Create or overwrite a file with the given content. Creates parent directories if needed.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path to write to" },
                    "content": { "type": "string", "description": "Full file content to write" }
                },
                "required": ["path", "content"]
            }
        }),
        json!({
            "name": "edit_file",
            "description": "Replace a specific section of an existing file. Provide the exact text to find and the replacement text.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path to edit" },
                    "old_text": { "type": "string", "description": "Exact text to find in the file" },
                    "new_text": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_text", "new_text"]
            }
        }),
        json!({
            "name": "run_command",
            "description": "Execute a shell command in the working directory. Returns stdout, stderr, and exit code.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": "list_directory",
            "description": "List the file tree of a directory recursively up to a given depth.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path to list" },
                    "max_depth": { "type": "integer", "description": "Maximum recursion depth (default 3)" }
                },
                "required": ["path"]
            }
        }),
    ]
}

fn resolve_path(base_dir: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(base_dir).join(p)
    }
}

pub async fn exec_read_file(base_dir: &str, path: &str) -> Result<String, String> {
    let full = resolve_path(base_dir, path);
    fs::read_to_string(&full)
        .await
        .map_err(|e| format!("Failed to read {}: {}", full.display(), e))
}

pub async fn exec_write_file(base_dir: &str, path: &str, content: &str) -> Result<String, String> {
    let full = resolve_path(base_dir, path);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }
    fs::write(&full, content)
        .await
        .map_err(|e| format!("Failed to write {}: {}", full.display(), e))?;
    Ok(format!("Wrote {} bytes to {}", content.len(), full.display()))
}

pub async fn exec_edit_file(
    base_dir: &str,
    path: &str,
    old_text: &str,
    new_text: &str,
) -> Result<String, String> {
    let full = resolve_path(base_dir, path);
    let existing = fs::read_to_string(&full)
        .await
        .map_err(|e| format!("Failed to read {}: {}", full.display(), e))?;

    let count = existing.matches(old_text).count();
    if count == 0 {
        return Err(format!(
            "Text not found in {}. No changes made.",
            full.display()
        ));
    }

    let updated = existing.replacen(old_text, new_text, 1);
    fs::write(&full, &updated)
        .await
        .map_err(|e| format!("Failed to write {}: {}", full.display(), e))?;

    Ok(format!(
        "Edited {} — replaced 1 occurrence ({} total found)",
        full.display(),
        count
    ))
}

pub async fn exec_run_command(base_dir: &str, command: &str) -> Result<CommandResult, String> {
    let output = Command::new("bash")
        .arg("-c")
        .arg(command)
        .current_dir(base_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let max_len = 50_000;
    Ok(CommandResult {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: if stdout.len() > max_len {
            format!("{}...[truncated]", &stdout[..max_len])
        } else {
            stdout
        },
        stderr: if stderr.len() > max_len {
            format!("{}...[truncated]", &stderr[..max_len])
        } else {
            stderr
        },
    })
}

pub async fn exec_list_directory(base_dir: &str, path: &str, max_depth: u32) -> Result<String, String> {
    let full = resolve_path(base_dir, path);
    let tree = build_tree(&full, max_depth, 0).await?;
    Ok(format_tree(&tree, "", true))
}

async fn build_tree(path: &Path, max_depth: u32, current_depth: u32) -> Result<DirEntry, String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    let metadata = fs::metadata(path)
        .await
        .map_err(|e| format!("Cannot read {}: {}", path.display(), e))?;

    if !metadata.is_dir() {
        return Ok(DirEntry {
            name,
            entry_type: "file".to_string(),
            children: None,
        });
    }

    if current_depth >= max_depth {
        return Ok(DirEntry {
            name: format!("{}/", name),
            entry_type: "directory".to_string(),
            children: None,
        });
    }

    let skip_dirs = [
        "node_modules", ".git", "target", "dist", "build", ".next",
        "__pycache__", ".venv", "venv", ".verdent",
    ];

    let mut entries = Vec::new();
    let mut read_dir = fs::read_dir(path)
        .await
        .map_err(|e| format!("Cannot list {}: {}", path.display(), e))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Read dir error: {}", e))?
    {
        let entry_name = entry.file_name().to_string_lossy().to_string();
        if entry_name.starts_with('.') && entry_name != ".env" && entry_name != ".gitignore" {
            continue;
        }
        if skip_dirs.contains(&entry_name.as_str()) {
            continue;
        }
        if let Ok(child) = Box::pin(build_tree(&entry.path(), max_depth, current_depth + 1)).await {
            entries.push(child);
        }
    }

    entries.sort_by(|a, b| {
        let a_is_dir = a.entry_type == "directory";
        let b_is_dir = b.entry_type == "directory";
        b_is_dir.cmp(&a_is_dir).then(a.name.cmp(&b.name))
    });

    Ok(DirEntry {
        name: format!("{}/", name),
        entry_type: "directory".to_string(),
        children: Some(entries),
    })
}

fn format_tree(entry: &DirEntry, prefix: &str, is_last: bool) -> String {
    let mut result = String::new();
    let connector = if prefix.is_empty() { "" } else if is_last { "└── " } else { "├── " };
    result.push_str(&format!("{}{}{}\n", prefix, connector, entry.name));

    if let Some(children) = &entry.children {
        let new_prefix = if prefix.is_empty() {
            String::new()
        } else if is_last {
            format!("{}    ", prefix)
        } else {
            format!("{}│   ", prefix)
        };
        for (i, child) in children.iter().enumerate() {
            result.push_str(&format_tree(child, &new_prefix, i == children.len() - 1));
        }
    }

    result
}

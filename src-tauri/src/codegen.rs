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
        json!({
            "name": "delete_file",
            "description": "Delete a single file. A .bak backup is created automatically before deletion. Use this instead of run_command with rm.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path of the file to delete (relative to working directory)" }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "fetch_url",
            "description": "Fetch a web page or URL and return its readable text content (HTML is stripped). Use for research, reading docs, checking APIs, or browsing the web. Requires user consent for external requests.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "url":       { "type": "string",  "description": "Full URL to fetch (must start with https:// or http://)" },
                    "max_chars": { "type": "integer", "description": "Max characters to return (default 12000, max 40000)" }
                },
                "required": ["url"]
            }
        }),
    ]
}

fn resolve_path(base_dir: &str, path: &str) -> PathBuf {
    let p = Path::new(path);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        let joined = Path::new(base_dir).join(p);
        // If the joined path doesn't exist but the raw path relative to base does,
        // or if the relative path starts with the base dir's last component, strip it
        if !joined.exists() {
            let base = Path::new(base_dir);
            if let Some(base_name) = base.file_name().and_then(|n| n.to_str()) {
                if let Ok(stripped) = p.strip_prefix(base_name) {
                    return base.join(stripped);
                }
            }
        }
        joined
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

    // Safety: if the file already exists, create a backup
    if full.exists() {
        let backup = full.with_extension(
            format!("{}.bak", full.extension().and_then(|e| e.to_str()).unwrap_or(""))
        );
        if let Err(e) = fs::copy(&full, &backup).await {
            info!("[agent] Warning: could not backup {}: {}", full.display(), e);
        } else {
            info!("[agent] Backed up {} -> {}", full.display(), backup.display());
        }
    }
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

/// Check whether a command string contains file-deletion patterns.
/// Returns Some(reason) if blocked, None if clean.
fn deletion_block_reason(cmd_lower: &str, command: &str) -> Option<String> {
    // Always-blocked: destructive disk-level commands regardless of deletion setting
    let always_blocked = ["mkfs", "format c:", "> /dev/"];
    for p in &always_blocked {
        if cmd_lower.contains(p) {
            return Some(format!(
                "Blocked: destructive disk command is never allowed. Command: {}",
                command
            ));
        }
    }

    // File-deletion patterns (conditional on block_file_deletion setting)
    let blocked_prefixes = ["rm ", "rm\t", "rmdir ", "shred "];
    let blocked_contains = [
        "rm -rf", "rm -r ", "rm -f ", "rm *",
        "find . -delete", "find . -exec rm",
        "git clean -fd", "git clean -fx", "git clean -xfd",
        "truncate ", ":> ", "unlink ",
    ];

    for prefix in &blocked_prefixes {
        if cmd_lower.starts_with(prefix) || cmd_lower.contains(&format!(" {}", prefix.trim_end())) {
            return Some(format!(
                "File deletion command detected ({}). Command: {}",
                prefix.trim(),
                command
            ));
        }
    }
    for pattern in &blocked_contains {
        if cmd_lower.contains(pattern) {
            return Some(format!(
                "File deletion command detected ({}). Command: {}",
                pattern.trim(),
                command
            ));
        }
    }
    // git rm is a deletion UNLESS --cached flag is present
    if cmd_lower.contains("git rm") && !cmd_lower.contains("--cached") {
        return Some(format!(
            "File deletion command detected (git rm without --cached). Command: {}",
            command
        ));
    }
    None
}

pub async fn exec_run_command(
    base_dir: &str,
    command: &str,
    block_file_deletion: bool,
) -> Result<CommandResult, String> {
    let cmd_lower = command.to_lowercase();

    // Always-blocked destructive disk ops (independent of setting)
    let always_blocked = ["mkfs", "format c:", "> /dev/"];
    for p in &always_blocked {
        if cmd_lower.contains(p) {
            return Err(format!(
                "Blocked: destructive disk command is never allowed. Command: {}",
                command
            ));
        }
    }

    if block_file_deletion {
        if let Some(reason) = deletion_block_reason(&cmd_lower, command) {
            // Return a *soft* Ok result (not Err) so the agent loop can continue.
            // is_error will be false; the agent receives a clear explanatory message
            // and can retry with delete_file or alternative commands.
            return Ok(CommandResult {
                exit_code: 0,
                stdout: format!(
                    "⚠ Skipped: {}  \n\
                     The 'Block file deletion' setting is enabled. \
                     To delete files/directories use the 'delete_file' tool for individual files, \
                     or disable 'Block file deletion' in Settings → Agent.",
                    reason
                ),
                stderr: String::new(),
            });
        }
    }

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

/// Fetch a URL and return its text content (HTML stripped to readable text, truncated).
pub async fn exec_fetch_url(url: &str, max_chars: Option<usize>) -> Result<String, String> {
    let limit = max_chars.unwrap_or(12_000);

    // Basic URL validation
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(format!("Invalid URL — must start with http:// or https://: {}", url));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Cortex-Agent/1.0 (research tool; contact: user)")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Fetch failed for {}: {}", url, e))?;

    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    // Strip HTML tags for readability
    let text = if content_type.contains("html") {
        strip_html_tags(&body)
    } else {
        body
    };

    // Truncate to limit
    let truncated: String = text.chars().take(limit).collect();
    let suffix = if text.chars().count() > limit {
        format!("\n\n[...truncated to {} chars — use a smaller page or a specific section]", limit)
    } else {
        String::new()
    };

    Ok(format!(
        "URL: {}\nStatus: {}\nContent-Type: {}\n\n---\n\n{}{}",
        url, status, content_type, truncated, suffix
    ))
}

fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut in_script = false;
    let mut buf = String::new();

    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        match c {
            '<' => {
                // Check for <script or <style — skip until closing tag
                let rest = &html[i..];
                if rest.to_ascii_lowercase().starts_with("<script")
                    || rest.to_ascii_lowercase().starts_with("<style")
                {
                    in_script = true;
                } else if in_script && (rest.to_ascii_lowercase().starts_with("</script")
                    || rest.to_ascii_lowercase().starts_with("</style"))
                {
                    in_script = false;
                }
                in_tag = true;
                buf.clear();
            }
            '>' => {
                in_tag = false;
                // Add space after block elements for readability
                let tag = buf.to_ascii_lowercase();
                if ["p", "br", "div", "h1", "h2", "h3", "h4", "li", "tr"].iter().any(|t| tag.starts_with(t)) {
                    result.push('\n');
                }
            }
            _ if in_tag => {
                buf.push(c);
            }
            _ if !in_script => {
                result.push(c);
            }
            _ => {}
        }
        i += 1;
    }

    // Collapse excessive whitespace
    let mut out = String::new();
    let mut prev_newline = false;
    for line in result.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !prev_newline { out.push('\n'); }
            prev_newline = true;
        } else {
            out.push_str(trimmed);
            out.push('\n');
            prev_newline = false;
        }
    }
    out.trim().to_string()
}

pub async fn exec_delete_file(base_dir: &str, path: &str) -> Result<String, String> {
    let full = resolve_path(base_dir, path);

    if !full.exists() {
        return Err(format!("File not found: {}", full.display()));
    }
    if full.is_dir() {
        return Err(format!(
            "Cannot delete directories with this tool: {}. Use run_command only if absolutely necessary.",
            full.display()
        ));
    }

    // Back up before deleting
    let backup = full.with_extension(
        format!("{}.bak", full.extension().and_then(|e| e.to_str()).unwrap_or(""))
    );
    if let Err(e) = fs::copy(&full, &backup).await {
        info!("[agent] Warning: could not backup before delete {}: {}", full.display(), e);
    } else {
        info!("[agent] Backed up {} -> {} before deletion", full.display(), backup.display());
    }

    fs::remove_file(&full)
        .await
        .map_err(|e| format!("Failed to delete {}: {}", full.display(), e))?;

    Ok(format!("Deleted {} (backup saved as {})", full.display(), backup.display()))
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

// ── Live code execution ───────────────────────────────────────────────────────

/// Execute a code snippet for the given language.  Returns stdout, stderr,
/// exit code, and wall-clock duration in milliseconds.
pub async fn exec_code_snippet(
    working_dir: &str,
    code: &str,
    language: &str,
) -> Result<Value, String> {
    use std::time::Instant;
    let start = Instant::now();

    let tmp_dir = std::env::temp_dir();
    let id = uuid::Uuid::new_v4().to_string().replace('-', "");

    let lang = language.to_lowercase();
    let lang = lang.trim();

    let output = match lang {
        "bash" | "sh" | "shell" | "" => {
            let tmp = tmp_dir.join(format!("grok_{}.sh", id));
            fs::write(&tmp, code).await.map_err(|e| format!("write tmp: {}", e))?;
            Command::new("bash")
                .arg(tmp.to_string_lossy().as_ref())
                .current_dir(working_dir)
                .output()
                .await
                .map_err(|e| format!("bash: {}", e))?
        }
        "python" | "python3" | "py" => {
            let tmp = tmp_dir.join(format!("grok_{}.py", id));
            fs::write(&tmp, code).await.map_err(|e| format!("write tmp: {}", e))?;
            Command::new("python3")
                .arg(tmp.to_string_lossy().as_ref())
                .current_dir(working_dir)
                .output()
                .await
                .map_err(|e| format!("python3: {}", e))?
        }
        "javascript" | "js" | "node" => {
            let tmp = tmp_dir.join(format!("grok_{}.js", id));
            fs::write(&tmp, code).await.map_err(|e| format!("write tmp: {}", e))?;
            Command::new("node")
                .arg(tmp.to_string_lossy().as_ref())
                .current_dir(working_dir)
                .output()
                .await
                .map_err(|e| format!("node: {}", e))?
        }
        "typescript" | "ts" => {
            let tmp = tmp_dir.join(format!("grok_{}.ts", id));
            fs::write(&tmp, code).await.map_err(|e| format!("write tmp: {}", e))?;
            // Try ts-node via npx; fall back to plain node if ts-node unavailable
            let res = Command::new("npx")
                .args(["--yes", "ts-node", "--transpile-only", tmp.to_string_lossy().as_ref()])
                .current_dir(working_dir)
                .output()
                .await;
            match res {
                Ok(o) => o,
                Err(_) => Command::new("node")
                    .arg(tmp.to_string_lossy().as_ref())
                    .current_dir(working_dir)
                    .output()
                    .await
                    .map_err(|e| format!("node fallback: {}", e))?,
            }
        }
        "rust" | "rs" => {
            // Write main.rs to a temp dir and `cargo script` if available, else compile inline
            let tmp_proj = tmp_dir.join(format!("grok_rs_{}", id));
            fs::create_dir_all(&tmp_proj).await.map_err(|e| format!("mkdir: {}", e))?;
            let src = tmp_proj.join("main.rs");
            // Wrap in main() if no fn main is detected
            let wrapped = if code.contains("fn main") {
                code.to_string()
            } else {
                format!("fn main() {{\n{}\n}}", code)
            };
            fs::write(&src, wrapped).await.map_err(|e| format!("write rs: {}", e))?;
            Command::new("rustc")
                .args([
                    src.to_string_lossy().as_ref(),
                    "-o",
                    tmp_proj.join("out").to_string_lossy().as_ref(),
                ])
                .output()
                .await
                .map_err(|e| format!("rustc: {}", e))?;
            Command::new(tmp_proj.join("out").to_string_lossy().as_ref())
                .current_dir(working_dir)
                .output()
                .await
                .map_err(|e| format!("run: {}", e))?
        }
        _ => {
            return Err(format!(
                "Unsupported language '{}'. Supported: bash/sh, python/py, javascript/js, typescript/ts, rust/rs",
                language
            ));
        }
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(json!({
        "stdout": String::from_utf8_lossy(&output.stdout).trim_end().to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).trim_end().to_string(),
        "exitCode": output.status.code().unwrap_or(-1),
        "durationMs": duration_ms,
    }))
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

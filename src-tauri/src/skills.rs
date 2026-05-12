/// Agent Skills — discovery and loading.
///
/// A skill is a folder containing a `SKILL.md` file with YAML frontmatter:
///
/// ```markdown
/// ---
/// name: My Skill
/// description: What this skill does
/// ---
///
/// Full instructions for the agent...
/// ```
///
/// Reference: https://agentskills.io

use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMeta {
    /// Stable ID — relative path from the skills root (e.g. "git-workflow")
    pub id: String,
    pub name: String,
    pub description: String,
    /// Absolute path to the skill's SKILL.md file
    pub skill_md_path: String,
    /// Absolute path to the skill directory
    pub dir: String,
}

/// Parse `name:` and `description:` from YAML frontmatter block.
fn parse_frontmatter(content: &str) -> (String, String) {
    let mut name = String::new();
    let mut description = String::new();

    // Frontmatter must start at the very beginning with `---`
    if !content.trim_start().starts_with("---") {
        return (name, description);
    }

    let after_open = content.trim_start_matches("---").trim_start_matches('\n');
    let end = after_open.find("\n---").unwrap_or(after_open.len());
    let fm = &after_open[..end];

    for line in fm.lines() {
        if let Some(rest) = line.strip_prefix("name:") {
            name = rest.trim().trim_matches('"').trim_matches('\'').to_string();
        } else if let Some(rest) = line.strip_prefix("description:") {
            description = rest.trim().trim_matches('"').trim_matches('\'').to_string();
        }
    }

    (name, description)
}

/// Recursively scan `skills_dir` for SKILL.md files (max depth 3).
pub async fn list_skills(skills_dir: &str) -> Result<Vec<SkillMeta>, String> {
    let root = Path::new(skills_dir);
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();
    scan_dir(root, root, 0, &mut skills).await;
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

fn scan_dir<'a>(
    root: &'a Path,
    dir: &'a Path,
    depth: u32,
    out: &'a mut Vec<SkillMeta>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        if depth > 3 { return; }

        let mut rd = match fs::read_dir(dir).await {
            Ok(rd) => rd,
            Err(_) => return,
        };

        while let Ok(Some(entry)) = rd.next_entry().await {
            let path = entry.path();

            if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if skill_md.exists() {
                    if let Ok(content) = fs::read_to_string(&skill_md).await {
                        let (mut name, description) = parse_frontmatter(&content);
                        if name.is_empty() {
                            name = path
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("Unknown")
                                .to_string();
                        }
                        let id = path
                            .strip_prefix(root)
                            .ok()
                            .and_then(|p| p.to_str())
                            .unwrap_or(path.to_str().unwrap_or(""))
                            .to_string();
                        out.push(SkillMeta {
                            id,
                            name,
                            description,
                            skill_md_path: skill_md.to_string_lossy().to_string(),
                            dir: path.to_string_lossy().to_string(),
                        });
                    }
                } else {
                    // Recurse into subdirectory
                    scan_dir(root, &path, depth + 1, out).await;
                }
            }
        }
    })
}

/// Read the full SKILL.md content (instructions only — strips the frontmatter block).
pub async fn read_skill_content(skill_md_path: &str) -> Result<String, String> {
    let raw = fs::read_to_string(skill_md_path)
        .await
        .map_err(|e| format!("Failed to read {}: {}", skill_md_path, e))?;

    // Strip frontmatter so the agent sees only the instructions
    if raw.trim_start().starts_with("---") {
        let after_open = raw.trim_start_matches("---").trim_start_matches('\n');
        if let Some(pos) = after_open.find("\n---") {
            let instructions = after_open[pos + 4..].trim_start_matches('\n');
            return Ok(instructions.to_string());
        }
    }
    Ok(raw)
}

/// Build a combined instructions block from a list of SKILL.md paths.
/// Returns None if all reads fail or the list is empty.
pub async fn build_skills_context(skill_md_paths: &[String]) -> Option<String> {
    if skill_md_paths.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    for path in skill_md_paths {
        if let Ok(content) = read_skill_content(path).await {
            if !content.trim().is_empty() {
                parts.push(content);
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(format!(
            "## Active Agent Skills\n\nThe following skills are active for this session. Follow their instructions for any relevant tasks:\n\n---\n\n{}",
            parts.join("\n\n---\n\n")
        ))
    }
}

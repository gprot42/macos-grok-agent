/// Agent chaining and deep-research pipeline.
///
/// Exports:
/// - `ChainStep` / `AgentPipeline` — serialisable pipeline definition
/// - `run_pipeline`   — sequential step executor (for `run_agent_pipeline` command)
/// - `deep_research`  — three-phase research: decompose → research → synthesise

use crate::{ChatResponse, Message};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};

#[allow(unused_imports)]
use log::{error, info, warn};

// ── Data structures ───────────────────────────────────────────────────────────

/// A single step in an agent pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStep {
    /// Human-readable name shown in progress events.
    pub name: String,
    /// Optional system prompt prepended before the user input.
    pub system_prompt: Option<String>,
    pub model_id: String,
    pub publisher: String,
    pub endpoint: String,
}

/// A sequential pipeline of agent steps where each step's output becomes the
/// next step's input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPipeline {
    pub steps: Vec<ChainStep>,
    /// The initial user input fed into step 0.
    pub initial_input: String,
}

// ── Sequential pipeline runner ────────────────────────────────────────────────

/// Run a pipeline sequentially, passing each step's output as the next step's
/// user input.  Emits `chain-step-start`, `chain-step-done`, and
/// `chain-pipeline-done` Tauri events.
pub async fn run_pipeline(
    pipeline: AgentPipeline,
    api_key: String,
    app_handle: AppHandle,
    task_id: String,
) -> Result<String, String> {
    let mut current_input = pipeline.initial_input.clone();

    for (i, step) in pipeline.steps.iter().enumerate() {
        info!(
            "[chain:{}] Step {}/{} — {}",
            task_id,
            i + 1,
            pipeline.steps.len(),
            step.name
        );
        let _ = app_handle.emit(
            "chain-step-start",
            json!({ "taskId": &task_id, "step": i, "name": &step.name }),
        );

        // Optionally prepend system prompt as a prior assistant turn
        let prompt = match &step.system_prompt {
            Some(sp) if !sp.is_empty() => {
                format!("{}\n\n{}", sp, current_input)
            }
            _ => current_input.clone(),
        };

        let response = crate::api::send_chat_message(
            prompt,
            vec![],
            step.model_id.clone(),
            step.publisher.clone(),
            step.endpoint.clone(),
            api_key.clone(),
            String::new(), // project_id
            false,         // use_1m_context
            false,         // use_memory
            false,         // use_grounding
            None,          // thinking_level
            false,         // include_thoughts
            None,          // custom_url
            None,          // custom_login
            None,          // custom_password
            None,          // attached_file
            None,          // service_tier
            false,         // use_search
        )
        .await?;

        current_input = response.content.clone();

        let _ = app_handle.emit(
            "chain-step-done",
            json!({
                "taskId": &task_id,
                "step": i,
                "name": &step.name,
                "outputPreview": &current_input[..current_input.len().min(200)],
            }),
        );
    }

    let _ = app_handle.emit(
        "chain-pipeline-done",
        json!({ "taskId": &task_id, "output": &current_input }),
    );

    Ok(current_input)
}

// ── Deep research ─────────────────────────────────────────────────────────────

/// Three-phase deep research:
///
/// 1. **Decompose** — ask the model to produce 3-5 focused sub-questions.
/// 2. **Research**  — answer each sub-question individually (parallel via
///    `tokio::spawn`).
/// 3. **Synthesise** — combine all answers into a final report.
pub async fn deep_research(
    query: String,
    api_key: String,
    model_id: String,
    publisher: String,
    endpoint: String,
    app_handle: AppHandle,
    task_id: String,
) -> Result<ChatResponse, String> {
    // ── Phase 1: decompose ────────────────────────────────────────────────────
    info!("[deep_research:{}] Phase 1 — decompose", task_id);
    let _ = app_handle.emit(
        "deep-research-phase",
        json!({ "taskId": &task_id, "phase": "decompose", "message": "Breaking down research question…" }),
    );

    let decompose_prompt = format!(
        "You are a research assistant. Break the following research question into \
         exactly 3 to 5 focused, self-contained sub-questions that together \
         cover the topic comprehensively. Output ONLY a numbered list, one \
         sub-question per line, no additional text.\n\nQuestion: {}",
        query
    );

    let decompose_resp = crate::api::send_chat_message(
        decompose_prompt,
        vec![],
        model_id.clone(),
        publisher.clone(),
        endpoint.clone(),
        api_key.clone(),
        String::new(),
        false, false, false, None, false, None, None, None, None, None, false,
    )
    .await?;

    // Parse numbered sub-questions from the response
    let sub_questions: Vec<String> = decompose_resp
        .content
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            // Strip leading "1. ", "2. " etc.
            let stripped = trimmed
                .trim_start_matches(|c: char| c.is_ascii_digit())
                .trim_start_matches(['.', ')', ' '].as_ref());
            if stripped.len() > 10 {
                Some(stripped.to_string())
            } else {
                None
            }
        })
        .take(5)
        .collect();

    info!(
        "[deep_research:{}] Decomposed into {} sub-questions",
        task_id,
        sub_questions.len()
    );
    let _ = app_handle.emit(
        "deep-research-phase",
        json!({
            "taskId": &task_id,
            "phase": "research",
            "message": format!("Researching {} sub-questions in parallel…", sub_questions.len()),
            "subQuestions": &sub_questions,
        }),
    );

    // ── Phase 2: parallel research per sub-question ───────────────────────────
    let mut handles = Vec::new();

    for (i, sq) in sub_questions.iter().enumerate() {
        let sq = sq.clone();
        let api_key = api_key.clone();
        let model_id = model_id.clone();
        let publisher = publisher.clone();
        let endpoint = endpoint.clone();
        let app_handle = app_handle.clone();
        let task_id = task_id.clone();

        handles.push(tokio::spawn(async move {
            let prompt = format!(
                "Answer the following question thoroughly and concisely, \
                 citing facts where possible:\n\n{}",
                sq
            );
            let _ = app_handle.emit(
                "deep-research-subquestion-start",
                json!({ "taskId": &task_id, "index": i, "question": &sq }),
            );
            let result = crate::api::send_chat_message(
                prompt,
                vec![],
                model_id,
                publisher,
                endpoint,
                api_key,
                String::new(),
                false, false, false, None, false, None, None, None, None, None, false,
            )
            .await;
            match &result {
                Ok(r) => {
                    let _ = app_handle.emit(
                        "deep-research-subquestion-done",
                        json!({ "taskId": &task_id, "index": i, "question": &sq, "answerPreview": &r.content[..r.content.len().min(200)] }),
                    );
                }
                Err(e) => {
                    warn!("[deep_research] Sub-question {} failed: {}", i, e);
                }
            }
            (i, sq, result)
        }));
    }

    let mut findings: Vec<String> = Vec::new();
    for handle in handles {
        match handle.await {
            Ok((i, sq, Ok(resp))) => {
                findings.push(format!("**Sub-question {}**: {}\n**Answer**: {}", i + 1, sq, resp.content));
            }
            Ok((i, sq, Err(e))) => {
                findings.push(format!("**Sub-question {}**: {}\n**Answer**: (research failed: {})", i + 1, sq, e));
            }
            Err(join_err) => {
                warn!("[deep_research] Task join error: {}", join_err);
            }
        }
    }

    // ── Phase 3: synthesise ───────────────────────────────────────────────────
    info!("[deep_research:{}] Phase 3 — synthesise", task_id);
    let _ = app_handle.emit(
        "deep-research-phase",
        json!({ "taskId": &task_id, "phase": "synthesise", "message": "Synthesising findings into final report…" }),
    );

    let synthesise_prompt = format!(
        "You are a research analyst. Synthesise the following research findings \
         into a single comprehensive, well-structured report that directly \
         answers the original question. Use markdown headers and bullet points \
         where appropriate.\n\n\
         Original question: {}\n\n\
         Research findings:\n\n{}",
        query,
        findings.join("\n\n---\n\n")
    );

    let final_resp = crate::api::send_chat_message(
        synthesise_prompt,
        vec![],
        model_id,
        publisher,
        endpoint,
        api_key,
        String::new(),
        false, false, false, None, false, None, None, None, None, None, false,
    )
    .await?;

    let _ = app_handle.emit(
        "deep-research-phase",
        json!({ "taskId": &task_id, "phase": "complete", "message": "Research complete." }),
    );

    Ok(final_resp)
}

// ── Simple one-shot chat helper used by pipeline steps ────────────────────────

/// Build a `Message` vec from a single user string (for callers that need it).
#[allow(dead_code)]
pub fn single_message(content: &str) -> Vec<Message> {
    vec![Message { role: "user".to_string(), content: content.to_string() }]
}

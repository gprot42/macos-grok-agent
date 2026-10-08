/**
 * Helpers for the xAI Batch API video flow: prompt parsing, request ids,
 * batch naming, status summaries and result extraction.
 */

/** Names of batches created by this app start with this, so the list can show only ours. */
export const BATCH_NAME_PREFIX = "grok-agent-video";
export const MAX_BATCH_PROMPTS = 500;

export interface BatchState {
  num_requests?: number;
  num_pending?: number;
  num_success?: number;
  num_error?: number;
  num_cancelled?: number;
}

export interface BatchObject {
  batch_id: string;
  name?: string;
  create_time?: string;
  expire_time?: string;
  cancel_time?: string | null;
  state?: BatchState;
}

export interface VideoBatchResult {
  customId: string;
  url: string | null;
  error: string | null;
}

/** One prompt per non-empty line. */
export function parsePromptLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Stable id per prompt, echoed back in results as `batch_request_id`. */
export function customIdFor(index: number): string {
  return `v-${String(index + 1).padStart(3, "0")}`;
}

/** Inverse of `customIdFor`; null when the id isn't one of ours. */
export function promptIndexFromCustomId(id: string): number | null {
  const m = /^v-(\d+)$/.exec(id);
  return m ? Number(m[1]) - 1 : null;
}

export function batchName(count: number, firstPrompt: string, when = new Date()): string {
  const stamp = when.toISOString().slice(0, 16).replace("T", " ");
  const gist = firstPrompt.replace(/\s+/g, " ").slice(0, 40);
  return `${BATCH_NAME_PREFIX}: ${count} × "${gist}${firstPrompt.length > 40 ? "…" : ""}" · ${stamp}`;
}

export function isOurBatch(b: BatchObject): boolean {
  return (b.name ?? "").startsWith(BATCH_NAME_PREFIX);
}

export type BatchPhase = "running" | "done" | "cancelled";

export function summarizeBatch(b: BatchObject): {
  total: number;
  pending: number;
  success: number;
  failed: number;
  cancelled: number;
  /** 0–1 share of requests that have finished one way or another. */
  progress: number;
  phase: BatchPhase;
} {
  const s = b.state ?? {};
  const total = s.num_requests ?? 0;
  const pending = s.num_pending ?? 0;
  const success = s.num_success ?? 0;
  const failed = s.num_error ?? 0;
  const cancelled = s.num_cancelled ?? 0;
  const finished = success + failed + cancelled;
  const phase: BatchPhase =
    pending > 0 || (total === 0 && !b.cancel_time) ? "running" : b.cancel_time && cancelled > 0 ? "cancelled" : "done";
  return {
    total,
    pending,
    success,
    failed,
    cancelled,
    progress: total > 0 ? Math.min(1, finished / total) : 0,
    phase,
  };
}

/** Pull the video URL or error out of one raw results item (tolerates both documented error shapes). */
export function extractVideoResult(raw: unknown): VideoBatchResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const customId = String(r.batch_request_id ?? r.custom_id ?? "");
  const result = (r.batch_result ?? {}) as Record<string, unknown>;
  const response = (result.response ?? {}) as Record<string, unknown>;
  const video = ((response.video_generation as Record<string, unknown> | undefined)?.video ??
    (response.video as Record<string, unknown> | undefined)) as Record<string, unknown> | undefined;
  const url = typeof video?.url === "string" ? video.url : null;
  const errorRaw = result.error ?? r.error_message ?? r.error;
  const error =
    typeof errorRaw === "string" && errorRaw
      ? errorRaw
      : errorRaw && typeof errorRaw === "object"
        ? String((errorRaw as Record<string, unknown>).message ?? JSON.stringify(errorRaw))
        : null;
  return { customId, url, error: url ? null : error ?? (customId ? "No video in result" : "Malformed result") };
}

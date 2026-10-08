import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import {
  MAX_BATCH_PROMPTS,
  batchName,
  customIdFor,
  extractVideoResult,
  isOurBatch,
  parsePromptLines,
  promptIndexFromCustomId,
  summarizeBatch,
  type BatchObject,
  type VideoBatchResult,
} from "../lib/batch";

/** Prompts per batch id, so results can be labelled (the API only echoes our request ids). */
const PROMPTS_STORAGE_KEY = "grok-agent.videoBatchPrompts";
const POLL_MS = 30_000;

function loadPromptMap(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(PROMPTS_STORAGE_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

function savePromptMap(map: Record<string, string[]>) {
  try {
    localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — results just show request ids */
  }
}

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

interface BatchVideoSectionProps {
  apiKey: string;
  modelId: string;
  modelName: string;
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  withAudio: boolean;
  /** Approximate $ per second for the selected model/resolution. */
  ratePerSecond: number;
}

export function BatchVideoSection({
  apiKey,
  modelId,
  modelName,
  durationSeconds,
  resolution,
  aspectRatio,
  withAudio,
  ratePerSecond,
}: BatchVideoSectionProps) {
  const [promptsText, setPromptsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchObject[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, VideoBatchResult[]>>({});
  const [loadingResults, setLoadingResults] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [promptMap, setPromptMap] = useState<Record<string, string[]>>(loadPromptMap);

  const prompts = parsePromptLines(promptsText);
  const estimate = prompts.length * durationSeconds * ratePerSecond;

  const loadBatches = useCallback(async () => {
    setLoadingList(true);
    try {
      const resp = await invoke<{ batches?: BatchObject[]; data?: BatchObject[] }>("video_batch_list", {
        apiKey,
        paginationToken: null,
      });
      const list = (resp.batches ?? resp.data ?? []).filter(isOurBatch);
      list.sort((a, b) => (b.create_time ?? "").localeCompare(a.create_time ?? ""));
      setBatches(list);
    } catch (e) {
      setError(`Couldn't load batches: ${errText(e)}`);
    } finally {
      setLoadingList(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  // Batches finish "within 24 hours" (best effort) — poll while any is still running.
  const anyRunning = batches.some((b) => summarizeBatch(b).phase === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => void loadBatches(), POLL_MS);
    return () => clearInterval(id);
  }, [anyRunning, loadBatches]);

  const handleSubmit = async () => {
    setError(null);
    setNotice(null);
    if (prompts.length === 0) return;
    if (prompts.length > MAX_BATCH_PROMPTS) {
      setError(`At most ${MAX_BATCH_PROMPTS} prompts per batch (you have ${prompts.length}).`);
      return;
    }
    setSubmitting(true);
    try {
      const batch = await invoke<BatchObject>("video_batch_create", {
        apiKey,
        name: batchName(prompts.length, prompts[0]),
        items: prompts.map((prompt, i) => ({ customId: customIdFor(i), prompt })),
        settings: { model: modelId, durationSeconds, resolution, aspectRatio, withAudio },
      });
      const next = { ...promptMap, [batch.batch_id]: prompts };
      setPromptMap(next);
      savePromptMap(next);
      setBatches((prev) => [batch, ...prev.filter((b) => b.batch_id !== batch.batch_id)]);
      setPromptsText("");
      setNotice(
        `Submitted ${prompts.length} video${prompts.length > 1 ? "s" : ""}. Batches usually finish within 24 hours — this list refreshes every 30s while it runs.`,
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (batchId: string) => {
    setError(null);
    try {
      await invoke("video_batch_cancel", { apiKey, batchId });
      const fresh = await invoke<BatchObject>("video_batch_get", { apiKey, batchId });
      setBatches((prev) => prev.map((b) => (b.batch_id === batchId ? fresh : b)));
    } catch (e) {
      setError(`Couldn't cancel: ${errText(e)}`);
    }
  };

  const handleResults = async (batchId: string) => {
    if (expanded === batchId) {
      setExpanded(null);
      return;
    }
    setExpanded(batchId);
    setLoadingResults(batchId);
    setError(null);
    try {
      const resp = await invoke<{ results?: unknown[] }>("video_batch_results", { apiKey, batchId });
      const list = (resp.results ?? []).map(extractVideoResult);
      list.sort((a, b) => a.customId.localeCompare(b.customId));
      setResults((prev) => ({ ...prev, [batchId]: list }));
    } catch (e) {
      setError(`Couldn't load results: ${errText(e)}`);
    } finally {
      setLoadingResults(null);
    }
  };

  const handleDownload = async (batchId: string, r: VideoBatchResult) => {
    if (!r.url) return;
    const key = `${batchId}/${r.customId}`;
    try {
      const path = await invoke<string>("download_video", {
        url: r.url,
        filename: `grok-batch-${batchId.slice(0, 8)}-${r.customId}.mp4`,
        destPath: null,
      });
      setSaved((prev) => ({ ...prev, [key]: path }));
    } catch (e) {
      setError(`Download failed (result links expire about an hour after loading — reload results): ${errText(e)}`);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Composer */}
      <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 space-y-2">
        <div className="text-xs font-semibold">
          Batch prompts{" "}
          <span className="font-normal text-muted-foreground">
            one video per line · {prompts.length}/{MAX_BATCH_PROMPTS}
          </span>
        </div>
        <Textarea
          value={promptsText}
          onChange={(e) => setPromptsText(e.target.value)}
          placeholder={"A red fox trotting through fresh snow at dawn\nNeon-lit Tokyo street in the rain, slow dolly-in\nA paper boat drifting down a stream, macro shot"}
          rows={5}
          className="min-h-[6rem] max-h-64 resize-y text-sm font-mono"
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          Every video uses the settings above: <span className="font-medium text-foreground">{modelName}</span> ·{" "}
          {durationSeconds}s · {resolution} · {aspectRatio} · audio {withAudio ? "on" : "off"}. Text-to-video only.
          Video batches are billed at normal rates (no batch discount) — about{" "}
          <span className="font-medium text-foreground">${estimate.toFixed(2)}</span> for this batch.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => void handleSubmit()} disabled={submitting || prompts.length === 0}>
            {submitting ? "Submitting…" : `Submit batch${prompts.length > 0 ? ` (${prompts.length})` : ""}`}
          </Button>
          {notice && <span className="text-xs text-green-600 dark:text-green-400">{notice}</span>}
        </div>
        {error && (
          <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-800 dark:text-red-200 whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>

      {/* Batches */}
      <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold">Your video batches</div>
          <button
            type="button"
            onClick={() => void loadBatches()}
            disabled={loadingList}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {loadingList ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
        {batches.length === 0 && !loadingList && (
          <p className="text-[11px] text-muted-foreground">No batches yet.</p>
        )}
        <div className="space-y-2">
          {batches.map((b) => {
            const sum = summarizeBatch(b);
            const prompts = promptMap[b.batch_id];
            const list = results[b.batch_id];
            return (
              <div key={b.batch_id} className="rounded-lg border border-border p-2.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate" title={b.name}>
                      {(b.name ?? b.batch_id).replace(/^grok-agent-video:\s*/, "")}
                    </div>
                    <div className="text-[10px] font-mono text-muted-foreground">{b.batch_id}</div>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ${
                      sum.phase === "running"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : sum.phase === "cancelled"
                          ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                          : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    }`}
                  >
                    {sum.phase}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-foreground/70 transition-[width]" style={{ width: `${Math.round(sum.progress * 100)}%` }} />
                </div>
                <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
                  <span>{sum.total} total</span>
                  <span className="text-green-600 dark:text-green-400">{sum.success} done</span>
                  {sum.pending > 0 && <span>{sum.pending} pending</span>}
                  {sum.failed > 0 && <span className="text-red-600 dark:text-red-400">{sum.failed} failed</span>}
                  {sum.cancelled > 0 && <span>{sum.cancelled} cancelled</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {sum.phase === "running" && (
                      <button type="button" onClick={() => void handleCancel(b.batch_id)} className="text-red-600 hover:underline">
                        Cancel
                      </button>
                    )}
                    {sum.success + sum.failed > 0 && (
                      <button type="button" onClick={() => void handleResults(b.batch_id)} className="text-foreground hover:underline">
                        {expanded === b.batch_id ? "Hide results" : "Show results"}
                      </button>
                    )}
                  </span>
                </div>

                {expanded === b.batch_id && (
                  <div className="pt-1 space-y-2">
                    {loadingResults === b.batch_id && <p className="text-[11px] text-muted-foreground">Loading results…</p>}
                    {list && list.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        Video links expire about an hour after loading — download the ones you want to keep.
                      </p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(list ?? []).map((r) => {
                        const idx = promptIndexFromCustomId(r.customId);
                        const prompt = idx !== null && prompts ? prompts[idx] : undefined;
                        const key = `${b.batch_id}/${r.customId}`;
                        return (
                          <div key={r.customId} className="rounded-md border border-border p-2 space-y-1">
                            <div className="text-[11px] leading-snug">
                              <span className="font-mono text-muted-foreground">{r.customId}</span>
                              {prompt && <span className="ml-1">{prompt}</span>}
                            </div>
                            {r.url ? (
                              <>
                                <video controls preload="metadata" src={r.url} className="w-full rounded bg-black max-h-48 object-contain" />
                                <div className="flex items-center gap-2">
                                  <Button size="sm" variant="outline" onClick={() => void handleDownload(b.batch_id, r)}>
                                    Download
                                  </Button>
                                  {saved[key] && (
                                    <button
                                      type="button"
                                      onClick={() => void shellOpen(saved[key])}
                                      className="text-[11px] text-green-600 dark:text-green-400 hover:underline truncate"
                                      title={saved[key]}
                                    >
                                      Saved — open
                                    </button>
                                  )}
                                </div>
                              </>
                            ) : (
                              <p className="text-[11px] text-red-600 dark:text-red-400">{r.error}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

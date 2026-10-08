import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { MODELS } from "@shared/constants/models";
import {
  FRAME_ROLE_OPTIONS,
  formatTimestamp,
  keyframeBounds,
  planFrames,
  suggestKeyframeTime,
  type FrameRole,
} from "../lib/frames";

interface SourceImage {
  data: string;
  mimeType: string;
  name: string;
  /** How the image is used: first/last frame, keyframe, loop, reference, or auto. */
  role: FrameRole;
  /** Seconds into the clip — keyframes only. */
  timestampS?: number;
}

/** xAI reference-to-video max images (Grok Imagine Video). */
const MAX_VIDEO_IMAGES = 7;

// ── Aspect ratio data ──────────────────────────────────────────────────────
/** All 9 ratios the video API accepts, narrowest to widest. */
const VIDEO_ASPECT_RATIOS = [
  { value: "9:16", label: "9:16", w: 12, h: 22 },
  { value: "2:3", label: "2:3", w: 14, h: 21 },
  { value: "3:4", label: "3:4", w: 15, h: 20 },
  { value: "1:1", label: "1:1", w: 17, h: 17 },
  { value: "4:3", label: "4:3", w: 20, h: 15 },
  { value: "3:2", label: "3:2", w: 21, h: 14 },
  { value: "16:9", label: "16:9", w: 24, h: 13.5 },
  { value: "21:9", label: "21:9", w: 28, h: 12 },
  { value: "5:2", label: "5:2", w: 30, h: 12 },
] as const;

const VIDEO_DURATIONS = [6, 10, 15, 20, 25, 30] as const;

/** Longest single generation the API accepts; longer clips are built by extending. */
const MAX_SINGLE_CLIP_SECONDS = 15;
/** Longest total length xAI supports for an extended video. */
const MAX_TOTAL_SECONDS = 30;

type VideoResolution = "480p" | "720p" | "1080p";

/** Always listed in the UI. 1080p requires Video 1.5 at request time. */
const VIDEO_RESOLUTIONS: { value: VideoResolution; label: string; hint: string }[] = [
  { value: "480p", label: "480p", hint: "Standard definition, faster / cheaper" },
  { value: "720p", label: "720p", hint: "HD quality" },
  { value: "1080p", label: "1080p", hint: "Full HD (uses Video 1.5). SuperGrok: depends on your plan — Heavy includes it" },
];

const VIDEO_15_MODEL = "grok-imagine-video-1.5";

type VideoModelKind = "legacy" | "v15" | "lite";

function videoModelKind(modelId: string): VideoModelKind {
  if (modelId.includes("1.5-lite")) return "lite";
  if (modelId.includes("1.5")) return "v15";
  return "legacy";
}

/** Approximate output price per second, for the cost hint next to the duration pills. */
function videoRatePerSecond(modelId: string, resolution: string): number {
  switch (videoModelKind(modelId)) {
    case "lite":
      // Lite is tiered by resolution.
      return resolution === "1080p" ? 0.14 : resolution === "720p" ? 0.03 : 0.02;
    case "v15":
      return 0.08;
    default:
      return 0.05;
  }
}

/** Comparison rows for Legacy vs Video 1.5 helper. */
const MODEL_COMPARE_ROWS: { label: string; legacy: string; v15: string; lite: string }[] = [
  { label: "API model ID", legacy: "grok-imagine-video", v15: "grok-imagine-video-1.5", lite: "grok-imagine-video-1.5-lite" },
  { label: "Role", legacy: "Original / classic Imagine video model", v15: "Current generation (successor)", lite: "Lightweight 1.5 for fast, cheap drafts" },
  { label: "Primary strength", legacy: "Flexible modes (text + image + references)", v15: "Best motion, audio, and quality", lite: "Lowest cost per second" },
  {
    label: "Text-to-video",
    legacy: "Yes (prompt only)",
    v15: "Yes — prompt only, native 1080p", lite: "Yes"
  },
  { label: "Image-to-video", legacy: "Yes (image as first frame)", v15: "Yes — main intended mode, native 1080p", lite: "Yes" },
  { label: "Reference-to-video", legacy: "Yes (up to ~7 reference images)", v15: "Yes (up to 7 refs; res capped ~720p)", lite: "Not documented" },
  {
    label: "Video edit / extend",
    legacy: "Supported on classic pipeline",
    v15: "Supported; focus is generation quality", lite: "Not documented — 30s extends may fail"
  },
  { label: "Quality", legacy: "Solid baseline", v15: "Better motion, physics, faces, audio sync", lite: "Lighter than 1.5" },
  {
    label: "Speed",
    legacy: "Slower (e.g. ~40s+ for short 720p clips)",
    v15: "Faster (e.g. ~25s for 6s 720p on Fast path)", lite: "Fastest"
  },
  { label: "Resolutions", legacy: "480p, 720p", v15: "480p, 720p, 1080p (T2V + I2V; 1080p on SuperGrok is plan-gated — Heavy includes it)", lite: "480p, 720p, 1080p" },
  { label: "Duration", legacy: "About 1–15s (API range)", v15: "About 1–15s", lite: "About 1–15s" },
  { label: "Audio", legacy: "Native video-audio model", v15: "Improved native audio; voice refs (API)", lite: "Native audio" },
  { label: "Pricing (approx.)", legacy: "~$0.05 / sec", v15: "~$0.08 / sec (higher at 1080p)", lite: "$0.02 / sec 480p · $0.03 720p · $0.14 1080p" },
  {
    label: "Best when",
    legacy: "Cheaper experiments, classic pipeline",
    v15: "Best quality, text-to-video, 1080p, references", lite: "Drafts and high-volume runs (Batch API, 10 req/s)"
  },
  {
    label: "In this app",
    legacy: "Optional lower-cost path",
    v15: "Recommended default", lite: "Draft mode"
  },
];

function VideoModelCompareHelper({
  open,
  onToggle,
  selected,
}: {
  open: boolean;
  onToggle: () => void;
  /** Column to highlight — the currently selected model. */
  selected: VideoModelKind;
}) {
  const highlightV15 = selected === "v15";
  const highlightLite = selected === "lite";
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground shrink-0">
            ?
          </span>
          <span className="text-xs font-semibold theme-text truncate">
            Legacy vs 1.5 vs 1.5 Lite — which model should I pick?
          </span>
        </span>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {open ? "Hide ▲" : "Show ▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">Rule of thumb:</span>{" "}
            use <span className="font-medium">1.5</span> for text-to-video, image-to-video, and{" "}
            <span className="font-medium">1080p</span>
            {" · "}
            <span className="font-medium">1.5 Lite</span> for fast, cheap drafts (from $0.02/sec)
          </p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[11px] border-collapse min-w-[44rem]">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left font-semibold px-2.5 py-1.5 w-[7.5rem] text-muted-foreground">
                    Feature
                  </th>
                  <th
                    className={`text-left font-semibold px-2.5 py-1.5 text-foreground ${
                      selected === "legacy"
                        ? "bg-sky-500/20 ring-1 ring-inset ring-sky-500/40"
                        : ""
                    }`}
                  >
                    Legacy
                    <div className="font-mono font-normal text-[10px] text-muted-foreground mt-0.5">
                      grok-imagine-video
                    </div>
                  </th>
                  <th
                    className={`text-left font-semibold px-2.5 py-1.5 text-foreground ${
                      highlightV15
                        ? "bg-violet-500/20 ring-1 ring-inset ring-violet-500/40"
                        : ""
                    }`}
                  >
                    Video 1.5
                    <div className="font-mono font-normal text-[10px] text-muted-foreground mt-0.5">
                      grok-imagine-video-1.5
                    </div>
                  </th>
                  <th
                    className={`text-left font-semibold px-2.5 py-1.5 text-foreground ${
                      highlightLite
                        ? "bg-teal-500/20 ring-1 ring-inset ring-teal-500/40"
                        : ""
                    }`}
                  >
                    Video 1.5 Lite
                    <div className="font-mono font-normal text-[10px] text-muted-foreground mt-0.5">
                      grok-imagine-video-1.5-lite
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {MODEL_COMPARE_ROWS.map((row) => (
                  <tr key={row.label} className="align-top">
                    <td className="px-2.5 py-1.5 font-medium text-muted-foreground whitespace-nowrap">
                      {row.label}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 leading-snug text-foreground ${
                        selected === "legacy" ? "bg-sky-500/10" : ""
                      }`}
                    >
                      {row.legacy}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 leading-snug text-foreground ${
                        highlightV15 ? "bg-violet-500/10" : ""
                      }`}
                    >
                      {row.v15}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 leading-snug text-foreground ${
                        highlightLite ? "bg-teal-500/10" : ""
                      }`}
                    >
                      {row.lite}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

interface GrokVideoPanelProps {
  apiKey: string;
  modelId?: string;
  modelDisplayName?: string;
  /** True when Settings auth is SuperGrok / SuperGrok Heavy OAuth (1080p is plan-gated). */
  isSuperGrok?: boolean;
}

export function GrokVideoPanel({
  apiKey,
  modelId = VIDEO_15_MODEL,
  modelDisplayName: _modelDisplayName = "Grok Imagine Video 1.5",
  isSuperGrok = false,
}: GrokVideoPanelProps) {
  const modelConfig = Object.values(MODELS).find(m => m.modelId === modelId);
  /** Video 1.5: text-to-video, image-to-video, native 1080p. */
  const isVideo15 = modelId.includes("1.5");
  const [prompt, setPrompt] = useState("");
  /** 0 = text-to-video; 1 = image-to-video; 2–7 = reference-to-video. */
  const [sourceImages, setSourceImages] = useState<SourceImage[]>([]);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [duration, setDuration] = useState<number>(15);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  /** Native soundtrack: Grok Imagine is a video-audio model; default on. */
  const [withAudio, setWithAudio] = useState(true);
  /**
   * 1080p trial: always try 1080p first so plans that include it get it; if xAI rejects
   * it as not included in the plan (SuperGrok non-Heavy), retry at 720p instead of failing.
   */
  const [fallback720, setFallback720] = useState(true);
  /** Set when the last result was served at a different resolution than requested. */
  const [servedNote, setServedNote] = useState<string | null>(null);
  /** Seconds actually delivered — may be short of the target if an extension failed. */
  const [finalSeconds, setFinalSeconds] = useState<number | null>(null);
  /** Prompt enhancement: rewrites the idea into a detailed video prompt via a Grok chat model. */
  const [isEnhancing, setIsEnhancing] = useState(false);
  /** The user's prompt before the last enhancement, so it can be restored. */
  const [originalPrompt, setOriginalPrompt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  /** Path shown after a successful download (next to the Download button). */
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [showModelHelp, setShowModelHelp] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  const imageCount = sourceImages.length;
  /** Seconds a frame-pinned clip can span — pins live inside one generation. */
  const pinClipSeconds = Math.min(duration, MAX_SINGLE_CLIP_SECONDS);
  const framePlan = planFrames(sourceImages, Math.min(duration, MAX_TOTAL_SECONDS), MAX_SINGLE_CLIP_SECONDS);
  const isReferenceMode = framePlan.references.length > 0;
  /** Pins (and a first frame + references) only work on full Video 1.5. */
  const switchesToVideo15 = framePlan.requiresVideo15 && videoModelKind(modelId) !== "v15";
  const canAddMoreImages = imageCount < MAX_VIDEO_IMAGES;
  /** Reference-to-video is capped at 720p by the API. */
  const effectiveResolution: VideoResolution =
    isReferenceMode && resolution === "1080p" ? "720p" : resolution;

  const readFileAsSourceImage = (file: File): Promise<SourceImage> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const [header, base64] = result.split(",");
        const mimeType = header.match(/data:(.*?);/)?.[1] ?? file.type ?? "image/png";
        resolve({ data: base64, mimeType, name: file.name, role: "auto" });
      };
      reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });

  const handleImageUpload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const room = MAX_VIDEO_IMAGES - sourceImages.length;
    if (room <= 0) {
      setError(`Maximum ${MAX_VIDEO_IMAGES} images allowed for Grok video.`);
      return;
    }
    const toAdd = list.slice(0, room);
    try {
      const loaded = await Promise.all(toAdd.map(readFileAsSourceImage));
      setSourceImages((prev) => [...prev, ...loaded].slice(0, MAX_VIDEO_IMAGES));
      setError(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const removeImageAt = (index: number) => {
    setSourceImages((prev) => prev.filter((_, i) => i !== index));
  };

  const setImageRole = (index: number, role: FrameRole) => {
    setSourceImages((prev) =>
      prev.map((img, i) => {
        if (i !== index) return img;
        if (role !== "keyframe") return { ...img, role };
        const taken = prev
          .filter((other, j) => j !== index && other.role === "keyframe" && other.timestampS != null)
          .map((other) => other.timestampS as number);
        return { ...img, role, timestampS: img.timestampS ?? suggestKeyframeTime(pinClipSeconds, taken) };
      }),
    );
  };

  const setImageTimestamp = (index: number, timestampS: number) => {
    setSourceImages((prev) => prev.map((img, i) => (i === index ? { ...img, timestampS } : img)));
  };

  /** Plain-language description of the frame plan, for progress text and the prompt enhancer. */
  const describeFramePlan = (): string => {
    const parts: string[] = [];
    if (framePlan.first && framePlan.first === framePlan.last) parts.push("loop (same image starts and ends the video)");
    else {
      if (framePlan.first) parts.push("pinned first frame");
      if (framePlan.last) parts.push("pinned last frame");
    }
    if (framePlan.keyframes.length > 0) {
      parts.push(`keyframes at ${framePlan.keyframes.map((k) => formatTimestamp(k.timestampS)).join(", ")}`);
    }
    if (framePlan.references.length > 0) {
      parts.push(`${framePlan.references.length} reference image${framePlan.references.length > 1 ? "s" : ""}`);
    }
    return parts.join(" + ");
  };

  // Text-to-video needs only a prompt. Auth is re-resolved on the backend from
  // Settings (SuperGrok OAuth or API key), so an empty frontend token is OK.
  // With a last frame or keyframes pinned, the prompt is optional (xAI docs).
  const canGenerate =
    (prompt.trim().length > 0 || framePlan.usesPins) && framePlan.errors.length === 0;

  const formatInvokeError = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const obj = e as Record<string, unknown>;
      if (typeof obj.message === "string") return obj.message;
      try {
        return JSON.stringify(e);
      } catch {
        return String(e);
      }
    }
    return String(e);
  };

  const handleEnhance = async () => {
    const idea = prompt.trim();
    if (!idea || isEnhancing) return;
    setIsEnhancing(true);
    setError(null);
    try {
      const enhanced = await invoke<string>("enhance_video_prompt", {
        prompt: idea,
        apiKey,
        durationSeconds: duration,
        aspectRatio,
        resolution: effectiveResolution,
        withAudio,
        images: sourceImages.length > 0
          ? sourceImages.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : null,
        modeHint: framePlan.usesPins || framePlan.requiresVideo15
          ? `frame-pinned video: ${describeFramePlan()} (images are attached in upload order)`
          : null,
      });
      // Keep the very first original across repeated enhancements.
      setOriginalPrompt((prev) => prev ?? prompt);
      setPrompt(enhanced);
    } catch (e: unknown) {
      setError(formatInvokeError(e));
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setVideoUrl(null);
    setDownloadStatus(null);
    setServedNote(null);
    setFinalSeconds(null);

    // 1080p is only on Video 1.5 (T2V + I2V) — upgrade model when needed.
    // Multi-ref clamps to 720p below.
    const res = effectiveResolution;
    const effectiveModelId =
      switchesToVideo15 || (res === "1080p" && !isVideo15) ? VIDEO_15_MODEL : modelId;
    // One call maxes out at 15s; anything longer starts here and is extended,
    // up to the 30s total that xAI supports for an extended video.
    const targetDuration = Math.min(duration, MAX_TOTAL_SECONDS);
    const baseDuration = Math.min(targetDuration, MAX_SINGLE_CLIP_SECONDS);

    const modeLabel =
      imageCount === 0
        ? "text-to-video"
        : framePlan.usesPins || framePlan.requiresVideo15
          ? describeFramePlan()
          : framePlan.first
            ? "image-to-video"
            : `reference-to-video (${framePlan.references.length} refs)`;
    setProgress(
      targetDuration > MAX_SINGLE_CLIP_SECONDS
        ? `Submitting ${modeLabel} (${res}) — ${baseDuration}s base, extending to ${targetDuration}s…`
        : `Submitting ${modeLabel} (${res})…`,
    );

    // Listen for progress events from the Rust polling loop
    unlistenRef.current?.();
    const unlisten = await listen<{ message: string; elapsed: number; poll?: number; status?: string }>(
      "video-progress",
      (event) => setProgress(event.payload.message)
    );
    unlistenRef.current = unlisten;

    try {
      // Images go where their role says: first frame (`image`), `last_frame`,
      // timed `keyframes`, or `reference_images`. Auto keeps the old behaviour
      // (one image = first frame, several = references).
      // Backend re-resolves SuperGrok OAuth from Settings at request time.
      const payload: Record<string, unknown> = {
        prompt,
        apiKey,
        modelId: effectiveModelId,
        durationSeconds: baseDuration,
        aspectRatio,
        resolution: res,
        withAudio,
        // Only meaningful for 1080p: retry at 720p when the plan doesn't include 1080p.
        fallback720p: res === "1080p" ? fallback720 : false,
      };
      payload.image = framePlan.first?.data ?? null;
      payload.imageMimeType = framePlan.first?.mimeType ?? null;
      payload.referenceImages =
        framePlan.references.length > 0
          ? framePlan.references.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : null;
      payload.lastFrame = framePlan.last?.data ?? null;
      payload.lastFrameMimeType = framePlan.last?.mimeType ?? null;
      payload.keyframes =
        framePlan.keyframes.length > 0
          ? framePlan.keyframes.map((k) => ({
              data: k.image.data,
              mimeType: k.image.mimeType,
              timestampS: k.timestampS,
            }))
          : null;

      const result = await invoke<{
        url: string;
        videoId?: string;
        resolutionServed?: string;
        fallbackNote?: string | null;
      }>("generate_video", payload);

      let url = result.url;
      let videoId = result.videoId;
      let seconds = baseDuration;
      const notes: string[] = [];
      if (result.fallbackNote) notes.push(result.fallbackNote);

      // Beyond 15s the API needs chained extensions, each continuing from the
      // last frame. Show the finished base clip if an extension later fails.
      while (seconds < targetDuration) {
        if (!videoId) {
          notes.push(
            `The API did not return a video id, so this clip could not be extended past ${seconds}s.`,
          );
          break;
        }
        const add = Math.min(targetDuration - seconds, MAX_SINGLE_CLIP_SECONDS);
        const target = seconds + add;
        setProgress(`Extending ${seconds}s → ${target}s of ${targetDuration}s…`);
        try {
          const ext = await invoke<{ url: string; videoId?: string }>("extend_video", {
            videoId,
            apiKey,
            modelId: effectiveModelId,
            durationSeconds: add,
            // The extension prompt describes what happens next, so keep the
            // original scene but tell the model to carry the shot on.
            prompt: `Continue this exact shot without cutting or restarting. ${prompt}`,
          });
          url = ext.url;
          videoId = ext.videoId;
          seconds = target;
        } catch (e: unknown) {
          notes.push(
            `Stopped at ${seconds}s — the extension to ${target}s failed: ${formatInvokeError(e)}`,
          );
          break;
        }
      }

      setVideoUrl(url);
      setFinalSeconds(seconds);
      if (notes.length > 0) setServedNote(notes.join("\n\n"));
      setProgress(
        seconds < targetDuration
          ? `⚠️ Video ready — ${seconds}s of ${targetDuration}s`
          : `✅ Video ready${seconds > MAX_SINGLE_CLIP_SECONDS ? ` — ${seconds}s continuous` : ""}!`,
      );
    } catch (e: unknown) {
      setError(formatInvokeError(e));
      setProgress("");
    } finally {
      setIsLoading(false);
      unlisten();
      unlistenRef.current = null;
    }
  };

  const handleDownload = async () => {
    if (!videoUrl || isDownloading) return;
    setDownloadStatus(null);
    setError(null);

    const filename = `grok-video-${Date.now()}.mp4`;
    let destPath: string | undefined;
    let dialogCancelled = false;

    try {
      const picked = await saveDialog({
        defaultPath: filename,
        filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
        title: "Save video",
      });
      if (picked === null) {
        // User cancelled the save dialog — abort.
        dialogCancelled = true;
      } else {
        destPath = picked;
      }
    } catch {
      // Dialog plugin failed — fall back to ~/Downloads via Rust.
      destPath = undefined;
    }

    if (dialogCancelled) return;

    setIsDownloading(true);
    try {
      const savedPath = await invoke<string>("download_video", {
        url: videoUrl,
        filename,
        destPath: destPath ?? null,
      });
      setDownloadStatus(savedPath);
      setProgress(`✅ Saved to ${savedPath}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to download video: ${msg}`);
      setDownloadStatus(null);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRevealDownload = async () => {
    if (!downloadStatus) return;
    try {
      await shellOpen(downloadStatus);
    } catch {
      // Best-effort: open containing folder if opening the file fails.
      const parent = downloadStatus.replace(/[/\\][^/\\]+$/, "");
      if (parent && parent !== downloadStatus) {
        try {
          await shellOpen(parent);
        } catch {
          /* ignore */
        }
      }
    }
  };

  const pillBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
      active
        ? "bg-foreground text-background font-bold"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Form + helper; scroll only if content exceeds viewport (e.g. help open) */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 pt-2.5 pb-2.5 space-y-2.5 max-w-3xl mx-auto w-full">
        {/* One-line context (model selected in toolbar) */}
        <div className="flex items-start justify-between gap-2">
          <div className="text-[11px] text-muted-foreground leading-snug min-w-0">
            {imageCount === 0
              ? "Text-to-video ready — type a prompt (images optional · up to 7)"
              : framePlan.usesPins || framePlan.requiresVideo15
                ? `Frame-pinned video · ${describeFramePlan()}`
                : framePlan.first
                  ? "Image-to-video · animate your uploaded still as the first frame"
                  : `Reference-to-video · ${framePlan.references.length}/${MAX_VIDEO_IMAGES} refs (identity/style locks · max 720p)`}
            {modelConfig?.description ? ` · ${modelConfig.description}` : ""}
          </div>
        </div>

        <VideoModelCompareHelper
          open={showModelHelp}
          onToggle={() => setShowModelHelp((v) => !v)}
          selected={videoModelKind(modelId)}
        />

        {/* Settings card — single dense block */}
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 space-y-2.5">
          {/* Aspect ratio — compact row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold shrink-0 w-14">Aspect</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {VIDEO_ASPECT_RATIOS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setAspectRatio(r.value)}
                  title={r.label}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg transition-colors ${
                    aspectRatio === r.value
                      ? "bg-muted ring-1 ring-foreground"
                      : "hover:bg-muted/60"
                  }`}
                >
                  <div className="w-8 h-8 flex items-center justify-center">
                    <div
                      style={{ width: r.w, height: r.h }}
                      className={`rounded-sm transition-colors ${
                        aspectRatio === r.value
                          ? "bg-foreground"
                          : "bg-muted-foreground/35"
                      }`}
                    />
                  </div>
                  <span
                    className={`text-[10px] font-mono leading-none ${
                      aspectRatio === r.value
                        ? "text-foreground font-bold"
                        : "text-muted-foreground"
                    }`}
                  >
                    {r.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {framePlan.first && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              With a first-frame image the video keeps that image's shape — the aspect ratio
              above is ignored by the API.
            </p>
          )}

          {/* Duration + Resolution + Audio on one row */}
          <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold w-14 shrink-0">Duration</span>
              <div className="flex items-center gap-0.5 bg-muted rounded-full p-0.5">
                {VIDEO_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    disabled={framePlan.usesPins && d > MAX_SINGLE_CLIP_SECONDS}
                    title={
                      framePlan.usesPins && d > MAX_SINGLE_CLIP_SECONDS
                        ? "Last frame and keyframes pin a single clip (15s max)"
                        : undefined
                    }
                    className={`${pillBtn(duration === d)} disabled:opacity-35 disabled:cursor-not-allowed`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
              {duration > MAX_SINGLE_CLIP_SECONDS && (
                <span className="text-[11px] text-muted-foreground">
                  {Math.ceil(duration / MAX_SINGLE_CLIP_SECONDS)} segments · continuous · ~$
                  {(duration * videoRatePerSecond(modelId, effectiveResolution)).toFixed(2)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold shrink-0">Res</span>
              <div className="flex items-center gap-0.5 bg-muted rounded-full p-0.5">
                {VIDEO_RESOLUTIONS.map((r) => {
                  const disabled1080 = r.value === "1080p" && isReferenceMode;
                  // Show effective selection: multi-ref clamps 1080p → 720p
                  const isActive = disabled1080
                    ? false
                    : effectiveResolution === r.value;
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => {
                        if (disabled1080) return;
                        setResolution(r.value);
                      }}
                      disabled={disabled1080}
                      title={
                        disabled1080
                          ? "1080p not available for reference-to-video (max 720p)"
                          : r.hint
                      }
                      className={`${pillBtn(isActive)} ${
                        disabled1080 ? "opacity-40 cursor-not-allowed" : ""
                      }`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
              {isReferenceMode && resolution === "1080p" && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">
                  → 720p (refs)
                </span>
              )}
            </div>

            {/* 1080p on SuperGrok is plan-gated (Heavy includes it). Offer a 720p safety net. */}
            {resolution === "1080p" && !isReferenceMode && (
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                {isSuperGrok ? (
                  <span>
                    <span className="font-medium text-foreground">SuperGrok:</span> 1080p depends on your plan —
                    SuperGrok Heavy includes it. We try 1080p first.
                  </span>
                ) : (
                  <span>1080p is tried first; API-key billing includes it.</span>
                )}
                <label className="inline-flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fallback720}
                    onChange={(e) => setFallback720(e.target.checked)}
                    className="h-3 w-3 accent-current"
                  />
                  <span>Fall back to 720p if 1080p isn't included</span>
                </label>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold shrink-0">Audio</span>
              <div className="flex items-center gap-0.5 bg-muted rounded-full p-0.5">
                <button
                  type="button"
                  onClick={() => setWithAudio(true)}
                  title="Generate with native audio"
                  className={pillBtn(withAudio)}
                >
                  On
                </button>
                <button
                  type="button"
                  onClick={() => setWithAudio(false)}
                  title="Silent video"
                  className={pillBtn(!withAudio)}
                >
                  Off
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Source / reference images — optional, up to 7 */}
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold">
                Images (optional){" "}
                <span className="font-normal text-muted-foreground">
                  {imageCount}/{MAX_VIDEO_IMAGES}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                {imageCount === 0
                  ? "Skip for text-only. Give each image a role: first frame, keyframe at a moment, last frame, loop, or reference."
                  : "Pick a role under each image. Auto: one image = first frame, several = references (<IMAGE_1>… tags, max 720p)."}
              </p>
            </div>
            {canAddMoreImages && (
              <label className="shrink-0 flex items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {imageCount === 0 ? "Upload images" : "Add more"}
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void handleImageUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {imageCount > 0 && (
            <div className="flex flex-wrap gap-2">
              {sourceImages.map((img, index) => (
                <div
                  key={`${img.name}-${index}`}
                  className="relative group flex flex-col items-center gap-1 w-28"
                >
                  <div className="relative">
                    <img
                      src={`data:${img.mimeType};base64,${img.data}`}
                      alt={img.name}
                      className="h-14 w-14 rounded-md border object-cover"
                    />
                    <span className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[9px] text-center font-mono leading-tight py-px rounded-b-md">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeImageAt(index)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[11px] leading-none opacity-90 hover:opacity-100 shadow"
                      title="Remove"
                      aria-label={`Remove image ${index + 1}`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground max-w-full truncate">
                    {img.name}
                  </div>
                  <select
                    value={img.role}
                    onChange={(e) => setImageRole(index, e.target.value as FrameRole)}
                    title={FRAME_ROLE_OPTIONS.find((o) => o.value === img.role)?.hint}
                    aria-label={`Role for image ${index + 1}`}
                    className="w-full text-[11px] rounded-md border border-border bg-background px-1 py-0.5"
                  >
                    {FRAME_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value} title={o.hint}>
                        {o.value === "auto"
                          ? `Auto (${framePlan.resolvedRoles[index] === "first" ? "first frame" : "reference"})`
                          : o.label}
                      </option>
                    ))}
                  </select>
                  {img.role === "keyframe" && (() => {
                    const { min, max } = keyframeBounds(pinClipSeconds);
                    const t = img.timestampS ?? min;
                    return (
                      <div className="w-full">
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={1 / 3}
                          value={Math.min(Math.max(t, min), max)}
                          onChange={(e) => setImageTimestamp(index, Number(e.target.value))}
                          aria-label={`Keyframe time for image ${index + 1}`}
                          className="w-full accent-current"
                        />
                        <div className="text-[10px] text-center font-mono text-muted-foreground">
                          at {formatTimestamp(t)} of {pinClipSeconds}s
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
              {canAddMoreImages && (
                <label className="h-14 w-14 rounded-md border border-dashed border-border flex items-center justify-center cursor-pointer hover:bg-muted/40 text-muted-foreground text-lg leading-none">
                  +
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) void handleImageUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              {imageCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSourceImages([])}
                  className="self-center text-[11px] text-red-500 hover:underline px-1"
                >
                  Clear all
                </button>
              )}
            </div>
          )}

          {/* Timeline of pinned frames: first → keyframes → last */}
          {(framePlan.first || framePlan.last || framePlan.keyframes.length > 0) && framePlan.usesPins && (
            <div className="space-y-1">
              <div className="relative h-9 rounded-md bg-muted/60 border border-border">
                {[
                  ...(framePlan.first ? [{ img: framePlan.first, t: 0, label: "start" }] : []),
                  ...framePlan.keyframes.map((k) => ({ img: k.image, t: k.timestampS, label: formatTimestamp(k.timestampS) })),
                  ...(framePlan.last ? [{ img: framePlan.last, t: pinClipSeconds, label: "end" }] : []),
                ].map((pin, i) => (
                  <div
                    key={i}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
                    style={{ left: `${Math.min(97, Math.max(3, (pin.t / pinClipSeconds) * 100))}%` }}
                    title={`${pin.img.name} · ${pin.label}`}
                  >
                    <img
                      src={`data:${pin.img.mimeType};base64,${pin.img.data}`}
                      alt=""
                      className="h-7 w-7 rounded border-2 border-background object-cover shadow"
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] font-mono text-muted-foreground">
                <span>0s</span>
                <span>{pinClipSeconds}s</span>
              </div>
            </div>
          )}

          {switchesToVideo15 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Frame pinning runs on Grok Imagine Video 1.5 — this video will use it instead of {modelConfig?.displayName ?? modelId}.
            </p>
          )}
          {framePlan.errors.length > 0 && (
            <ul className="text-[11px] text-red-600 dark:text-red-400 space-y-0.5 list-disc pl-4">
              {framePlan.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Prompt + generate */}
        <div className="space-y-2">
          <Textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (!e.target.value.trim()) setOriginalPrompt(null);
            }}
            disabled={isEnhancing}
            placeholder={
              framePlan.usesPins
                ? "Optional — describe the motion between your pinned frames…"
                : isReferenceMode
                  ? "Describe the shot… reference images as <IMAGE_1>, <IMAGE_2>, …"
                  : "Describe the video you want to generate… (images optional)"
            }
            rows={3}
            className="min-h-[4.5rem] max-h-40 resize-y text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canGenerate && !isLoading) {
                e.preventDefault();
                void handleGenerate();
              }
            }}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={isLoading || !canGenerate}
              title={
                framePlan.errors.length > 0
                  ? "Fix the image roles above to generate"
                  : !prompt.trim() && !framePlan.usesPins
                  ? "Enter a prompt to generate"
                  : "Generate video (uses SuperGrok or API key from Settings)"
              }
            >
              {isLoading ? "Generating…" : "Generate Video"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleEnhance()}
              disabled={isEnhancing || isLoading || !prompt.trim()}
              title="Rewrite your idea into a detailed video prompt — camera, lighting, motion and sound — tuned to the duration, aspect ratio and attached images"
            >
              {isEnhancing ? "Enhancing…" : originalPrompt !== null ? "✨ Enhance again" : "✨ Enhance prompt"}
            </Button>
            {originalPrompt !== null && !isEnhancing && (
              <button
                type="button"
                onClick={() => { setPrompt(originalPrompt); setOriginalPrompt(null); }}
                className="text-xs text-muted-foreground hover:underline"
                title={originalPrompt}
              >
                Undo (restore original)
              </button>
            )}
            {!apiKey && (
              <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                Uses Settings auth (SuperGrok or API key)
              </span>
            )}
            {prompt.trim().length === 0 && !framePlan.usesPins && (
              <span className="text-xs text-muted-foreground">
                Enter a prompt to enable Generate
              </span>
            )}
            {progress && !error && (
              <span className="text-sm text-blue-600 dark:text-blue-400 truncate min-w-0">{progress}</span>
            )}
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-xl border-2 border-red-400/80 dark:border-red-600/80 bg-red-50 dark:bg-red-950/50 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-sm font-bold"
                    aria-hidden
                  >
                    !
                  </span>
                  <h3 className="text-base font-semibold text-red-900 dark:text-red-100">
                    Video generation failed
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="shrink-0 text-sm font-medium text-red-800 dark:text-red-200 hover:underline px-1"
                >
                  Dismiss
                </button>
              </div>
              <div className="text-sm sm:text-[15px] leading-relaxed text-red-950 dark:text-red-50 whitespace-pre-wrap break-words max-h-64 overflow-y-auto font-medium">
                {error}
              </div>
            </div>
          )}
        </div>

      {/* Result — stays in the scroll area with the form */}
      {videoUrl && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          {servedNote && (
            <div className="rounded-lg border border-amber-300/70 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              {servedNote}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-green-600 font-medium">
              Video ready{finalSeconds != null ? ` · ${finalSeconds}s` : ""}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              {downloadStatus && (
                <button
                  type="button"
                  onClick={() => void handleRevealDownload()}
                  className="text-[11px] text-green-600 dark:text-green-400 hover:underline truncate max-w-[14rem]"
                  title={downloadStatus}
                >
                  Saved — open file
                </button>
              )}
              <Button
                size="sm"
                onClick={() => void handleDownload()}
                variant="outline"
                disabled={isDownloading}
              >
                {isDownloading ? "Saving…" : "Download"}
              </Button>
            </div>
          </div>
          <video
            controls
            src={videoUrl}
            className="w-full max-h-[min(42vh,360px)] rounded-lg border object-contain bg-black"
          />
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

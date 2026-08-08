import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { MODELS } from "@shared/constants/models";

interface SourceImage {
  data: string;
  mimeType: string;
  name: string;
}

/** xAI reference-to-video max images (Grok Imagine Video). */
const MAX_VIDEO_IMAGES = 7;

// ── Aspect ratio data ──────────────────────────────────────────────────────
const VIDEO_ASPECT_RATIOS = [
  { value: "2:3", label: "2:3", w: 14, h: 20 },
  { value: "3:2", label: "3:2", w: 20, h: 14 },
  { value: "1:1", label: "1:1", w: 16, h: 16 },
  { value: "9:16", label: "9:16", w: 14, h: 20 },
  { value: "16:9", label: "16:9", w: 22, h: 12 },
] as const;

const VIDEO_DURATIONS = [6, 10, 15] as const;

type VideoResolution = "480p" | "720p" | "1080p";

/** Always listed in the UI. 1080p requires Video 1.5 at request time. */
const VIDEO_RESOLUTIONS: { value: VideoResolution; label: string; hint: string }[] = [
  { value: "480p", label: "480p", hint: "Standard definition, faster / cheaper" },
  { value: "720p", label: "720p", hint: "HD quality" },
  { value: "1080p", label: "1080p", hint: "Full HD (uses Video 1.5)" },
];

const VIDEO_15_MODEL = "grok-imagine-video-1.5";

/** Comparison rows for Legacy vs Video 1.5 helper. */
const MODEL_COMPARE_ROWS: { label: string; legacy: string; v15: string }[] = [
  { label: "API model ID", legacy: "grok-imagine-video", v15: "grok-imagine-video-1.5" },
  { label: "Role", legacy: "Original / classic Imagine video model", v15: "Current generation (successor)" },
  { label: "Primary strength", legacy: "Flexible modes (text + image + references)", v15: "Best motion, audio, and quality" },
  {
    label: "Text-to-video",
    legacy: "Yes (prompt only)",
    v15: "Yes — prompt only, native 1080p",
  },
  { label: "Image-to-video", legacy: "Yes (image as first frame)", v15: "Yes — main intended mode, native 1080p" },
  { label: "Reference-to-video", legacy: "Yes (up to ~7 reference images)", v15: "Yes (up to 7 refs; res capped ~720p)" },
  {
    label: "Video edit / extend",
    legacy: "Supported on classic pipeline",
    v15: "Supported; focus is generation quality",
  },
  { label: "Quality", legacy: "Solid baseline", v15: "Better motion, physics, faces, audio sync" },
  {
    label: "Speed",
    legacy: "Slower (e.g. ~40s+ for short 720p clips)",
    v15: "Faster (e.g. ~25s for 6s 720p on Fast path)",
  },
  { label: "Resolutions", legacy: "480p, 720p", v15: "480p, 720p, 1080p (T2V + I2V)" },
  { label: "Duration", legacy: "About 1–15s (API range)", v15: "About 1–15s" },
  { label: "Audio", legacy: "Native video-audio model", v15: "Improved native audio; voice refs (API)" },
  { label: "Pricing (approx.)", legacy: "~$0.05 / sec", v15: "~$0.08 / sec (higher at 1080p)" },
  {
    label: "Best when",
    legacy: "Cheaper experiments, classic pipeline",
    v15: "Best quality, text-to-video, 1080p, references",
  },
  {
    label: "In this app",
    legacy: "Optional lower-cost path",
    v15: "Recommended default",
  },
];

function VideoModelCompareHelper({
  open,
  onToggle,
  highlightV15,
}: {
  open: boolean;
  onToggle: () => void;
  /** When true, highlight the 1.5 column (current selection is 1.5). */
  highlightV15: boolean;
}) {
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
            Legacy vs 1.5 — which model should I pick?
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
            <span className="font-medium">Legacy</span> for cheaper lower-res experiments
          </p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[11px] border-collapse min-w-[32rem]">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left font-semibold px-2.5 py-1.5 w-[7.5rem] text-muted-foreground">
                    Feature
                  </th>
                  <th
                    className={`text-left font-semibold px-2.5 py-1.5 text-foreground ${
                      !highlightV15
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
                        !highlightV15 ? "bg-sky-500/10" : ""
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
}

export function GrokVideoPanel({
  apiKey,
  modelId = VIDEO_15_MODEL,
  modelDisplayName: _modelDisplayName = "Grok Imagine Video 1.5",
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
  const isReferenceMode = imageCount >= 2;
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
        resolve({ data: base64, mimeType, name: file.name });
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

  // Text-to-video needs only a prompt. Images are always optional in the UI.
  const canGenerate = prompt.trim().length > 0 && !!apiKey;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setVideoUrl(null);
    setDownloadStatus(null);

    // 1080p is only on Video 1.5 (T2V + I2V) — upgrade model when needed.
    // Multi-ref clamps to 720p below.
    const res = effectiveResolution;
    const effectiveModelId =
      res === "1080p" && !isVideo15 ? VIDEO_15_MODEL : modelId;

    const modeLabel =
      imageCount === 0
        ? "text-to-video"
        : imageCount === 1
          ? "image-to-video"
          : `reference-to-video (${imageCount} refs)`;
    setProgress(`Submitting ${modeLabel} (${res})…`);

    // Listen for progress events from the Rust polling loop
    unlistenRef.current?.();
    const unlisten = await listen<{ message: string; elapsed: number; poll?: number; status?: string }>(
      "video-progress",
      (event) => setProgress(event.payload.message)
    );
    unlistenRef.current = unlisten;

    try {
      // 1 image → image-to-video (start frame); 2–7 → reference_images (cannot mix).
      const payload: Record<string, unknown> = {
        prompt,
        apiKey,
        modelId: effectiveModelId,
        durationSeconds: duration,
        aspectRatio,
        resolution: res,
        withAudio,
      };
      if (imageCount === 1) {
        payload.image = sourceImages[0].data;
        payload.imageMimeType = sourceImages[0].mimeType;
        payload.referenceImages = null;
      } else if (imageCount >= 2) {
        payload.image = null;
        payload.imageMimeType = null;
        payload.referenceImages = sourceImages.map((img) => ({
          data: img.data,
          mimeType: img.mimeType,
        }));
      } else {
        payload.image = null;
        payload.imageMimeType = null;
        payload.referenceImages = null;
      }

      const result = await invoke<{ url: string; videoId?: string }>("generate_video", payload);
      setVideoUrl(result.url);
      setProgress("✅ Video ready!");
    } catch (e: unknown) {
      setError(String(e));
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
              : imageCount === 1
                ? "Image-to-video · animate your uploaded still as the first frame"
                : `Reference-to-video · ${imageCount}/${MAX_VIDEO_IMAGES} refs (identity/style locks · max 720p)`}
            {modelConfig?.description ? ` · ${modelConfig.description}` : ""}
          </div>
        </div>

        <VideoModelCompareHelper
          open={showModelHelp}
          onToggle={() => setShowModelHelp((v) => !v)}
          highlightV15={isVideo15}
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
                    className={pillBtn(duration === d)}
                  >
                    {d}s
                  </button>
                ))}
              </div>
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
                  ? "Skip for text-only. 1 image = animate as first frame. 2–7 = reference-to-video (character, product, scene…)."
                  : imageCount === 1
                    ? "1 image → image-to-video (start frame). Add more for multi-reference (up to 7)."
                    : "Multi-reference mode: lock subjects/styles in the prompt with <IMAGE_1>… tags. Max 720p."}
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
                  className="relative group flex flex-col items-center gap-0.5"
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
                  <div className="text-[10px] font-mono text-muted-foreground max-w-[3.5rem] truncate">
                    {img.name}
                  </div>
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
        </div>

        {/* Prompt + generate */}
        <div className="space-y-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              isReferenceMode
                ? "Describe the shot… reference images as <IMAGE_1>, <IMAGE_2>, …"
                : "Describe the video you want to generate… (images optional)"
            }
            rows={3}
            className="min-h-[4.5rem] max-h-28 resize-none text-sm"
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
                !apiKey
                  ? "Add an xAI API key in Settings"
                  : !prompt.trim()
                    ? "Enter a prompt to generate"
                    : "Generate video from text"
              }
            >
              {isLoading ? "Generating…" : "Generate Video"}
            </Button>
            {!apiKey && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠️ xAI API key required
              </span>
            )}
            {prompt.trim().length === 0 && apiKey && (
              <span className="text-[11px] text-muted-foreground">
                Enter a prompt to enable Generate
              </span>
            )}
            {progress && !error && (
              <span className="text-xs text-blue-500 truncate min-w-0">{progress}</span>
            )}
          </div>
          {error && (
            <div className="text-red-500 text-xs bg-red-50 dark:bg-red-900/20 p-2.5 rounded max-h-20 overflow-y-auto">
              {error}
            </div>
          )}
        </div>

      {/* Result — stays in the scroll area with the form */}
      {videoUrl && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-green-600 font-medium">Video ready</div>
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

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { MODELS } from "@shared/constants/models";

interface SourceImage {
  data: string;
  mimeType: string;
  name: string;
}

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
                    className={`text-left font-semibold px-2.5 py-1.5 ${
                      !highlightV15 ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : ""
                    }`}
                  >
                    Legacy
                    <div className="font-mono font-normal text-[10px] opacity-80">
                      grok-imagine-video
                    </div>
                  </th>
                  <th
                    className={`text-left font-semibold px-2.5 py-1.5 ${
                      highlightV15 ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : ""
                    }`}
                  >
                    Video 1.5
                    <div className="font-mono font-normal text-[10px] opacity-80">
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
                      className={`px-2.5 py-1.5 leading-snug ${
                        !highlightV15 ? "bg-sky-500/5" : ""
                      }`}
                    >
                      {row.legacy}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 leading-snug ${
                        highlightV15 ? "bg-violet-500/5" : ""
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
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [duration, setDuration] = useState<number>(15);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  /** Native soundtrack: Grok Imagine is a video-audio model; default on. */
  const [withAudio, setWithAudio] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [showModelHelp, setShowModelHelp] = useState(false);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [header, base64] = result.split(",");
      const mimeType = header.match(/data:(.*?);/)?.[1] ?? file.type ?? "image/png";
      setSourceImage({ data: base64, mimeType, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  // Text-to-video needs only a prompt. Image is always optional in the UI.
  const canGenerate = prompt.trim().length > 0 && !!apiKey;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setVideoUrl(null);

    const hasImage = sourceImage !== null;
    // 1080p is only on Video 1.5 — upgrade the model for that request when needed.
    const effectiveModelId =
      resolution === "1080p" && !isVideo15 ? VIDEO_15_MODEL : modelId;

    setProgress(
      hasImage
        ? `Submitting image-to-video (${resolution})…`
        : `Submitting text-to-video (${resolution})…`
    );

    // Listen for progress events from the Rust polling loop
    unlistenRef.current?.();
    const unlisten = await listen<{ message: string; elapsed: number; poll?: number; status?: string }>(
      "video-progress",
      (event) => setProgress(event.payload.message)
    );
    unlistenRef.current = unlisten;

    try {
      const result = await invoke<{ url: string; videoId?: string }>("generate_video", {
        prompt: prompt,
        apiKey,
        modelId: effectiveModelId,
        durationSeconds: duration,
        aspectRatio,
        resolution,
        image: sourceImage?.data ?? null,
        imageMimeType: sourceImage?.mimeType ?? null,
        withAudio,
      });
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
    if (!videoUrl) return;
    try {
      const filename = `grok-video-${Date.now()}.mp4`;
      const savedPath = await invoke<string>("download_video", { url: videoUrl, filename });
      setProgress(`✅ Saved to ${savedPath}`);
    } catch (e) {
      setError("Failed to download video: " + (e as Error).message);
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
            {sourceImage
              ? "Image-to-video · animate your uploaded still"
              : "Text-to-video ready — type a prompt (image optional · 480p / 720p / 1080p)"}
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
                {VIDEO_RESOLUTIONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setResolution(r.value)}
                    title={r.hint}
                    className={pillBtn(resolution === r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
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

        {/* Source image — always optional */}
        <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold">Source image (optional)</div>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                Skip to generate from text only. Upload to animate a still frame.
              </p>
            </div>
            {sourceImage ? (
              <div className="flex items-center gap-2 shrink-0">
                <img
                  src={`data:${sourceImage.mimeType};base64,${sourceImage.data}`}
                  alt="Source"
                  className="h-12 w-12 rounded-md border object-cover"
                />
                <div className="min-w-0 max-w-[8rem]">
                  <div className="text-[11px] font-mono truncate">{sourceImage.name}</div>
                  <button
                    type="button"
                    onClick={() => setSourceImage(null)}
                    className="text-[11px] text-red-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="shrink-0 flex items-center justify-center rounded-lg border border-dashed border-border px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Upload PNG / JPEG
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>

        {/* Prompt + generate */}
        <div className="space-y-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the video you want to generate… (image not required)"
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
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-green-600 font-medium">Video ready</div>
            <Button size="sm" onClick={handleDownload} variant="outline">
              Download
            </Button>
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

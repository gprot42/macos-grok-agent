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

interface GrokVideoPanelProps {
  apiKey: string;
  modelId?: string;
  modelDisplayName?: string;
}

export function GrokVideoPanel({
  apiKey,
  modelId = "grok-imagine-video-1.5",
  modelDisplayName: _modelDisplayName = "Grok Imagine Video 1.5",
}: GrokVideoPanelProps) {
  const modelConfig = Object.values(MODELS).find(m => m.modelId === modelId);
  const isImageToVideoOnly = modelId.includes("1.5");
  const [prompt, setPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [duration, setDuration] = useState<number>(15);
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
  /** Native soundtrack: Grok Imagine is a video-audio model; default on. */
  const [withAudio, setWithAudio] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
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

  const canGenerate =
    prompt.trim().length > 0 && (!isImageToVideoOnly || sourceImage !== null);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setVideoUrl(null);
    setProgress("Submitting to xAI…");

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
        modelId,
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
      {/* Controls — fixed density so the form fits without page scroll */}
      <div className="shrink-0 px-3 pt-2 pb-2 space-y-2 max-w-3xl mx-auto w-full">
        {/* One-line context (model selected in toolbar) */}
        <div className="text-[11px] text-muted-foreground truncate">
          {isImageToVideoOnly
            ? "Animate a still image with a motion prompt"
            : "Text-to-video · optional source image"}
          {modelConfig?.description ? ` · ${modelConfig.description}` : ""}
        </div>

        {/* Settings card — single dense block */}
        <div className="rounded-xl border border-border bg-card px-3 py-2 space-y-2">
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
                {([
                  { value: "480p" as const, label: "480p", hint: "Standard definition, faster" },
                  { value: "720p" as const, label: "720p", hint: "HD quality" },
                ]).map((r) => (
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

        {/* Source image — compact */}
        <div className="rounded-xl border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold">
                {isImageToVideoOnly ? "Source image (required)" : "Source image (optional)"}
              </div>
              {isImageToVideoOnly && (
                <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                  Image-to-video only. Switch to Legacy for text-only generation.
                </p>
              )}
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
        <div className="space-y-1.5">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              isImageToVideoOnly
                ? "Describe how the image should move and animate..."
                : "Describe the video you want to generate..."
            }
            rows={2}
            className="min-h-[3.25rem] max-h-24 resize-none text-sm"
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
            >
              {isLoading ? "Generating…" : "Generate Video"}
            </Button>
            {!apiKey && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠️ xAI API key required
              </span>
            )}
            {progress && !error && (
              <span className="text-xs text-blue-500 truncate min-w-0">{progress}</span>
            )}
          </div>
          {error && (
            <div className="text-red-500 text-xs bg-red-50 dark:bg-red-900/20 p-2 rounded max-h-16 overflow-y-auto">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Result — only this area scrolls if the video is tall */}
      {videoUrl && (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 max-w-3xl mx-auto w-full">
          <div className="space-y-1.5 rounded-xl border border-border bg-card p-2.5">
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
        </div>
      )}

      {/* Empty filler so layout stays top-aligned when no video */}
      {!videoUrl && <div className="flex-1 min-h-0" />}
    </div>
  );
}

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
  { value: "2:3", label: "2:3", w: 24, h: 36 },
  { value: "3:2", label: "3:2", w: 36, h: 24 },
  { value: "1:1", label: "1:1", w: 28, h: 28 },
  { value: "9:16", label: "9:16", w: 24, h: 36 },
  { value: "16:9", label: "16:9", w: 36, h: 20 },
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
  modelDisplayName = "Grok Imagine Video 1.5",
}: GrokVideoPanelProps) {
  const modelConfig = Object.values(MODELS).find(m => m.modelId === modelId);
  const isImageToVideoOnly = modelId.includes("1.5");
  const [prompt, setPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [duration, setDuration] = useState<number>(15);
  const [resolution, setResolution] = useState<"480p" | "720p">("720p");
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center gap-4">
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Film frame */}
              <rect x="2" y="8" width="48" height="36" rx="4" stroke="white" strokeWidth="3" fill="none" opacity="0.9"/>
              {/* Film sprocket holes left */}
              <rect x="6"  y="13" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="6"  y="22" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="6"  y="31" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              {/* Film sprocket holes right */}
              <rect x="41" y="13" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="41" y="22" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="41" y="31" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              {/* Play triangle */}
              <path d="M21 19 L21 33 L35 26 Z" fill="#00CFFF" opacity="0.95"/>
              {/* Sparkle top-right */}
              <path d="M44 2 C44 2 44.7 5.5 45 5.8 C45.3 6.1 49 6.8 49 6.8 C49 6.8 45.3 7.5 45 7.8 C44.7 8.1 44 11.5 44 11.5 C44 11.5 43.3 8.1 43 7.8 C42.7 7.5 39 6.8 39 6.8 C39 6.8 42.7 6.1 43 5.8 C43.3 5.5 44 2 44 2 Z" fill="#00CFFF" opacity="0.8"/>
            </svg>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xl font-semibold">{modelDisplayName}</div>
                {modelId.includes("1.5") && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#6C63FF]/15 text-[#6C63FF] border border-[#6C63FF]/30">
                    v1.5
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-500 dark:text-tokyo-muted mt-1">
                {isImageToVideoOnly
                  ? "Animate a still image with a motion prompt"
                  : "Generate videos from text prompts (or upload an image)"}
              </div>
              <div className="text-sm font-mono text-gray-400 dark:text-tokyo-muted mt-1.5">
                model: {modelId} · {modelConfig?.description ?? ""}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border overflow-hidden bg-card divide-y divide-border">
            {/* Aspect ratio */}
            <div className="p-4">
              <div className="text-sm font-semibold mb-3">Aspect ratio</div>
              <div className="flex items-center gap-4 flex-wrap">
                {VIDEO_ASPECT_RATIOS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setAspectRatio(r.value)}
                    className="flex flex-col items-center gap-2 group"
                  >
                    <div
                      className={`w-16 h-16 flex items-center justify-center rounded-xl transition-colors ${
                        aspectRatio === r.value
                          ? "ring-2 ring-foreground"
                          : ""
                      }`}
                    >
                      <div
                        style={{ width: r.w, height: r.h }}
                        className={`rounded-md transition-colors ${
                          aspectRatio === r.value
                            ? "bg-foreground"
                            : "bg-muted-foreground/30 group-hover:bg-muted-foreground/50"
                        }`}
                      />
                    </div>
                    <span
                      className={`text-xs font-mono ${
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

            {/* Duration */}
            <div className="p-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Duration</div>
              <div className="flex items-center gap-1 bg-muted rounded-full p-1">
                {VIDEO_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                      duration === d
                        ? "bg-foreground text-background font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div className="p-4 flex items-center justify-between">
              <div className="text-sm font-semibold">Resolution</div>
              <div className="flex items-center gap-1 bg-muted rounded-full p-1">
                {([
                  { value: "480p", label: "480p", hint: "Standard definition, faster processing" },
                  { value: "720p", label: "720p", hint: "HD quality" },
                ] as const).map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setResolution(r.value)}
                    title={r.hint}
                    className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                      resolution === r.value
                        ? "bg-foreground text-background font-bold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border overflow-hidden bg-card p-4 space-y-3">
            <div className="text-sm font-semibold">
              {isImageToVideoOnly ? "Source image (required)" : "Source image (optional)"}
            </div>
            {isImageToVideoOnly && (
              <p className="text-xs text-muted-foreground">
                grok-imagine-video-1.5 is image-to-video only. For text-only generation, switch to Grok Imagine Video (Legacy).
              </p>
            )}
            {sourceImage ? (
              <div className="flex items-start gap-3">
                <img
                  src={`data:${sourceImage.mimeType};base64,${sourceImage.data}`}
                  alt="Source"
                  className="h-24 w-24 rounded-lg border object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono truncate">{sourceImage.name}</div>
                  <button
                    type="button"
                    onClick={() => setSourceImage(null)}
                    className="text-xs text-red-500 hover:underline mt-1"
                  >
                    Remove image
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 cursor-pointer hover:bg-muted/40 transition-colors">
                <span className="text-sm text-muted-foreground">Click to upload PNG or JPEG</span>
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
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              isImageToVideoOnly
                ? "Describe how the image should move and animate..."
                : "Describe the video you want to generate..."
            }
            rows={4}
          />
          <Button onClick={handleGenerate} disabled={isLoading || !canGenerate}>
            {isLoading ? "Generating Video..." : "Generate Video"}
          </Button>
          {progress && !error && (
            <div className="text-sm text-blue-500">{progress}</div>
          )}
          {error && <div className="text-red-500 text-sm bg-red-50 p-3 rounded">{error}</div>}
          {videoUrl && (
            <div className="space-y-2">
              <div className="text-sm text-green-600 font-medium">Video generated successfully!</div>
              <video controls src={videoUrl} className="w-full rounded-lg border" />
              <Button onClick={handleDownload} variant="outline">
                Download Video
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

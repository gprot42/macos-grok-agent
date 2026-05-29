import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";

interface GrokVideoPanelProps {
  apiKey: string;
}

export function GrokVideoPanel({ apiKey }: GrokVideoPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(8);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
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
      const videoUrlResult = await invoke<string>("generate_video", {
        prompt: prompt,
        apiKey,
        modelId: "grok-imagine-video",
        durationSeconds: duration,
      });
      setVideoUrl(videoUrlResult);
      setProgress("✅ Video ready!");
    } catch (e: any) {
      setError(e.toString());
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
              <div className="text-xl font-semibold">Generate videos from text prompts</div>
              <div className="text-sm font-mono text-gray-400 dark:text-tokyo-muted mt-1.5">model: grok-imagine-video · v1.3.54 · $0.05/sec</div>
            </div>
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the video you want to generate..."
            rows={4}
          />
          <div className="flex gap-4 items-center">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Duration (seconds)</label>
              <input
                type="range"
                min="1"
                max="15"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-32"
              />
              <span className="text-xs text-gray-500">{duration}s</span>
            </div>
          </div>
          <Button onClick={handleGenerate} disabled={isLoading || !prompt.trim()}>
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

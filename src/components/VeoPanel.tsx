import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Download, Trash2, ExternalLink, ImagePlus, X } from "lucide-react";

interface VeoPanelProps {
  apiKey: string;
  projectId: string;
  activeProject: string | null;
}

interface RefImage {
  path: string;
  data: string;
  mimeType: string;
}

interface GeneratedVideo {
  id: string;
  prompt: string;
  videoUrl?: string;
  videoData?: string;
  status: "generating" | "done" | "error";
  error?: string;
}

function mimeFromPath(path: string): string {
  const ext = path.toLowerCase().split(".").pop() || "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

async function pickImage(): Promise<RefImage | null> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (!selected || typeof selected !== "string") return null;
  const bytes = await readFile(selected);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const data = btoa(binary);
  return { path: selected, data, mimeType: mimeFromPath(selected) };
}

export function VeoPanel({ apiKey, projectId, activeProject }: VeoPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [veoModel, setVeoModel] = useState<"veo-3.1" | "veo-3.1-lite">("veo-3.1");
  const [mainImage, setMainImage] = useState<RefImage | null>(null);
  const [refImages, setRefImages] = useState<RefImage[]>([]);
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const handlePickMain = async () => {
    const img = await pickImage();
    if (img) setMainImage(img);
  };

  const handlePickRef = async () => {
    if (refImages.length >= 3) return;
    const img = await pickImage();
    if (img) setRefImages((prev) => [...prev, img]);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || !apiKey) return;
    setLoading(true);
    const id = Date.now().toString();
    const newVideo: GeneratedVideo = { id, prompt: prompt.trim(), status: "generating" };
    setVideos((prev) => [newVideo, ...prev]);

    try {
      const result = await invoke<Record<string, unknown>>("veo_generate_video", {
        apiKey,
        projectId,
        prompt: prompt.trim(),
        aspectRatio,
        model: veoModel,
        mainImage: mainImage
          ? { path: mainImage.path, data: mainImage.data, mimeType: mainImage.mimeType }
          : null,
        referenceImages: refImages.length
          ? refImages.map((r) => ({ path: r.path, data: r.data, mimeType: r.mimeType }))
          : null,
      });

      setVideos((prev) =>
        prev.map((v) =>
          v.id === id
            ? { ...v, status: "done", videoUrl: result.videoUrl as string, videoData: result.videoData as string }
            : v
        )
      );
    } catch (e) {
      setVideos((prev) =>
        prev.map((v) => (v.id === id ? { ...v, status: "error", error: String(e) } : v))
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (video: GeneratedVideo) => {
    if (!video.videoData) return;
    try {
      if (activeProject) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", {
          projectPath,
          subfolder: "outputs",
          filename: `veo-${timestamp}.mp4`,
          content: video.videoData,
        });
      } else {
        const path = await save({
          defaultPath: `veo-video-${video.id}.mp4`,
          filters: [{ name: "Video", extensions: ["mp4"] }],
        });
        if (path) {
          const bytes = Uint8Array.from(atob(video.videoData), (c) => c.charCodeAt(0));
          await writeFile(path, bytes);
        }
      }
    } catch (e) {
      console.error("Failed to save video:", e);
    }
  };

  const handleDelete = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
  };

  const shortName = (p: string) => p.split("/").pop() || p;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-tokyo-muted gap-6">
            <div className="text-8xl">🎬</div>
            <div className="text-center">
              <div className="text-2xl font-semibold">Veo 3.1{veoModel === "veo-3.1-lite" ? " Lite" : ""}</div>
              <div className="text-lg mt-1">Generate videos from text prompts</div>
              <div className="text-base mt-4 max-w-lg text-center leading-relaxed text-gray-500">
                <a
                  href="https://ai.google.dev/gemini-api/docs/video"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-500 hover:text-blue-600"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Google Docs
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {videos.map((video) => (
              <div key={video.id} className="rounded-xl border theme-border theme-surface overflow-hidden">
                <div className="p-3 border-b theme-border">
                  <div className="text-sm theme-text font-medium truncate">{video.prompt}</div>
                </div>
                <div className="p-3">
                  {video.status === "generating" ? (
                    <div className="flex items-center justify-center py-12 gap-2 theme-text-muted text-sm">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Generating video... this may take a few minutes
                    </div>
                  ) : video.status === "error" ? (
                    <div className="text-red-500 text-sm py-4 px-2">{video.error}</div>
                  ) : video.videoUrl ? (
                    <video
                      src={video.videoUrl}
                      controls
                      className="w-full rounded-lg max-h-[400px]"
                    />
                  ) : video.videoData ? (
                    <video
                      src={`data:video/mp4;base64,${video.videoData}`}
                      controls
                      className="w-full rounded-lg max-h-[400px]"
                    />
                  ) : null}
                </div>
                <div className="flex items-center gap-2 px-3 pb-3">
                  {video.status === "done" && video.videoData && (
                    <button
                      onClick={() => handleSave(video)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Save
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => handleDelete(video.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div ref={resultsEndRef} />
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-2">
        <div className="flex gap-3 items-center flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium theme-text">Model:</span>
            <div className="flex gap-1">
              {([
                { value: "veo-3.1" as const, label: "Veo 3.1" },
                { value: "veo-3.1-lite" as const, label: "Veo 3.1 Lite" },
              ]).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setVeoModel(m.value)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    veoModel === m.value
                      ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium"
                      : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium theme-text">Aspect:</span>
            <div className="flex gap-1">
              {(["16:9", "9:16"] as const).map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    aspectRatio === ratio
                      ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium"
                      : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Reference images */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium theme-text">Main image:</span>
          {mainImage ? (
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs">
              <img
                src={`data:${mainImage.mimeType};base64,${mainImage.data}`}
                alt=""
                className="h-6 w-6 rounded object-cover"
              />
              <span className="max-w-[120px] truncate">{shortName(mainImage.path)}</span>
              <button onClick={() => setMainImage(null)} className="hover:text-red-500">
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={handlePickMain}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border theme-border theme-text-muted hover:theme-text hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Upload main reference image (starting frame)"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Add
            </button>
          )}

          <div className="border-l theme-border h-5 mx-1" />

          <span className="text-xs font-medium theme-text">
            Ingredients ({refImages.length}/3):
          </span>
          {refImages.map((img, i) => (
            <div
              key={i}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-xs"
            >
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt=""
                className="h-6 w-6 rounded object-cover"
              />
              <span className="max-w-[100px] truncate">{shortName(img.path)}</span>
              <button
                onClick={() => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="hover:text-red-500"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {refImages.length < 3 && (
            <button
              onClick={handlePickRef}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border theme-border theme-text-muted hover:theme-text hover:bg-gray-100 dark:hover:bg-gray-800"
              title="Add reference image (character, object, style)"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Add
            </button>
          )}
        </div>

        <div className="flex gap-2 items-start">
          <Textarea
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
            placeholder="Describe the video you want to generate..."
            className="flex-1 resize-none text-sm min-h-[80px]"
            rows={3}
          />
          <Button
            onClick={handleGenerate}
            disabled={!prompt.trim() || !apiKey || loading}
            size="sm"
            className="h-10 px-4"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

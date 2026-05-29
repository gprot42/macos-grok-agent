import { useState, useRef, useEffect, useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { ArrowRight, UploadCloud } from "lucide-react";

// ── Aspect ratio data ─────────────────────────────────────────────────────────
const ASPECT_RATIOS = [
  { value: "1:1",  name: "Square",         bestFor: "General use, social media",    dims: "1024×1024" },
  { value: "16:9", name: "Landscape",      bestFor: "Wallpapers, YouTube",          dims: "1344×768"  },
  { value: "9:16", name: "Portrait",       bestFor: "Instagram Stories, TikTok",    dims: "768×1344"  },
  { value: "3:2",  name: "Photo",          bestFor: "Photography style",            dims: "1152×768"  },
  { value: "2:3",  name: "Portrait Photo", bestFor: "Vertical photos",              dims: "768×1152"  },
  { value: "4:3",  name: "Standard",       bestFor: "Classic photos",               dims: "1152×864"  },
  { value: "3:4",  name: "Portrait Std",   bestFor: "Vertical standard",            dims: "864×1152"  },
] as const;

type AspectRatioValue = typeof ASPECT_RATIOS[number]["value"];

function AspectRatioSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: AspectRatioValue) => void;
}) {
  const [showTable, setShowTable] = useState(false);
  const selected = ASPECT_RATIOS.find((r) => r.value === value) ?? ASPECT_RATIOS[0];

  return (
    <div className="space-y-1.5">
      {/* Button row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold theme-text">Aspect:</span>
        {ASPECT_RATIOS.map((r) => (
          <button
            key={r.value}
            onClick={() => onChange(r.value)}
            title={`${r.name} — ${r.dims} — ${r.bestFor}`}
            className={`px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${
              value === r.value
                ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold ring-1 ring-purple-400 dark:ring-purple-600"
                : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {r.value}
          </button>
        ))}
        {/* Selected info */}
        <span className="text-xs theme-text-muted font-mono">{selected.dims}</span>
        <span className="text-xs theme-text-muted">· {selected.name}</span>
        {/* Info toggle */}
        <button
          onClick={() => setShowTable((v) => !v)}
          className={`ml-auto text-xs px-2 py-0.5 rounded transition-colors ${
            showTable
              ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
              : "theme-text-muted hover:theme-text"
          }`}
          title="Show all aspect ratio options"
        >
          {showTable ? "▲ Hide" : "ⓘ All ratios"}
        </button>
      </div>

      {/* Lookup table */}
      {showTable && (
        <div className="rounded-xl border theme-border overflow-hidden text-xs">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 dark:bg-[#24283b] border-b theme-border">
                <th className="text-left px-3 py-2 font-semibold theme-text">Ratio</th>
                <th className="text-left px-3 py-2 font-semibold theme-text">Name</th>
                <th className="text-left px-3 py-2 font-semibold theme-text">Best For</th>
                <th className="text-left px-3 py-2 font-semibold theme-text">Dimensions</th>
              </tr>
            </thead>
            <tbody className="divide-y theme-border">
              {ASPECT_RATIOS.map((r) => (
                <tr
                  key={r.value}
                  onClick={() => { onChange(r.value); setShowTable(false); }}
                  className={`cursor-pointer transition-colors ${
                    value === r.value
                      ? "bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300"
                      : "hover:bg-gray-50 dark:hover:bg-[#24283b] theme-text"
                  }`}
                >
                  <td className="px-3 py-2 font-mono font-bold">{r.value}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 theme-text-muted">{r.bestFor}</td>
                  <td className="px-3 py-2 font-mono theme-text-muted">{r.dims}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ImageGeneratorProps {
  apiKey: string;
  onGenerateImage: (options: {
    prompt: string;
    apiKey: string;
    editImage?: string;
    editImageMimeType?: string;
    modelId?: string;
    searchMode?: string;
    aspectRatio?: string;
    region?: string;
    resolution?: string;
  }) => Promise<string | undefined>;
  generatedImages: string[];
  /** Actual per-image cost in USD returned by the API (index-aligned with generatedImages). */
  imageCosts?: (number | null)[];
  isLoading: boolean;
  error: string | null;
  activeProject: string | null;
  onDeleteImage: (index: number) => void;
  onClearImages: () => void;
  imageModelId?: string;
  imageModelName?: string;
  /** Estimated per-image cost from the model config (shown in empty state). */
  imagePerImageCost?: number;
  altModelId?: string;
  altModelName?: string;
}

export function ImageGenerator({
  apiKey,
  onGenerateImage,
  generatedImages,
  imageCosts,
  isLoading,
  error,
  activeProject,
  onDeleteImage,
  onClearImages,
  imageModelId,
  imageModelName,
  imagePerImageCost: _imagePerImageCost,
  altModelId,
  altModelName,
}: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [imagePrompts, setImagePrompts] = useState<string[]>([]);
  const [sourceImage, setSourceImage] = useState<{
    data: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [imageFormat, setImageFormat] = useState<"png" | "jpg" | "webp">("png");
  const [searchMode, setSearchMode] = useState<"none" | "reference" | "change-ratio">("none");
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [sourceImageDims, setSourceImageDims] = useState<{ width: number; height: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(100);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  /** "auto" = global api.x.ai; "us-east-1" | "eu-west-1" = pinned region */
  const [region, setRegion] = useState<"auto" | "us-east-1" | "eu-west-1">("auto");
  /** "1k" = 1024px longest side (~$0.05); "2k" = 2048px (~$0.07) */
  const [resolution, setResolution] = useState<"1k" | "2k">("1k");
  const generationStartRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLoading) {
      generationStartRef.current = Date.now();
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - (generationStartRef.current ?? Date.now())) / 1000));
      }, 1000);
    } else {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    return () => { if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current); };
  }, [isLoading]);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  // Detect pixel dimensions of a base64 image
  const detectDims = useCallback((base64: string, mimeType: string): Promise<{ width: number; height: number }> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = `data:${mimeType};base64,${base64}`;
    }), []);

  // Shared helper: read a file path → set source image + detect dims
  const loadImageFromPath = useCallback(async (selected: string) => {
    const fileData = await readFile(selected);
    let binary = "";
    const chunkSize = 32768;
    for (let i = 0; i < fileData.length; i += chunkSize) {
      const chunk = fileData.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64 = btoa(binary);
    const ext = selected.split(".").pop()?.toLowerCase() || "png";
    let mimeType = "image/png";
    if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
    else if (ext === "gif") mimeType = "image/gif";
    else if (ext === "webp") mimeType = "image/webp";

    setSourceImage({ data: base64, name: selected.split("/").pop() || "image", mimeType });
    const dims = await detectDims(base64, mimeType);
    setSourceImageDims(dims);
  }, [detectDims]);

  const handleLoadImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      if (selected && typeof selected === "string") {
        await loadImageFromPath(selected);
      }
    } catch (e) {
      console.error("Failed to load image:", e);
    }
  };

  const handleGenerate = async () => {
    const isRatioMode = searchMode === "change-ratio";
    // In change-ratio mode a prompt is optional — auto-generate one if empty
    const autoPrompt = isRatioMode && !prompt.trim()
      ? `Adapt this image to a ${aspectRatio} aspect ratio. Intelligently expand or crop to fill the new canvas while preserving the main subject, composition, style and colours. Do not stretch or distort.`
      : prompt;
    if (!autoPrompt.trim()) return;

    const usedPrompt = autoPrompt;
    setLastPrompt(usedPrompt);
    const result = await onGenerateImage({
      prompt: usedPrompt,
      apiKey,
      editImage: sourceImage?.data,
      editImageMimeType: sourceImage?.mimeType,
      modelId: imageModelId,
      searchMode: isRatioMode ? undefined : (searchMode === "none" ? undefined : searchMode),
      aspectRatio: aspectRatio !== "1:1" ? aspectRatio : undefined,
      region: region !== "auto" ? region : undefined,
      resolution,
    });
    if (result) {
      setImagePrompts(prev => [...prev, usedPrompt]);
      setSourceImage({
        data: result,
        name: `generated-${generatedImages.length + 1}`,
        mimeType: "image/png",
      });
    }
    setPrompt("");
  };

  const handleResend = () => {
    if (lastPrompt) {
      setPrompt(lastPrompt);
    }
  };

  const handleSaveImage = async (imageBase64: string, index: number) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const ext = imageFormat === "jpg" ? "jpg" : imageFormat;
      const filename = `image-${timestamp}.${ext}`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });

        // Convert if needed for non-PNG formats
        let saveData = imageBase64;
        if (imageFormat !== "png") {
          saveData = await convertImageFormat(imageBase64, imageFormat);
        }

        await invoke("save_image_to_project", {
          projectPath,
          filename,
          imageBase64: saveData,
        });
        setSavedIdx(index);
        setTimeout(() => setSavedIdx(null), 2000);
      } else {
        const filePath = await save({
          defaultPath: `generated-image-${index + 1}.${ext}`,
        });

        if (filePath) {
          let saveBytes: Uint8Array;

          if (imageFormat === "png") {
            // Save as PNG directly
            const binaryString = atob(imageBase64);
            saveBytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              saveBytes[i] = binaryString.charCodeAt(i);
            }
          } else {
            // Convert to selected format
            const converted = await convertImageFormat(imageBase64, imageFormat);
            const binaryString = atob(converted);
            saveBytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              saveBytes[i] = binaryString.charCodeAt(i);
            }
          }

          await writeFile(filePath, saveBytes);
          setSavedIdx(index);
          setTimeout(() => setSavedIdx(null), 2000);
        }
      }
    } catch (e) {
      console.error("Failed to save image:", e);
    }
  };

  const convertImageFormat = async (base64: string, format: "jpg" | "webp"): Promise<string> => {
    return new Promise((resolve, reject) => {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: 'image/png' });
      const img = new Image();
      const url = URL.createObjectURL(blob);

      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0);

        const mimeType = format === 'webp' ? 'image/webp' : 'image/jpeg';
        const quality = format === 'webp' ? 0.9 : 0.92;

        canvas.toBlob((convertedBlob) => {
          if (convertedBlob) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64Data = result.split(',')[1];
              resolve(base64Data);
            };
            reader.readAsDataURL(convertedBlob);
          } else {
            reject(new Error('Failed to convert image'));
          }
        }, mimeType, quality);
      };
      img.onerror = reject;
      img.src = url;
    });
  };

  const handleUseAsSource = useCallback(async (imageBase64: string, index: number) => {
    setSourceImage({ data: imageBase64, name: `generated-${index + 1}`, mimeType: "image/png" });
    const dims = await detectDims(imageBase64, "image/png");
    setSourceImageDims(dims);
  }, [detectDims]);

  const handleRedrawWithAlt = async (index: number) => {
    const originalPrompt = imagePrompts[index];
    if (!originalPrompt || !altModelId) return;
    const result = await onGenerateImage({
      prompt: originalPrompt,
      apiKey,
      modelId: altModelId,
      region: region !== "auto" ? region : undefined,
      resolution,
    });
    if (result) {
      setImagePrompts(prev => [...prev, originalPrompt]);
    }
  };

  const handleClear = () => {
    onClearImages();
    setImagePrompts([]);
    setSourceImage(null);
    setSourceImageDims(null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin relative z-0">
        {sourceImage && !generatedImages.includes(sourceImage.data) && (
          <div className="mb-4 relative group inline-block ring-2 ring-indigo-500 rounded-lg p-1">
            <img 
              src={`data:${sourceImage.mimeType};base64,${sourceImage.data}`} 
              alt="Source" 
              className="w-48 h-auto rounded-md shadow-sm"
            />
            <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
              Source: {sourceImage.name}
            </div>
            <button 
              onClick={() => setSourceImage(null)}
              className="absolute top-2 right-2 bg-black/60 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove source image"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {generatedImages.length === 0 && !sourceImage && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-tokyo-muted gap-6">
            <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Outer glow */}
              <circle cx="48" cy="48" r="46" fill="url(#glowBg)" opacity="0.15"/>
              {/* Large four-pointed sparkle */}
              <path
                d="M48 6 C48 6 51 36 54 42 C60 48 90 48 90 48 C90 48 60 48 54 54 C51 60 48 90 48 90 C48 90 45 60 42 54 C36 48 6 48 6 48 C6 48 36 48 42 42 C45 36 48 6 48 6 Z"
                fill="white" opacity="0.95"
              />
              {/* Small secondary sparkle top-right */}
              <path
                d="M74 18 C74 18 75.5 26 76.5 27 C77.5 28 86 29 86 29 C86 29 77.5 30 76.5 31 C75.5 32 74 40 74 40 C74 40 72.5 32 71.5 31 C70.5 30 62 29 62 29 C62 29 70.5 28 71.5 27 C72.5 26 74 18 74 18 Z"
                fill="#00CFFF" opacity="0.85"
              />
              {/* Tiny sparkle bottom-left */}
              <path
                d="M22 58 C22 58 23 63 23.5 63.5 C24 64 29 65 29 65 C29 65 24 66 23.5 66.5 C23 67 22 72 22 72 C22 72 21 67 20.5 66.5 C20 66 15 65 15 65 C15 65 20 64 20.5 63.5 C21 63 22 58 22 58 Z"
                fill="#00CFFF" opacity="0.60"
              />
              <defs>
                <radialGradient id="glowBg" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00CFFF"/>
                  <stop offset="100%" stopColor="#00CFFF" stopOpacity="0"/>
                </radialGradient>
              </defs>
            </svg>
            <div className="text-center">
              <div className="text-2xl font-semibold">{imageModelName || "Nano Banana Pro"}</div>
              <div className="text-xl mt-1">Generate and edit images with Grok's image generation capabilities</div>
              <div className="text-sm font-mono text-gray-400 dark:text-tokyo-muted mt-1.5">
                model: {imageModelId || "grok-imagine-image-quality"} · {resolution.toUpperCase()}
                {" · "}{resolution === "2k" ? "~$0.07" : "~$0.05"}/image
                {region !== "auto" && <> · {region}</>}
              </div>
              <div className="text-base mt-4 max-w-lg text-center leading-relaxed text-gray-500">
                Load an image to edit, or describe what you want to create
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {generatedImages.map((img, idx) => {
            const fileSizeKB = Math.round((img.length * 3) / 4 / 1024);
            const isSource = sourceImage?.data === img;

            return (
              <div key={idx} className={`relative group ${isSource ? "ring-2 ring-indigo-500 rounded-lg" : ""}`}>
                <img
                  src={`data:image/png;base64,${img}`}
                  alt={`Generated ${idx + 1}`}
                  className="w-full rounded-lg shadow-lg cursor-pointer"
                  onClick={() => handleUseAsSource(img, idx)}
                  onLoad={(e) => {
                    const target = e.target as HTMLImageElement;
                    const sizeEl = document.getElementById(`img-size-${idx}`);
                    if (sizeEl) {
                      sizeEl.textContent = `${target.naturalWidth}×${target.naturalHeight}`;
                    }
                  }}
                />
                <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex gap-2">
                  <span id={`img-size-${idx}`}>Loading...</span>
                  <span>•</span>
                  <span>{fileSizeKB}KB</span>
                  {imageCosts?.[idx] != null && (
                    <>
                      <span>•</span>
                      <span className="text-green-300">${imageCosts[idx]!.toFixed(4)}</span>
                    </>
                  )}
                </div>
                {isSource && (
                  <div className="absolute top-2 right-2 bg-indigo-500 text-white text-xs px-2 py-1 rounded">
                    Editing
                  </div>
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex flex-col items-center justify-center gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={imageFormat}
                      onChange={(e) => setImageFormat(e.target.value as "png" | "jpg" | "webp")}
                      className="px-2 py-1 text-xs rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-white"
                      title="Image format"
                    >
                      <option value="png">PNG</option>
                      <option value="jpg">JPG</option>
                      <option value="webp">WebP</option>
                    </select>
                    <Button
                      size="sm"
                      onClick={() => handleSaveImage(img, idx)}
                    >
                      {savedIdx === idx ? "Saved!" : "Save"}
                    </Button>
                    <button
                      onClick={() => onDeleteImage(idx)}
                      className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                      title="Delete image"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  {imagePrompts[idx] && altModelName && (
                    <Button
                      size="sm"
                      onClick={() => handleRedrawWithAlt(idx)}
                      disabled={isLoading}
                    >
                      Redraw with {altModelName}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-4">
              <svg className="animate-spin" width="48" height="48" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M48 6 C48 6 51 36 54 42 C60 48 90 48 90 48 C90 48 60 48 54 54 C51 60 48 90 48 90 C48 90 45 60 42 54 C36 48 6 48 6 48 C6 48 36 48 42 42 C45 36 48 6 48 6 Z" fill="white" opacity="0.9"/>
                  <path d="M74 18 C74 18 75.5 26 76.5 27 C77.5 28 86 29 86 29 C86 29 77.5 30 76.5 31 C75.5 32 74 40 74 40 C74 40 72.5 32 71.5 31 C70.5 30 62 29 62 29 C62 29 70.5 28 71.5 27 C72.5 26 74 18 74 18 Z" fill="#00CFFF" opacity="0.85"/>
                </svg>
              <div className="text-center space-y-1">
                <div className="text-gray-600 dark:text-tokyo-muted font-medium">
                  {sourceImage ? "Editing image…" : "Generating image…"}
                </div>
                <div className="text-sm text-gray-400 dark:text-tokyo-muted tabular-nums">
                  {elapsedSeconds}s elapsed
                  {elapsedSeconds < 10 && " · typically 10–30s"}
                  {elapsedSeconds >= 10 && elapsedSeconds < 30 && " · almost there…"}
                  {elapsedSeconds >= 30 && " · complex prompt, please wait"}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm mt-4">
            {error}
          </div>
        )}
      </div>

      <div className="border-t theme-border p-4 space-y-3 relative z-10 theme-surface">
        {/* Resize handle */}
        <div
          className="flex justify-center cursor-ns-resize py-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-t transition-colors"
          onMouseDown={(e) => {
            e.preventDefault();
            dragStartY.current = e.clientY;
            dragStartHeight.current = textareaHeight;
            const handleMove = (moveEvent: MouseEvent) => {
              const deltaY = dragStartY.current - moveEvent.clientY;
              setTextareaHeight(Math.max(60, Math.min(300, dragStartHeight.current + deltaY)));
            };
            const handleUp = () => {
              document.removeEventListener("mousemove", handleMove);
              document.removeEventListener("mouseup", handleUp);
            };
            document.addEventListener("mousemove", handleMove);
            document.addEventListener("mouseup", handleUp);
          }}
          title="Drag to resize"
        >
          <div className="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold theme-text">Mode:</span>
          {([
            { value: "none",         label: "Text → Image",       hint: "Pure creative generation from text" },
            { value: "reference",    label: "+ Photo to Scene",    hint: "Upload a photo of a person or object and place them in a new scene" },
            { value: "change-ratio", label: "↔ Change Ratio",      hint: "Upload an image and change its aspect ratio — e.g. 16:9 → 1:1" },
          ] as const).map((mode) => (
            <button
              key={mode.value}
              onClick={() => setSearchMode(mode.value)}
              title={mode.hint}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                searchMode === mode.value
                  ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium"
                  : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* ── Change Ratio mode UI ─────────────────────────────────────────── */}
        {searchMode === "change-ratio" && (
          <div className="rounded-xl border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/10 p-3 space-y-3">
            {!sourceImage ? (
              /* Drop zone */
              <div
                className={`flex flex-col items-center justify-center gap-2 py-6 rounded-lg transition-colors cursor-pointer ${
                  isDraggingOver
                    ? "bg-indigo-100 dark:bg-indigo-900/30 border-2 border-indigo-400 dark:border-indigo-500"
                    : "hover:bg-indigo-100/60 dark:hover:bg-indigo-900/20"
                }`}
                onClick={handleLoadImage}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  // Tauri file-drop provides paths via dataTransfer.files or items
                  const file = e.dataTransfer.files[0];
                  if (!file) return;
                  // Read via FileReader (works in Tauri webview for dropped files)
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    const dataUrl = ev.target?.result as string;
                    const [header, base64] = dataUrl.split(",");
                    const mimeType = header.match(/:(.*?);/)?.[1] ?? "image/png";
                    const name = file.name;
                    setSourceImage({ data: base64, name, mimeType });
                    const dims = await detectDims(base64, mimeType);
                    setSourceImageDims(dims);
                  };
                  reader.readAsDataURL(file);
                }}
              >
                <UploadCloud className="h-8 w-8 text-indigo-400" />
                <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                  Drop image here or click to upload
                </div>
                <div className="text-xs theme-text-muted">PNG, JPG, WebP supported</div>
              </div>
            ) : (
              /* Before → After preview */
              <div className="flex items-center gap-3">
                {/* Before */}
                <div className="flex flex-col items-center gap-1 min-w-0">
                  <div className="text-xs font-semibold theme-text-muted uppercase tracking-wider">Before</div>
                  <div className="relative group">
                    <img
                      src={`data:${sourceImage.mimeType};base64,${sourceImage.data}`}
                      alt="Source"
                      className="h-20 w-auto max-w-[120px] object-contain rounded-lg border theme-border shadow-sm"
                    />
                    <button
                      onClick={() => { setSourceImage(null); setSourceImageDims(null); }}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow"
                      title="Remove image"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  {sourceImageDims && sourceImageDims.width > 0 && (
                    <div className="text-[10px] font-mono theme-text-muted">
                      {sourceImageDims.width}×{sourceImageDims.height}
                    </div>
                  )}
                </div>

                <ArrowRight className="h-5 w-5 text-indigo-400 shrink-0" />

                {/* After: target ratio visualisation */}
                <div className="flex flex-col items-center gap-1 min-w-0">
                  <div className="text-xs font-semibold theme-text-muted uppercase tracking-wider">After</div>
                  {(() => {
                    const r = ASPECT_RATIOS.find((x) => x.value === aspectRatio) ?? ASPECT_RATIOS[0];
                    const [wPart, hPart] = r.value.split(":").map(Number);
                    const boxH = 80;
                    const boxW = Math.round((wPart / hPart) * boxH);
                    return (
                      <div
                        className="rounded-lg border-2 border-dashed border-indigo-400 dark:border-indigo-500 bg-indigo-100/50 dark:bg-indigo-900/20 flex items-center justify-center"
                        style={{ width: `${Math.min(boxW, 120)}px`, height: `${boxH}px` }}
                      >
                        <span className="text-xs font-bold text-indigo-500 dark:text-indigo-400">{r.value}</span>
                      </div>
                    );
                  })()}
                  {(() => {
                    const r = ASPECT_RATIOS.find((x) => x.value === aspectRatio) ?? ASPECT_RATIOS[0];
                    return <div className="text-[10px] font-mono theme-text-muted">{r.dims} · {r.name}</div>;
                  })()}
                </div>

                {/* Change source button */}
                <button
                  onClick={handleLoadImage}
                  className="ml-auto text-xs text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2 transition-colors self-start mt-5"
                >
                  Change image
                </button>
              </div>
            )}

            {/* Ratio selector inside change-ratio mode */}
            <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />

            {/* Optional custom prompt override */}
            <div>
              <div className="text-xs theme-text-muted mb-1">
                Custom instructions <span className="opacity-60">(optional — leave blank for auto)</span>
              </div>
              <Textarea
                value={prompt}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
                placeholder={`Auto: "Adapt to ${aspectRatio} ratio, preserve subject and composition…"`}
                className="w-full resize-none text-sm"
                style={{ height: "60px", minHeight: "60px" }}
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleGenerate(); }
                }}
              />
            </div>
          </div>
        )}

        {/* Standard text prompt (non-change-ratio modes) */}
        {searchMode !== "change-ratio" && (
          <>
            <Textarea
              value={prompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleGenerate(); }
              }}
              placeholder={
                searchMode === "reference"
                  ? "Describe the scene to place your subject in… (Ctrl+Enter)"
                  : sourceImage
                    ? "Describe how to edit this image… (Ctrl+Enter)"
                    : "Describe the image you want to create… (Ctrl+Enter)"
              }
              className="w-full resize-none"
              style={{ height: `${textareaHeight}px`, minHeight: "60px", maxHeight: "300px" }}
            />
            {/* Aspect ratio selector */}
            <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
          </>
        )}

        {/* ── Resolution + Region controls ──────────────────────────────── */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Resolution */}
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold theme-text">Size:</span>
            {([
              { value: "1k", label: "1K", hint: "1024×1024 · ~$0.05", cost: "$0.05" },
              { value: "2k", label: "2K", hint: "2048×2048 · ~$0.07", cost: "$0.07" },
            ] as const).map((r) => (
              <button
                key={r.value}
                onClick={() => setResolution(r.value)}
                title={r.hint}
                className={`px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${
                  resolution === r.value
                    ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-bold ring-1 ring-purple-400 dark:ring-purple-600"
                    : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {r.label}
              </button>
            ))}
            <span className="text-xs theme-text-muted font-mono">
              {resolution === "1k" ? "1024px · ~$0.05" : "2048px · ~$0.07"}
            </span>
          </div>

          {/* Region */}
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold theme-text">Region:</span>
            {([
              { value: "auto",     label: "Auto",     hint: "Global — xAI routes to lowest-latency region automatically" },
              { value: "us-east-1", label: "US",      hint: "us-east-1 — pinned to US East (data stays in US)" },
              { value: "eu-west-1", label: "EU",      hint: "eu-west-1 — pinned to EU West (data stays in EU)" },
            ] as const).map((r) => (
              <button
                key={r.value}
                onClick={() => setRegion(r.value)}
                title={r.hint}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  region === r.value
                    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold ring-1 ring-indigo-400 dark:ring-indigo-600"
                    : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {r.label}
              </button>
            ))}
            {region !== "auto" && (
              <span className="text-xs font-mono theme-text-muted">{region}</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button onClick={handleResend} size="sm" disabled={!lastPrompt || isLoading}>
              Resend
            </Button>
            {searchMode !== "change-ratio" && (
              <Button onClick={handleLoadImage} size="sm">
                Load Image
              </Button>
            )}
            <Button onClick={handleClear} size="sm" disabled={generatedImages.length === 0 && !sourceImage}>
              Clear
            </Button>
            {activeProject && (
              <span className="text-xs text-indigo-500 dark:text-indigo-400">
                Saving to: {activeProject}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!apiKey && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ xAI API key required
              </span>
            )}
            {searchMode === "change-ratio" && !sourceImage && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Upload an image first
              </span>
            )}
            <Button
              onClick={handleGenerate}
              disabled={
                isLoading ||
                !apiKey ||
                (searchMode === "change-ratio" ? !sourceImage : !prompt.trim())
              }
            >
              {isLoading
                ? "Processing…"
                : searchMode === "change-ratio"
                  ? "Convert Ratio"
                  : sourceImage
                    ? "Edit Image"
                    : "Generate"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

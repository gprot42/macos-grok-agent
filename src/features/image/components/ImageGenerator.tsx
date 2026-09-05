import { useState, useRef, useEffect, useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { ArrowRight, UploadCloud } from "lucide-react";

// ── Aspect ratio data ─────────────────────────────────────────────────────────
const ASPECT_RATIOS = [
  { value: "auto", name: "Auto",           bestFor: "Model picks the best ratio",   dims: "API default" },
  { value: "1:1",  name: "Square",         bestFor: "General use, social media",    dims: "1024×1024" },
  { value: "16:9", name: "Landscape",      bestFor: "Wallpapers, YouTube",          dims: "1344×768"  },
  { value: "9:16", name: "Portrait",       bestFor: "Instagram Stories, TikTok",    dims: "768×1344"  },
  { value: "3:2",  name: "Photo",          bestFor: "Photography style",            dims: "1152×768"  },
  { value: "2:3",  name: "Portrait Photo", bestFor: "Vertical photos",              dims: "768×1152"  },
  { value: "4:3",  name: "Standard",       bestFor: "Classic photos",               dims: "1152×864"  },
  { value: "3:4",  name: "Portrait Std",   bestFor: "Vertical standard",            dims: "864×1152"  },
  { value: "21:9", name: "Ultrawide",      bestFor: "Cinematic, widescreen",        dims: "1344×576"  },
  { value: "5:2",  name: "Banner",         bestFor: "Headers, web banners",         dims: "1280×512"  },
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

/** Image count options for Grok Imagine batch generation. */
const IMAGE_COUNT_OPTIONS = [
  { value: "auto" as const, label: "Auto", n: 1, hint: "Generate 1 image (API default)" },
  { value: "4" as const, label: "4", n: 4, hint: "Generate 4 variations" },
  { value: "8" as const, label: "8", n: 8, hint: "Generate 8 variations" },
  { value: "12" as const, label: "12", n: 12, hint: "Generate 12 variations (batched)" },
] as const;

type ImageCountValue = (typeof IMAGE_COUNT_OPTIONS)[number]["value"];

/**
 * Imagine Image 2.0 quality tiers. `auto` (API default) picks the tier per
 * request to cut latency — currently `low` for generation and `medium` for
 * editing — and you are billed at the tier actually served.
 */
const IMAGE_QUALITY_OPTIONS = [
  { value: "auto" as const,   label: "Auto",   hint: "API default — picks low for generation, medium for editing; billed at tier served" },
  { value: "low" as const,    label: "Low",    hint: "Fastest / cheapest tier" },
  { value: "medium" as const, label: "Medium", hint: "Higher fidelity tier (default for edits under Auto)" },
] as const;

type ImageQualityValue = (typeof IMAGE_QUALITY_OPTIONS)[number]["value"];

/** Max source images per edit request (Imagine Image 2.0 multi-image editing). */
const MAX_REFERENCE_IMAGES = 5;

interface SourceImage {
  data: string;
  name: string;
  mimeType: string;
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
    n?: number;
    /** "auto" | "low" | "medium" */
    quality?: string;
    /** Up to 5 source images for multi-reference editing (overrides editImage). */
    referenceImages?: { data: string; mimeType: string }[];
  }) => Promise<string[] | undefined>;
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
  /** Short version label shown in empty/loading states ("2.0" | "1.5" | "Legacy"). */
  imageModelVersion?: string;
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
  imagePerImageCost,
  imageModelVersion,
  altModelId,
  altModelName,
}: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [imagePrompts, setImagePrompts] = useState<string[]>([]);
  const [sourceImage, setSourceImage] = useState<SourceImage | null>(null);
  /** Additional reference images (2nd…5th) for multi-image editing. `sourceImage` is <IMAGE_0>. */
  const [extraRefs, setExtraRefs] = useState<SourceImage[]>([]);
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
  /** How many images to generate: Auto (1), 4, 8, or 12 */
  const [imageCount, setImageCount] = useState<ImageCountValue>("auto");
  /** Quality tier: auto (default) | low | medium */
  const [quality, setQuality] = useState<ImageQualityValue>("auto");
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

  // Read a file path into a base64 SourceImage
  const readImageFile = useCallback(async (selected: string): Promise<SourceImage> => {
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
    return { data: base64, name: selected.split("/").pop() || "image", mimeType };
  }, []);

  // Shared helper: read a file path → set source image + detect dims
  const loadImageFromPath = useCallback(async (selected: string) => {
    const img = await readImageFile(selected);
    setSourceImage(img);
    const dims = await detectDims(img.data, img.mimeType);
    setSourceImageDims(dims);
  }, [readImageFile, detectDims]);

  /** Total source images that will be sent on the next edit (primary + extras). */
  const totalRefs = (sourceImage ? 1 : 0) + extraRefs.length;
  const canAddRefs = totalRefs < MAX_REFERENCE_IMAGES;

  // Add one or more reference images (2nd…5th). If there is no primary yet, the first pick becomes it.
  const handleAddReferences = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (paths.length === 0) return;
      const imgs = await Promise.all(paths.map((p) => readImageFile(p)));
      let primary = sourceImage;
      const extras = [...extraRefs];
      for (const img of imgs) {
        if (!primary) {
          primary = img;
        } else if (1 + extras.length < MAX_REFERENCE_IMAGES) {
          extras.push(img);
        }
      }
      if (primary && primary !== sourceImage) {
        setSourceImage(primary);
        setSourceImageDims(await detectDims(primary.data, primary.mimeType));
      }
      setExtraRefs(extras);
    } catch (e) {
      console.error("Failed to add reference images:", e);
    }
  };

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
    const countOpt = IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount) ?? IMAGE_COUNT_OPTIONS[0];
    const results = await onGenerateImage({
      prompt: usedPrompt,
      apiKey,
      editImage: sourceImage?.data,
      editImageMimeType: sourceImage?.mimeType,
      modelId: imageModelId,
      searchMode: isRatioMode ? undefined : (searchMode === "none" ? undefined : searchMode),
      aspectRatio,
      region: region !== "auto" ? region : undefined,
      resolution,
      n: countOpt.n,
      quality: quality !== "auto" ? quality : undefined,
      // Multi-reference edit: primary + extras (max 5). Change-ratio always uses the single source.
      referenceImages:
        !isRatioMode && sourceImage && extraRefs.length > 0
          ? [sourceImage, ...extraRefs].map((r) => ({ data: r.data, mimeType: r.mimeType }))
          : undefined,
    });
    if (results && results.length > 0) {
      // One prompt entry per returned image so redraw/prompts stay index-aligned.
      setImagePrompts((prev) => [
        ...prev,
        ...Array.from({ length: results.length }, () => usedPrompt),
      ]);
      const last = results[results.length - 1];
      setSourceImage({
        data: last,
        name: `generated-${generatedImages.length + results.length}`,
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
    const results = await onGenerateImage({
      prompt: originalPrompt,
      apiKey,
      modelId: altModelId,
      region: region !== "auto" ? region : undefined,
      resolution,
      n: 1,
      quality: quality !== "auto" ? quality : undefined,
    });
    if (results && results.length > 0) {
      setImagePrompts((prev) => [
        ...prev,
        ...Array.from({ length: results.length }, () => originalPrompt),
      ]);
    }
  };

  const handleClear = () => {
    onClearImages();
    setImagePrompts([]);
    setSourceImage(null);
    setSourceImageDims(null);
    setExtraRefs([]);
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
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <div className="text-2xl font-semibold">{imageModelName || "Grok Imagine Image 2.0"}</div>
                {imageModelVersion && imageModelVersion !== "Legacy" && (
                  <span className="px-2 py-0.5 rounded-md text-xs font-bold tracking-wide bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 ring-1 ring-cyan-500/40">
                    {imageModelVersion}
                  </span>
                )}
              </div>
              <div className="text-xl mt-1">Generate and edit images with Grok Imagine</div>
              <div className="text-sm font-mono text-gray-400 dark:text-tokyo-muted mt-1.5">
                model: {imageModelId || "grok-imagine-image-2.0"} · {resolution.toUpperCase()} · quality: {quality}
                {imagePerImageCost != null && (
                  <> · ~${imagePerImageCost.toFixed(2)}/image</>
                )}
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
                  {sourceImage
                    ? imageCount !== "auto"
                      ? `Editing · ${IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount)?.n ?? 1} images…`
                      : totalRefs >= 2
                        ? `Editing with ${totalRefs} reference images…`
                        : "Editing image…"
                    : imageCount !== "auto"
                      ? `Generating ${IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount)?.n ?? 1} images…`
                      : "Generating image…"}
                </div>
                <div className="text-xs font-mono text-cyan-600 dark:text-cyan-400">
                  {imageModelName || "Grok Imagine Image 2.0"}
                  {imageModelId ? ` · ${imageModelId}` : ""}
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
          <div
            role="alert"
            className="mt-4 rounded-xl border-2 border-red-400/80 dark:border-red-600/80 bg-red-50 dark:bg-red-950/50 p-4 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-sm font-bold"
                aria-hidden
              >
                !
              </span>
              <h3 className="text-base font-semibold text-red-900 dark:text-red-100">
                Image generation failed
              </h3>
            </div>
            <div className="text-sm sm:text-[15px] leading-relaxed text-red-950 dark:text-red-50 whitespace-pre-wrap break-words max-h-64 overflow-y-auto font-medium">
              {error}
            </div>
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
                    const r = ASPECT_RATIOS.find((x) => x.value === aspectRatio) ?? ASPECT_RATIOS[1];
                    const [wPart, hPart] = r.value.split(":").map(Number);
                    const boxH = 80;
                    const ratioW = Number.isFinite(wPart) && Number.isFinite(hPart) && hPart > 0
                      ? wPart / hPart
                      : 1;
                    const boxW = Math.round(ratioW * boxH);
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
                totalRefs >= 2
                  ? "Describe the scene — refer to images as <IMAGE_0>, <IMAGE_1>, … (Ctrl+Enter)"
                  : searchMode === "reference"
                    ? "Describe the scene to place your subject in… (Ctrl+Enter)"
                    : sourceImage
                      ? "Describe how to edit this image… (Ctrl+Enter)"
                      : "Describe the image you want to create… (Ctrl+Enter)"
              }
              className="w-full resize-none"
              style={{ height: `${textareaHeight}px`, minHeight: "60px", maxHeight: "300px" }}
            />

            {/* ── Reference images strip (multi-image editing, up to 5) ─────── */}
            {(searchMode === "reference" || sourceImage) && (
              <div className="rounded-xl border theme-border px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold theme-text">References:</span>
                  <span className="text-xs font-mono theme-text-muted">
                    {totalRefs}/{MAX_REFERENCE_IMAGES}
                  </span>
                  <span className="text-xs theme-text-muted">
                    {totalRefs === 0
                      ? "Add up to 5 images — e.g. one character, three props and one location."
                      : totalRefs === 1
                        ? "Single-image edit. Add more to combine subjects, props and locations."
                        : "Multi-image edit — refer to images as <IMAGE_0>…<IMAGE_" + (totalRefs - 1) + "> in the prompt."}
                  </span>
                  {canAddRefs && (
                    <button
                      type="button"
                      onClick={handleAddReferences}
                      className="ml-auto text-xs px-2 py-0.5 rounded border border-dashed theme-border theme-text-muted hover:theme-text hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                      title={`Add reference images (max ${MAX_REFERENCE_IMAGES})`}
                    >
                      + Add images
                    </button>
                  )}
                </div>
                {totalRefs > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {[...(sourceImage ? [sourceImage] : []), ...extraRefs].map((img, index) => (
                      <div key={`${img.name}-${index}`} className="relative group flex flex-col items-center gap-0.5">
                        <div className="relative">
                          <img
                            src={`data:${img.mimeType};base64,${img.data}`}
                            alt={img.name}
                            className={`h-14 w-14 rounded-md border object-cover ${index === 0 ? "ring-2 ring-indigo-500" : "theme-border"}`}
                          />
                          <span className="absolute bottom-0 left-0 right-0 bg-black/55 text-white text-[9px] text-center font-mono leading-tight py-px rounded-b-md">
                            IMAGE_{index}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (index === 0) {
                                // Promote the next extra to primary, if any.
                                const [next, ...rest] = extraRefs;
                                setSourceImage(next ?? null);
                                setSourceImageDims(null);
                                setExtraRefs(next ? rest : []);
                              } else {
                                setExtraRefs((prev) => prev.filter((_, i) => i !== index - 1));
                              }
                            }}
                            className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[11px] leading-none opacity-0 group-hover:opacity-100 shadow"
                            title="Remove"
                            aria-label={`Remove image ${index}`}
                          >
                            ×
                          </button>
                        </div>
                        <div className="text-[10px] font-mono theme-text-muted max-w-[3.5rem] truncate">{img.name}</div>
                      </div>
                    ))}
                    {extraRefs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraRefs([])}
                        className="self-center text-[11px] text-red-500 hover:underline px-1"
                      >
                        Clear extras
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Aspect ratio selector */}
            <AspectRatioSelector value={aspectRatio} onChange={setAspectRatio} />
          </>
        )}

        {/* ── Count + Resolution + Region controls ───────────────────────── */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* Image count */}
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold theme-text">Count:</span>
            {IMAGE_COUNT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setImageCount(opt.value)}
                title={opt.hint}
                className={`px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${
                  imageCount === opt.value
                    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-bold ring-1 ring-emerald-400 dark:ring-emerald-600"
                    : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="text-xs theme-text-muted">
              {imageCount === "auto"
                ? "1 image"
                : `${IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount)?.n ?? 1} images`}
            </span>
          </div>

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
              {imageCount !== "auto" && (
                <> · ×{IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount)?.n}</>
              )}
            </span>
          </div>

          {/* Quality */}
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold theme-text">Quality:</span>
            {IMAGE_QUALITY_OPTIONS.map((q) => (
              <button
                key={q.value}
                type="button"
                onClick={() => setQuality(q.value)}
                title={q.hint}
                className={`px-2.5 py-1 text-xs rounded-md font-mono transition-colors ${
                  quality === q.value
                    ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-bold ring-1 ring-amber-400 dark:ring-amber-600"
                    : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {q.label}
              </button>
            ))}
            <span className="text-xs theme-text-muted">
              {quality === "auto"
                ? sourceImage ? "serves medium for edits" : "serves low for generation"
                : "billed at tier served"}
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
              <Button onClick={handleLoadImage} size="sm" title="Load a single source image (replaces the primary)">
                Load Image
              </Button>
            )}
            {searchMode !== "change-ratio" && canAddRefs && (
              <Button onClick={handleAddReferences} size="sm" title={`Add reference images (up to ${MAX_REFERENCE_IMAGES})`}>
                + Refs
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
                    ? imageCount !== "auto"
                      ? `Edit ×${IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount)?.n ?? 1}`
                      : "Edit Image"
                    : imageCount !== "auto"
                      ? `Generate ${IMAGE_COUNT_OPTIONS.find((o) => o.value === imageCount)?.n ?? 1}`
                      : "Generate"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

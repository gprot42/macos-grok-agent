import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ImageGeneratorProps {
  apiKey: string;
  onGenerateImage: (options: { prompt: string; apiKey: string; editImage?: string }) => Promise<string | undefined>;
  generatedImages: string[];
  isLoading: boolean;
  error: string | null;
  activeProject: string | null;
  onDeleteImage: (index: number) => void;
}

export function ImageGenerator({
  apiKey,
  onGenerateImage,
  generatedImages,
  isLoading,
  error,
  activeProject,
  onDeleteImage,
}: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<{
    data: string;
    name: string;
    mimeType: string;
  } | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [imageFormat, setImageFormat] = useState<"png" | "jpg" | "webp">("png");

  const handleLoadImage = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });

      if (selected) {
        const fileData = await readFile(selected);
        const base64 = btoa(String.fromCharCode(...fileData));
        const ext = selected.split(".").pop()?.toLowerCase() || "png";

        let mimeType = "image/png";
        if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
        else if (ext === "gif") mimeType = "image/gif";
        else if (ext === "webp") mimeType = "image/webp";

        setSourceImage({
          data: base64,
          name: selected.split("/").pop() || "image",
          mimeType,
        });
      }
    } catch (e) {
      console.error("Failed to load image:", e);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    await onGenerateImage({
      prompt,
      apiKey,
      editImage: sourceImage?.data,
    });
    setPrompt("");
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

  const handleUseAsSource = (imageBase64: string, index: number) => {
    setSourceImage({
      data: imageBase64,
      name: `generated-${index + 1}`,
      mimeType: "image/png", // Generated images are always PNG
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin relative z-0">
        {generatedImages.length === 0 && !isLoading && !sourceImage && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-tokyo-muted gap-6">
            <div className="text-8xl">🍌</div>
            <div className="text-center">
              <div className="text-2xl font-semibold">Nano Banana Pro</div>
              <div className="text-lg mt-1">Generate and edit images with AI</div>
              <div className="text-base mt-4 max-w-lg text-center leading-relaxed text-gray-500">
                Load an image to edit, or describe what you want to create
              </div>
            </div>
          </div>
        )}

        {sourceImage && (
          <div className="mb-4">
            <div className="text-sm font-medium text-gray-700 dark:text-tokyo-text mb-2">
              Source Image (will be edited)
            </div>
            <div className="relative inline-block">
              <img
                src={`data:${sourceImage.mimeType};base64,${sourceImage.data}`}
                alt="Source"
                className="max-h-48 rounded-lg border-2 border-indigo-500 shadow-lg"
              />
              <button
                onClick={() => setSourceImage(null)}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-sm hover:bg-red-600 flex items-center justify-center"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="absolute bottom-2 left-2 bg-indigo-500 text-white text-xs px-2 py-1 rounded">
                {sourceImage.name}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {generatedImages.map((img, idx) => {
            // Calculate file size from base64
            const fileSizeKB = Math.round((img.length * 3) / 4 / 1024);

            return (
              <div key={idx} className="relative group">
                <img
                  src={`data:image/png;base64,${img}`}
                  alt={`Generated ${idx + 1}`}
                  className="w-full rounded-lg shadow-lg"
                  onLoad={(e) => {
                    const target = e.target as HTMLImageElement;
                    const sizeEl = document.getElementById(`img-size-${idx}`);
                    if (sizeEl) {
                      sizeEl.textContent = `${target.naturalWidth}×${target.naturalHeight}`;
                    }
                  }}
                />
                {/* Stats overlay - always visible at top-left */}
                <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded flex gap-2">
                  <span id={`img-size-${idx}`}>Loading...</span>
                  <span>•</span>
                  <span>{fileSizeKB}KB</span>
                </div>
                {/* Controls overlay - on hover */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
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
                  <Button
                    size="sm"
                    onClick={() => handleUseAsSource(img, idx)}
                  >
                    Edit
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
              </div>
            );
          })}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="animate-spin text-4xl">🍌</div>
              <div className="text-gray-500 dark:text-tokyo-muted">
                {sourceImage ? "Editing image..." : "Generating image..."}
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
        <Textarea
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              console.log("Keyboard shortcut triggered");
              handleGenerate();
            }
          }}
          placeholder={
            sourceImage
              ? "Describe how to edit this image... (Ctrl+Enter)"
              : "Describe the image you want to create... (Ctrl+Enter)"
          }
          rows={3}
          className="w-full min-h-[100px] max-h-[300px] resize-y"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button onClick={handleLoadImage} size="sm">
              Load Image
            </Button>
            {sourceImage && (
              <span className="text-xs text-indigo-600 dark:text-indigo-400">
                Editing: {sourceImage.name}
              </span>
            )}
            {activeProject && (
              <span className="text-xs text-indigo-500 dark:text-indigo-400">
                Saving to: {activeProject}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {!apiKey && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                ⚠️ AI Studio API key required
              </span>
            )}
            {apiKey && !prompt.trim() && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Enter a description
              </span>
            )}
            <Button
              onClick={handleGenerate}
              disabled={isLoading || !prompt.trim() || !apiKey}
            >
              {isLoading ? "Processing..." : sourceImage ? "Edit Image" : "Generate"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

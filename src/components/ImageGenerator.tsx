import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { Button, TextArea } from "./index";

interface ImageGeneratorProps {
  apiKey: string;
  onGenerateImage: (options: { prompt: string; apiKey: string; editImage?: string }) => Promise<string | undefined>;
  generatedImages: string[];
  isLoading: boolean;
  error: string | null;
  activeProject: string | null;
}

export function ImageGenerator({
  apiKey,
  onGenerateImage,
  generatedImages,
  isLoading,
  error,
  activeProject,
}: ImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<{
    data: string;
    name: string;
  } | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);

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
        setSourceImage({
          data: base64,
          name: selected.split("/").pop() || "image",
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
      const filename = `image-${timestamp}.png`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_image_to_project", {
          projectPath,
          filename,
          imageBase64,
        });
        setSavedIdx(index);
        setTimeout(() => setSavedIdx(null), 2000);
      } else {
        const filePath = await save({
          filters: [{ name: "PNG Image", extensions: ["png"] }],
          defaultPath: `generated-image-${index + 1}.png`,
        });

        if (filePath) {
          const binaryString = atob(imageBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          await writeFile(filePath, bytes);
          setSavedIdx(index);
          setTimeout(() => setSavedIdx(null), 2000);
        }
      }
    } catch (e) {
      console.error("Failed to save image:", e);
    }
  };

  const handleUseAsSource = (imageBase64: string, index: number) => {
    setSourceImage({
      data: imageBase64,
      name: `generated-${index + 1}`,
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {generatedImages.length === 0 && !isLoading && !sourceImage && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-tokyo-muted gap-4">
            <div className="text-6xl">🍌</div>
            <div className="text-center">
              <div className="text-lg font-medium">Nano Banana Pro</div>
              <div className="text-sm">Generate and edit images with AI</div>
              <div className="text-xs mt-2 text-gray-500">
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
                src={`data:image/png;base64,${sourceImage.data}`}
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
          {generatedImages.map((img, idx) => (
            <div key={idx} className="relative group">
              <img
                src={`data:image/png;base64,${img}`}
                alt={`Generated ${idx + 1}`}
                className="w-full rounded-lg shadow-lg"
              />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                <Button
                  variant="primary"
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
              </div>
            </div>
          ))}
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

      <div className="border-t border-gray-200 dark:border-tokyo-border p-4 space-y-3">
        <TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            sourceImage
              ? "Describe how to edit this image... (e.g., 'add a sunset background', 'make it look like a painting')"
              : "Describe the image you want to create..."
          }
          rows={3}
          className="w-full"
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
            <div className="text-xs text-gray-500 dark:text-tokyo-muted">
              Nano Banana Pro
            </div>
            <Button
              variant="primary"
              onClick={handleGenerate}
              disabled={isLoading || !prompt.trim() || !apiKey}
            >
              {isLoading
                ? "Processing..."
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

import { useState, useRef } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { Button, TextArea, Select } from "./index";
import { MODELS } from "../models";

interface DeepResearchPanelProps {
  apiKey: string;
  isLoading: boolean;
  error: string | null;
  activeProject: string | null;
  onSendMessage: (
    prompt: string,
    options: {
      model: typeof MODELS[string];
      endpoint: "ai_studio";
      apiKey: string;
      projectId: string;
      thinkingLevel?: string;
    }
  ) => Promise<string | undefined>;
}

export function DeepResearchPanel({
  apiKey,
  isLoading,
  error,
  activeProject,
  onSendMessage,
}: DeepResearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState("medium");
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const deepResearchModel = MODELS["gemini-deep-research"];

  const thinkingOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  const handleResearch = async () => {
    if (!query.trim() || !apiKey) return;

    const result = await onSendMessage(
      query,
      {
        model: deepResearchModel,
        endpoint: "ai_studio",
        apiKey,
        projectId: "",
        thinkingLevel,
      }
    );

    if (result) {
      setResults(prev => [...prev, result]);
      setQuery("");
      resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleCopy = async (content: string, idx: number) => {
    try {
      await writeText(content);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleSave = async (content: string, idx: number) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `research-${timestamp}.md`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", { projectPath, subfolder: "outputs", filename, content });
      } else {
        await invoke("save_output", { content, filename });
      }

      setSavedIdx(idx);
      setTimeout(() => setSavedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  };

  const handleClear = () => {
    setResults([]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {results.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-4">
            <div className="text-6xl">🔬</div>
            <div className="text-center">
              <div className="text-lg font-medium">Gemini Deep Research</div>
              <div className="text-sm">Multi-step web research with source synthesis</div>
              <div className="text-xs mt-4 max-w-md text-center">
                Enter a research question and the agent will search the web,
                analyze multiple sources, and synthesize a comprehensive answer
                with citations.
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {results.map((result, idx) => (
            <div key={idx} className="group relative">
              <div className="theme-surface border theme-border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b theme-border">
                  <span className="text-lg">🔬</span>
                  <span className="text-sm font-medium theme-text">Research Result #{idx + 1}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed theme-text">
                  {result}
                </pre>
              </div>
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                <button
                  onClick={() => handleCopy(result, idx)}
                  className="p-1.5 rounded-lg theme-surface theme-hover theme-text-muted"
                  title="Copy"
                >
                  {copiedIdx === idx ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => handleSave(result, idx)}
                  className="p-1.5 rounded-lg theme-surface theme-hover theme-text-muted"
                  title={activeProject ? `Save to ${activeProject}` : "Save to Downloads"}
                >
                  {savedIdx === idx ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-4">
              <div className="animate-pulse text-4xl">🔬</div>
              <div className="theme-text-muted">Researching...</div>
              <div className="text-xs theme-text-muted max-w-xs text-center">
                The agent is searching the web and analyzing sources. This may take a moment.
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm mt-4">
            {error}
          </div>
        )}

        <div ref={resultsEndRef} />
      </div>

      <div className="border-t theme-border p-4 space-y-3 theme-surface">
        <TextArea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your research question... (e.g., 'What are the latest developments in quantum computing?')"
          rows={3}
          className="w-full"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {results.length > 0 && (
              <Button onClick={handleClear} size="sm">
                Clear Results
              </Button>
            )}
            {activeProject && (
              <span className="text-xs theme-accent">
                Project: {activeProject}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Select
              label="Thinking"
              options={thinkingOptions}
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value)}
              className="min-w-[90px]"
            />
            <div className="text-xs theme-text-muted">
              {query.length} chars
            </div>
            <Button
              variant="primary"
              onClick={handleResearch}
              disabled={isLoading || !query.trim() || !apiKey}
            >
              {isLoading ? "Researching..." : "Research"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

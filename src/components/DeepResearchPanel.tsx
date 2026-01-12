import { useState, useRef } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ResearchTask } from "../hooks/useResearchSessions";

interface DeepResearchPanelProps {
  apiKey: string;
  activeProject: string | null;
  research: {
    tasks: ResearchTask[];
    runningTasks: ResearchTask[];
    completedTasks: ResearchTask[];
    startResearch: (query: string, apiKey: string) => Promise<string>;
    dismissTask: (taskId: string) => void;
    clearCompleted: () => void;
  };
}

export function DeepResearchPanel({
  apiKey,
  activeProject,
  research,
}: DeepResearchPanelProps) {
  const [query, setQuery] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [savedIdx, setSavedIdx] = useState<string | null>(null);
  const [saveFormat, setSaveFormat] = useState<"md" | "txt">("md");
  const [thinkingLevel, setThinkingLevel] = useState("medium");
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const thinkingOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  const handleResearch = async () => {
    if (!query.trim() || !apiKey) {
      return;
    }

    await research.startResearch(query, apiKey);
    setQuery("");
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleCopy = async (content: string, taskId: string) => {
    try {
      await writeText(content);
      setCopiedIdx(taskId);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleSave = async (content: string, taskId: string) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const ext = saveFormat;
      const filename = `research-${timestamp}.${ext}`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", { projectPath, subfolder: "outputs", filename, content });
      } else {
        await invoke("save_output", { content, filename });
      }

      setSavedIdx(taskId);
      setTimeout(() => setSavedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {/* Running tasks indicator */}
        {research.runningTasks.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
              <span className="font-medium">{research.runningTasks.length} research task(s) running</span>
            </div>
            <div className="mt-2 space-y-1">
              {research.runningTasks.map(task => (
                <div key={task.id} className="text-xs text-blue-600/80 dark:text-blue-400/80 truncate">
                  • {task.query}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {research.tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-6">
            <div className="text-8xl">🔬</div>
            <div className="text-center">
              <div className="text-2xl font-semibold">Gemini Deep Research</div>
              <div className="text-lg mt-1">Multi-step web research with source synthesis</div>
              <div className="text-base mt-4 max-w-lg text-center leading-relaxed">
                Enter a research question and the agent will search the web,
                analyze multiple sources, and synthesize a comprehensive answer
                with citations. You can switch tabs while research runs.
              </div>
              <div className="text-sm mt-3 text-amber-600 dark:text-amber-400">
                ⚠️ Research can take several minutes to complete
              </div>
            </div>
          </div>
        )}

        {/* Results - only show completed/failed tasks, running ones are in the indicator above */}
        <div className="space-y-4">
          {research.completedTasks.map((task) => (
            <div key={task.id} className="theme-surface border theme-border rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b theme-border bg-gray-50 dark:bg-gray-800/50">
                {task.status === "failed" ? (
                  <span className="text-lg">❌</span>
                ) : (
                  <span className="text-lg">🔬</span>
                )}
                <span className="text-sm font-medium theme-text flex-1 truncate">{task.query}</span>
                <span className="text-xs theme-text-muted">
                  {new Date(task.completedAt || task.startedAt).toLocaleTimeString()}
                </span>
              </div>

              {/* Content */}
              <div className="p-4">
                {task.status === "failed" && (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    {task.error || "Research failed"}
                  </div>
                )}

                {task.status === "completed" && task.result && (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed theme-text">
                    {task.result}
                  </pre>
                )}
              </div>

              {/* Action buttons - always visible at bottom */}
              <div className="flex items-center gap-2 px-4 py-2 border-t theme-border bg-gray-50 dark:bg-gray-800/50">
                {task.result && (
                  <>
                    <button
                      onClick={() => handleCopy(task.result!, task.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text"
                    >
                      {copiedIdx === task.id ? (
                        <>
                          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        console.log("Save clicked for task:", task.id);
                        handleSave(task.result!, task.id);
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text"
                    >
                      {savedIdx === task.id ? (
                        <>
                          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Saved!
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                          </svg>
                          Save .{saveFormat}
                        </>
                      )}
                    </button>
                  </>
                )}
                <div className="flex-1"></div>
                <button
                  onClick={() => research.dismissTask(task.id)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div ref={resultsEndRef} />
      </div>

      <div className="border-t theme-border p-4 space-y-3 theme-surface">
        <Textarea
          value={query}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
          placeholder="Enter your research question... (e.g., 'What are the latest developments in quantum computing?')"
          rows={3}
          className="w-full resize-none"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {research.completedTasks.length > 0 && (
              <Button onClick={research.clearCompleted} size="sm">
                Clear Completed
              </Button>
            )}
            {activeProject && (
              <span className="text-xs theme-accent">
                Project: {activeProject}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Save format selector */}
            <select
              value={saveFormat}
              onChange={(e) => setSaveFormat(e.target.value as "md" | "txt")}
              className="text-xs px-2 py-1 rounded theme-surface theme-border border"
              title="Save format"
            >
              <option value="md">Markdown (.md)</option>
              <option value="txt">Text (.txt)</option>
            </select>

            {/* Thinking level selector */}
            <select
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value)}
              className="text-xs px-2 py-1 rounded theme-surface theme-border border"
              title="Thinking Level"
            >
              {thinkingOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <div className="text-sm theme-text-muted">
              {query.length} chars
            </div>
            {!apiKey && (
              <span className="text-sm text-amber-600 dark:text-amber-400">
                ⚠️ API key required
              </span>
            )}
            {apiKey && !query.trim() && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Enter a question
              </span>
            )}
            <Button
              onClick={handleResearch}
              disabled={!query.trim() || !apiKey}
            >
              Research
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

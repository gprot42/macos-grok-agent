import { useState, useRef, useEffect } from "react";
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
    startResearch: (query: string, apiKey: string, timeoutMinutes?: number) => Promise<string>;
    cancelTask: (taskId: string) => void;
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
  const [lastQuery, setLastQuery] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);
  const [savedIdx, setSavedIdx] = useState<string | null>(null);
  const [saveFormat] = useState<"md" | "txt">("md");
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [depthLevel, setDepthLevel] = useState<"low" | "medium" | "high">("medium");
  const resultsEndRef = useRef<HTMLDivElement>(null);

  const depthConfig = {
    low: { timeout: 30, label: "Quick (30 min)" },
    medium: { timeout: 60, label: "Standard (60 min)" },
    high: { timeout: 120, label: "Deep (120 min)" },
  };

  const handleDepthChange = (level: "low" | "medium" | "high") => {
    setDepthLevel(level);
    setTimeoutMinutes(depthConfig[level].timeout);
  };

  // Real-time elapsed timer component
  function ElapsedTimer({ startedAt }: { startedAt: number }) {
    const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startedAt) / 1000));

    useEffect(() => {
      const interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }, [startedAt]);

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return (
      <span className="font-mono">
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
    );
  }



  const handleResearch = async () => {
    if (!query.trim() || !apiKey) {
      return;
    }

    setLastQuery(query);
    await research.startResearch(query, apiKey, timeoutMinutes);
    setQuery("");
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleResend = () => {
    if (lastQuery) {
      setQuery(lastQuery);
    }
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
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {/* Running tasks indicator */}
        {research.runningTasks.length > 0 && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full"></div>
              <span className="font-medium">{research.runningTasks.length} research task(s) running</span>
            </div>
            <div className="mt-2 space-y-2">
              {research.runningTasks.map(task => (
                <div key={task.id} className="flex items-center justify-between text-sm text-blue-700 dark:text-blue-300">
                  <span className="truncate flex-1 mr-3">• {task.query}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                      <ElapsedTimer startedAt={task.startedAt} />
                    </span>
                    <button
                      onClick={() => research.cancelTask(task.id)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 hover:text-red-600 transition-colors"
                      title="Cancel research"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
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
              <div className="text-xl mt-1">Multi-step web research with source synthesis</div>
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
                ) : task.status === "cancelled" ? (
                  <span className="text-lg">🚫</span>
                ) : (
                  <span className="text-lg">🔬</span>
                )}
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100 flex-1 truncate">{task.query}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(task.completedAt || task.startedAt).toLocaleTimeString()}
                </span>
              </div>

              {/* Content */}
              <div className="p-4">
                {(task.status === "failed" || task.status === "cancelled") && (
                  <div className="text-base text-red-600 dark:text-red-400">
                    {task.error || "Research failed"}
                  </div>
                )}

                {task.status === "completed" && task.result && (
                  <pre className="whitespace-pre-wrap font-sans text-base leading-relaxed theme-text">
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

      <div className="border-t theme-border p-3 theme-surface space-y-2">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs theme-text-muted">Depth:</span>
          <div className="flex gap-1">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                key={level}
                onClick={() => handleDepthChange(level)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  depthLevel === level
                    ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2">
            <span className="text-xs theme-text-muted">Timeout:</span>
            <select
              value={timeoutMinutes}
              onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
              className="text-xs px-2 py-1 rounded-md border theme-border bg-white dark:bg-gray-800 theme-text"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>60 min</option>
              <option value={90}>90 min</option>
              <option value={120}>120 min</option>
              <option value={180}>180 min</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2 items-start">
          <Textarea
            value={query}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setQuery(e.target.value)}
            placeholder="Enter your research question..."
            className="flex-1 resize-none text-sm min-h-[96px]"
            rows={4}
          />
          <div className="flex flex-col gap-1">
            <Button
              onClick={handleResearch}
              disabled={!query.trim() || !apiKey}
              size="sm"
              className="h-10 px-3"
            >
              Go
            </Button>
            <Button onClick={handleResend} size="sm" variant="outline" className="h-10 px-2" disabled={!lastQuery || research.runningTasks.length > 0} title="Resend last query">
              ↻
            </Button>
            <Button 
              onClick={research.clearCompleted} 
              size="sm" 
              variant="outline" 
              className="h-10 px-3"
              disabled={research.completedTasks.length === 0}
              title="Clear all results"
            >
              Clear
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

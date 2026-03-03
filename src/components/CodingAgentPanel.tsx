import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Code2, Square, FolderOpen, FolderPlus, Terminal, FileText,
  FilePen, FolderTree, ChevronDown, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, Send,
} from "lucide-react";
import { MODELS } from "@/models";
import type { ModelConfig, EndpointType } from "@/types";

interface ToolCallEntry {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  expanded: boolean;
}

interface AgentMessage {
  id: string;
  type: "user" | "assistant-text" | "thinking" | "tool-call" | "tool-result" | "error" | "complete";
  content: string;
  toolData?: ToolCallEntry;
  iteration?: number;
}

interface CodingAgentPanelProps {
  apiKey: string;
  projectId: string;
  selectedModel: ModelConfig;
  selectedEndpoint: EndpointType;
  activeProject: string | null;
}

const TOOL_ICONS: Record<string, typeof Code2> = {
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  run_command: Terminal,
  list_directory: FolderTree,
};

const CODING_CAPABLE_IDS = new Set([
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-sonnet-4",
  "gemini-3-1-pro",
  "gemini-3-1-pro-customtools",
  "gemini-3-flash-preview",
  "gemini-2-5-pro",
  "gemini-2-5-flash",
]);

const CODING_MODELS = Object.values(MODELS).filter(
  (m: ModelConfig) => CODING_CAPABLE_IDS.has(m.id)
);

export function CodingAgentPanel({
  apiKey,
  projectId,
  selectedEndpoint,
  activeProject,
}: CodingAgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);
  const [workingDir, setWorkingDir] = useState("");
  const [model, setModel] = useState<ModelConfig>(
    CODING_MODELS.find((m: ModelConfig) => m.id === "gemini-3-1-pro-customtools") || CODING_MODELS[0]
  );
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    if (!workingDir) {
      const home = "/Users/" + (typeof process !== "undefined" ? "user" : "aicoder");
      setWorkingDir(activeProject ? `${home}/Projects` : `${home}/Desktop/codegen-output`);
    }
  }, [activeProject, workingDir]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const addMessage = useCallback((msg: Omit<AgentMessage, "id">) => {
    setMessages((prev) => [...prev, { ...msg, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
  }, []);

  const setupListeners = useCallback(async () => {
    const u1 = await listen<{ text: string; iteration: number }>("coding-agent-text", (e) => {
      console.log(`[CodingAgent:TEXT] iter=${e.payload.iteration}:`, e.payload.text.slice(0, 100));
      addMessage({ type: "assistant-text", content: e.payload.text, iteration: e.payload.iteration });
    });
    const u2 = await listen<{ text: string; iteration: number }>("coding-agent-thinking", (e) => {
      console.log(`[CodingAgent:THINK] iter=${e.payload.iteration}`);
      addMessage({ type: "thinking", content: e.payload.text, iteration: e.payload.iteration });
    });
    const u3 = await listen<{ tool: string; input: Record<string, unknown>; tool_use_id: string; iteration: number }>(
      "coding-agent-tool-call",
      (e) => {
        console.log(`[CodingAgent:TOOL] ${e.payload.tool}`, e.payload.input);
        addMessage({
          type: "tool-call",
          content: `${e.payload.tool}`,
          toolData: {
            id: e.payload.tool_use_id,
            tool: e.payload.tool,
            input: e.payload.input,
            expanded: false,
          },
          iteration: e.payload.iteration,
        });
      }
    );
    const u4 = await listen<{ tool: string; result: string; is_error: boolean; tool_use_id: string; iteration: number }>(
      "coding-agent-tool-result",
      (e) => {
        addMessage({
          type: "tool-result",
          content: e.payload.result,
          toolData: {
            id: e.payload.tool_use_id,
            tool: e.payload.tool,
            input: {},
            result: e.payload.result,
            isError: e.payload.is_error,
            expanded: false,
          },
          iteration: e.payload.iteration,
        });
      }
    );
    const u5 = await listen<{ iteration: number; stop_reason: string }>("coding-agent-complete", (e) => {
      addMessage({
        type: "complete",
        content: `Completed in ${e.payload.iteration + 1} iteration(s)`,
        iteration: e.payload.iteration,
      });
    });
    const u6 = await listen<{ msg: string; iteration?: number }>("coding-agent-debug", (e) => {
      console.log(`%c[CodingAgent]%c ${e.payload.msg}`, "color: #f59e0b; font-weight: bold", "color: inherit");
    });

    unlistenRefs.current = [u1, u2, u3, u4, u5, u6];
  }, [addMessage]);

  const cleanupListeners = useCallback(() => {
    unlistenRefs.current.forEach((u) => u());
    unlistenRefs.current = [];
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || running) return;

    const userPrompt = prompt.trim();
    setPrompt("");
    addMessage({ type: "user", content: userPrompt });
    setRunning(true);

    const newHistory = [...conversationHistory, { role: "user", content: userPrompt }];
    setConversationHistory(newHistory);

    await setupListeners();

    try {
      const endpoint = model.endpointSupport.includes(selectedEndpoint)
        ? selectedEndpoint
        : model.endpointSupport[0];

      await invoke("coding_agent_chat", {
        messages: newHistory,
        modelId: model.modelId,
        publisher: model.publisher,
        endpoint,
        apiKey,
        projectId,
        workingDir,
      });
    } catch (e) {
      addMessage({ type: "error", content: String(e) });
      setPrompt(userPrompt);
      setConversationHistory(conversationHistory);
    } finally {
      cleanupListeners();
      setRunning(false);
    }
  }, [prompt, running, conversationHistory, model, selectedEndpoint, apiKey, projectId, workingDir, addMessage, setupListeners, cleanupListeners]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleToolExpand = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNewSession = () => {
    setMessages([]);
    setConversationHistory([]);
  };

  const pickDirectory = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Select Working Directory" });
      if (selected && typeof selected === "string") {
        setWorkingDir(selected);
      }
    } catch {
      const dir = window.prompt("Enter working directory path:", workingDir);
      if (dir) setWorkingDir(dir);
    }
  };

  const createSubDirectory = async () => {
    const name = window.prompt("New folder name:", "");
    if (!name?.trim()) return;
    const newDir = `${workingDir}/${name.trim()}`;
    try {
      const { mkdir } = await import("@tauri-apps/plugin-fs");
      await mkdir(newDir, { recursive: true });
    } catch {
      try {
        await invoke("run_shell", { command: `mkdir -p "${newDir}"` });
      } catch {
        // best-effort
      }
    }
    setWorkingDir(newDir);
  };

  const renderMessage = (msg: AgentMessage) => {
    switch (msg.type) {
      case "user":
        return (
          <div key={msg.id} className="flex justify-end mb-3">
            <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-blue-500 text-white text-sm whitespace-pre-wrap">
              {msg.content}
            </div>
          </div>
        );

      case "assistant-text":
        return (
          <div key={msg.id} className="mb-3">
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm theme-surface border theme-border text-sm whitespace-pre-wrap theme-text leading-relaxed">
              {msg.content}
            </div>
          </div>
        );

      case "thinking":
        return (
          <div key={msg.id} className="mb-2 px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
            <div className="text-xs font-medium text-purple-500 mb-1">Thinking</div>
            <div className="text-xs text-purple-700 dark:text-purple-300 whitespace-pre-wrap max-h-32 overflow-y-auto">
              {msg.content.length > 500 ? msg.content.slice(0, 500) + "..." : msg.content}
            </div>
          </div>
        );

      case "tool-call": {
        const td = msg.toolData!;
        const Icon = TOOL_ICONS[td.tool] || Code2;
        const isExpanded = expandedTools.has(td.id);
        return (
          <div key={msg.id} className="mb-2">
            <button
              onClick={() => toggleToolExpand(td.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm w-full text-left hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Icon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="font-mono text-xs font-medium text-amber-700 dark:text-amber-300">{td.tool}</span>
              <span className="text-xs theme-text-muted truncate flex-1">
                {td.tool === "run_command" && typeof td.input.command === "string"
                  ? td.input.command
                  : td.tool === "write_file" || td.tool === "read_file" || td.tool === "edit_file"
                    ? String(td.input.path || "")
                    : td.tool === "list_directory"
                      ? String(td.input.path || ".")
                      : ""}
              </span>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
            </button>
            {isExpanded && (
              <div className="mt-1 ml-6 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border theme-border">
                <pre className="text-xs font-mono theme-text-muted whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {JSON.stringify(td.input, null, 2)}
                </pre>
              </div>
            )}
          </div>
        );
      }

      case "tool-result": {
        const td = msg.toolData!;
        const Icon = TOOL_ICONS[td.tool] || Code2;
        const isExpanded = expandedTools.has(`result-${td.id}`);
        const isError = td.isError;
        return (
          <div key={msg.id} className="mb-2">
            <button
              onClick={() => toggleToolExpand(`result-${td.id}`)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm w-full text-left transition-colors ${
                isError
                  ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 hover:bg-red-100"
                  : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 hover:bg-green-100"
              }`}
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {isError
                ? <AlertCircle className="h-4 w-4 text-red-500" />
                : <CheckCircle2 className="h-4 w-4 text-green-500" />}
              <Icon className="h-3.5 w-3.5 theme-text-muted" />
              <span className="font-mono text-xs font-medium theme-text-muted">{td.tool}</span>
              <span className="text-xs theme-text-muted">
                {isError ? "failed" : "done"}
              </span>
            </button>
            {isExpanded && td.result && (
              <div className="mt-1 ml-6 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 border theme-border">
                <pre className="text-xs font-mono theme-text-muted whitespace-pre-wrap max-h-64 overflow-y-auto">
                  {td.result.length > 3000 ? td.result.slice(0, 3000) + "\n...[truncated]" : td.result}
                </pre>
              </div>
            )}
          </div>
        );
      }

      case "error":
        return (
          <div key={msg.id} className="mb-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            <div className="flex items-center gap-2 font-medium mb-1">
              <AlertCircle className="h-4 w-4" />
              Error
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        );

      case "complete":
        return (
          <div key={msg.id} className="mb-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 text-sm">
            <CheckCircle2 className="h-4 w-4" />
            {msg.content}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-6">
            <Code2 className="h-20 w-20 opacity-20" />
            <div className="text-center max-w-lg">
              <div className="text-2xl font-semibold mb-2">Coding Agent</div>
              <div className="text-base mb-4">
                Describe what you want to build or modify. The agent will create files,
                run commands, and iterate until it works.
              </div>
              <div className="grid grid-cols-3 gap-3 text-left text-sm">
                <div className="p-3 rounded-xl border theme-border theme-surface">
                  <FilePen className="h-4 w-4 mb-1.5 text-blue-500" />
                  <div className="font-medium theme-text">Read, Write & Edit</div>
                  <div className="text-xs theme-text-muted mt-1">Creates and modifies files directly on disk</div>
                </div>
                <div className="p-3 rounded-xl border theme-border theme-surface">
                  <Terminal className="h-4 w-4 mb-1.5 text-green-500" />
                  <div className="font-medium theme-text">Run Commands</div>
                  <div className="text-xs theme-text-muted mt-1">Installs deps, builds, tests, runs scripts</div>
                </div>
                <div className="p-3 rounded-xl border theme-border theme-surface">
                  <AlertCircle className="h-4 w-4 mb-1.5 text-amber-500" />
                  <div className="font-medium theme-text">Auto-Fix</div>
                  <div className="text-xs theme-text-muted mt-1">Detects errors and fixes them automatically</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {messages.map(renderMessage)}
        {running && messages[messages.length - 1]?.type !== "tool-call" && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm theme-text">
            <Loader2 className="h-4 w-4 animate-spin" />
            Agent is working...
          </div>
        )}
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <select
            value={model.id}
            onChange={(e) => {
              const found = CODING_MODELS.find((cm: ModelConfig) => cm.id === e.target.value);
              if (found) setModel(found);
            }}
            className="px-2 py-1.5 rounded-lg border theme-border theme-surface theme-text focus:outline-none focus:ring-1 focus:ring-blue-500 text-xs"
          >
            {CODING_MODELS.map((cm: ModelConfig) => {
              const endpoints = cm.endpointSupport
                .map((e: string) =>
                  e === "vertex_ai" ? "Vertex" : e === "ai_studio" ? "AI Studio" : e
                )
                .join(" | ");
              return (
                <option key={cm.id} value={cm.id}>
                  {cm.displayName} ({endpoints})
                </option>
              );
            })}
          </select>

          <button
            onClick={pickDirectory}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-xs truncate max-w-[350px]"
            title={`Output directory: ${workingDir}\nClick to change`}
          >
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="font-medium">Output:</span>
            {workingDir.split("/").slice(-2).join("/")}
          </button>

          <button
            onClick={createSubDirectory}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border theme-border theme-surface theme-text-muted hover:text-green-600 hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors text-xs"
            title="Create new subfolder in output directory"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </button>

          <div className="flex-1" />

          {messages.length > 0 && (
            <button
              onClick={handleNewSession}
              disabled={running}
              className="px-2.5 py-1.5 rounded-lg text-xs theme-text-muted hover:theme-text hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              New Session
            </button>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={messages.length === 0
              ? "Describe what you want to build..."
              : "Ask for changes, fixes, or new features..."}
            className="flex-1 resize-none rounded-xl border theme-border theme-surface theme-text px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[120px] max-h-[200px] scrollbar-thin"
            rows={5}
            disabled={running}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 200) + "px";
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || running}
            className="flex items-center justify-center h-[44px] w-[44px] rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
          >
            {running ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

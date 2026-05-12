import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  Code2, Square, FolderOpen, Terminal, FileText,
  FilePen, FolderTree, ChevronDown, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, Send, Trash2, ImagePlus, X, Globe,
  Bug, Plug, Play, Clock, Files, Sparkles, Bot,
} from "lucide-react";
import { useSubAgent, type SubAgentFinding } from "@/hooks";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { DebugLogPanel } from "./DebugLogPanel";
import { McpPanel } from "./McpPanel";
import { FileHistoryPanel, FileHistory, FileVersion } from "./FileHistoryPanel";
import { SkillsPanel } from "./SkillsPanel";
import { MODELS } from "@shared/constants/models";
import type { ModelConfig, EndpointType } from "@shared/types";

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
  type: "user" | "assistant-text" | "thinking" | "tool-call" | "tool-result" | "error" | "complete" | "info" | "sub-agent";
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
  agentTimeout?: number;
  showCosts?: boolean;
  /** When true (default), rm/rmdir/unlink in run_command are soft-blocked. */
  blockFileDeletion?: boolean;
}

const TOOL_ICONS: Record<string, typeof Code2> = {
  read_file: FileText,
  write_file: FilePen,
  edit_file: FilePen,
  delete_file: Trash2,
  run_command: Terminal,
  list_directory: FolderTree,
  fetch_url: Globe,
};

// ── Code-block parser ─────────────────────────────────────────────────────────

type TextPart = { type: "text"; content: string };
type CodePart = { type: "code"; language: string; content: string };
type MessagePart = TextPart | CodePart;

function parseCodeBlocks(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", language: match[1].trim().toLowerCase(), content: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}

const CODING_MODELS = Object.values(MODELS).filter(
  (m: ModelConfig) => m.publisher === "xai" && m.endpointSupport.includes("xai") && !m.supportsImageGeneration && !m.supportsVideoGeneration && !m.supportsTextToSpeech
);

export function CodingAgentPanel({
  apiKey,
  projectId,
  selectedEndpoint,
  activeProject,
  agentTimeout,
  showCosts = true,
  blockFileDeletion = true,
}: CodingAgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"code" | "plan">("code");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [workingDir, setWorkingDir] = useState("");
  const [model, setModel] = useState<ModelConfig>(
    CODING_MODELS.find((m: ModelConfig) => m.id === "grok-4-3") || CODING_MODELS[0]
  );
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [attachedImage, setAttachedImage] = useState<{ data: string; mimeType: string; name: string } | null>(null);
  const [showDebugLog, setShowDebugLog] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [activeSkillPaths, setActiveSkillPaths] = useState<string[]>([]);
  const [thinkingLevel, setThinkingLevel] = useState<string>(
    () => model?.defaultThinkingLevel ?? (model?.supportsDeepThinking ? "low" : "none")
  );
  const [lastSessionTokens, setLastSessionTokens] = useState<{ input: number; output: number } | null>(null);

  // ── Feature 2: File history ───────────────────────────────────────────────
  const [fileHistory, setFileHistory] = useState<FileHistory>(new Map());

  // ── Feature 3: Context files ──────────────────────────────────────────────
  const [contextFiles, setContextFiles] = useState<Array<{ name: string; path: string; content: string }>>([]);

  // ── Feature 1: Code execution results keyed by message id ────────────────
  const [execResults, setExecResults] = useState<Map<string, { stdout: string; stderr: string; exitCode: number; durationMs: number; running: boolean }>>(new Map());

  // ── Sub-agent: error detection on tool/command output ────────────────────
  const { analyzeCommandOutput } = useSubAgent();
  /** Most recent finding detected during the current agent run. */
  const pendingFindingRef = useRef<SubAgentFinding | null>(null);
  /** Label of the finding that drove the previous retry — used to detect no-progress loops. */
  const previousFindingLabelRef = useRef<string | null>(null);
  /** Number of consecutive retries that fired with the same finding label. */
  const consecutiveSameLabelRef = useRef(0);
  /** How many consecutive sub-agent retries have fired (reset on new user prompt). */
  const subAgentRetryCount = useRef(0);
  const MAX_SUBAGENT_RETRIES = 3;

  /** Always-current mirror of conversationHistory for use inside event listeners. */
  const conversationHistoryRef = useRef<Record<string, unknown>[]>([]);
  /** Always-current snapshot of invoke params for sub-agent retries. */
  const agentParamsRef = useRef({
    model, selectedEndpoint, apiKey, projectId, workingDir, agentTimeout, mode, thinkingLevel, activeSkillPaths, blockFileDeletion,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  // Request notification permission once on mount
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const sendNotification = (title: string, body: string) => {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icons/128x128.png" });
    }
  };

  // Init working dir: saved path > CORTEX_LAUNCH_DIR/CWD fallback
  useEffect(() => {
    if (workingDir) return; // already set
    (async () => {
      // Try the persisted value first
      const saved = await invoke<string | null>("load_working_dir").catch(() => null);
      if (saved) {
        setWorkingDir(saved);
        return;
      }
      // Fall back to launch-time default
      const def = await invoke<string>("get_default_working_dir", {
        activeProject: activeProject || null,
      }).catch(() => "");
      if (def) setWorkingDir(def);
    })();
  }, [activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    conversationHistoryRef.current = conversationHistory;
  }, [conversationHistory]);

  useEffect(() => {
    agentParamsRef.current = {
      model, selectedEndpoint, apiKey, projectId, workingDir, agentTimeout, mode, thinkingLevel, activeSkillPaths, blockFileDeletion,
    };
  }, [model, selectedEndpoint, apiKey, projectId, workingDir, agentTimeout, mode, thinkingLevel, activeSkillPaths, blockFileDeletion]);

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

        // Feature 2: snapshot write_file / edit_file content into history
        const tool = e.payload.tool;
        if (tool === "write_file" || tool === "edit_file") {
          const path = String(e.payload.input.path ?? "");
          const content = String(e.payload.input.content ?? e.payload.input.new_content ?? "");
          if (path && content) {
            const version: FileVersion = {
              content,
              timestamp: Date.now(),
              iteration: e.payload.iteration,
              operation: tool === "write_file" ? "write" : "edit",
            };
            setFileHistory((prev) => {
              const next = new Map(prev);
              const existing = next.get(path) ?? [];
              next.set(path, [...existing, version]);
              return next;
            });
          }
        }
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

        // Sub-agent: scan all command/tool output for known error patterns
        const finding = analyzeCommandOutput(e.payload.result);
        if (finding) {
          pendingFindingRef.current = finding;
          addMessage({
            type: "sub-agent",
            content: `**${finding.label}** — ${finding.hint}`,
            iteration: e.payload.iteration,
          });
        }
      }
    );
    const u5 = await listen<{ iteration: number; stop_reason: string; totalInputTokens?: number; totalOutputTokens?: number }>("coding-agent-complete", async (e) => {
      const iters = e.payload.iteration + 1;
      const totalIn = e.payload.totalInputTokens ?? 0;
      const totalOut = e.payload.totalOutputTokens ?? 0;
      if (totalIn > 0 || totalOut > 0) {
        setLastSessionTokens({ input: totalIn, output: totalOut });
      }

      // ── Sub-agent retry loop ───────────────────────────────────────────────
      const finding = pendingFindingRef.current;
      pendingFindingRef.current = null;

      if (finding && subAgentRetryCount.current < MAX_SUBAGENT_RETRIES) {
        subAgentRetryCount.current += 1;

        // Loop detection: same error label firing again means the previous fix didn't work.
        const sameAsPrevious = previousFindingLabelRef.current === finding.label;
        if (sameAsPrevious) consecutiveSameLabelRef.current += 1;
        else consecutiveSameLabelRef.current = 0;
        previousFindingLabelRef.current = finding.label;

        const escalation =
          consecutiveSameLabelRef.current >= 1
            ? `\n\n⚠️ STOP — this is the SAME error as the previous retry (${consecutiveSameLabelRef.current + 1}× in a row). ` +
              `Your previous fix did NOT resolve it. ` +
              `Do NOT repeat the same approach. ` +
              `Specifically: do NOT edit build.sh again, do NOT just re-run the build without changes, do NOT claim the error is "unrelated". ` +
              `The error is in the project's .gradle source files — locate them, read them, and edit them now.`
            : '';

        const retryPrompt =
          `[Sub-agent retry ${subAgentRetryCount.current}/${MAX_SUBAGENT_RETRIES}] ` +
          `The previous run ended without resolving this error:\n\n` +
          `**${finding.label}**\n${finding.hint}\n\n` +
          `Failing command output (last excerpt):\n` +
          "```\n" + finding.rawOutput + "\n```\n\n" +
          `Investigate the root cause shown in the output above, fix the underlying problem in the source files (do not just patch build.sh to mask the failure), then re-run the build to confirm it succeeds. ` +
          `If the same error recurs, try a different fix — do not repeat the previous attempt.` +
          escalation;

        addMessage({
          type: "sub-agent",
          content: `Auto-retrying (${subAgentRetryCount.current}/${MAX_SUBAGENT_RETRIES})${sameAsPrevious ? ' — same error, escalating' : ''} — **${finding.label}**\n\n${finding.hint}`,
        });

        const history = conversationHistoryRef.current;
        const newHistory = [...history, { role: "user", content: retryPrompt }];
        setConversationHistory(newHistory);
        setRunning(true);

        const p = agentParamsRef.current;
        const endpoint = p.model.endpointSupport.includes(p.selectedEndpoint)
          ? p.selectedEndpoint
          : p.model.endpointSupport[0];

        try {
          await invoke("coding_agent_chat", {
            messages: newHistory,
            modelId: p.model.modelId,
            publisher: p.model.publisher,
            endpoint,
            apiKey: p.apiKey,
            projectId: p.projectId,
            workingDir: p.workingDir,
            agentTimeout: p.agentTimeout || null,
            agentMode: p.mode,
            thinkingLevel: p.thinkingLevel !== "none" ? p.thinkingLevel : null,
            activeSkillPaths: p.activeSkillPaths.length > 0 ? p.activeSkillPaths : null,
            blockFileDeletion: p.blockFileDeletion,
          });
        } catch (err) {
          addMessage({ type: "error", content: String(err) });
          setRunning(false);
          setStopping(false);
          cleanupListeners();
        }
        return; // don't mark complete yet — the new run will fire its own complete event
      }

      if (subAgentRetryCount.current >= MAX_SUBAGENT_RETRIES && finding) {
        addMessage({
          type: "sub-agent",
          content: `**Sub-agent gave up** after ${MAX_SUBAGENT_RETRIES} retries. Last known issue: **${finding.label}** — ${finding.hint}`,
        });
      }

      addMessage({
        type: "complete",
        content: `Completed in ${iters} iteration(s)`,
        iteration: e.payload.iteration,
      });
      // Native notification when window is not focused
      if (!document.hasFocus()) {
        sendNotification("Grok Agent — Done ✓", `Task completed in ${iters} iteration(s)`);
      }
      setRunning(false);
      subAgentRetryCount.current = 0;
      previousFindingLabelRef.current = null;
      consecutiveSameLabelRef.current = 0;
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
    const imageSnapshot = attachedImage;
    setAttachedImage(null);

    // Reset sub-agent retry state for this new user-initiated run
    subAgentRetryCount.current = 0;
    pendingFindingRef.current = null;
    previousFindingLabelRef.current = null;
    consecutiveSameLabelRef.current = 0;

    // Feature 3: prepend context files to the prompt text
    let fullPrompt = userPrompt;
    if (contextFiles.length > 0) {
      const fileSection = contextFiles
        .map((f) => `### File: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      fullPrompt = `Here are the project files for context:\n\n${fileSection}\n\n---\n\n${userPrompt}`;
    }

    addMessage({ type: "user", content: userPrompt, toolData: imageSnapshot ? { id: "img", tool: "image", input: { name: imageSnapshot.name }, expanded: false } : undefined });
    setRunning(true);

    // Build user message — include image as array content if attached
    const userContent = imageSnapshot
      ? [
          { type: "image_url", image_url: { url: `data:${imageSnapshot.mimeType};base64,${imageSnapshot.data}` } },
          { type: "text", text: fullPrompt },
        ]
      : fullPrompt;

    const newHistory = [...conversationHistory, { role: "user", content: userContent }];
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
        agentTimeout: agentTimeout || null,
        agentMode: mode,
        thinkingLevel: thinkingLevel !== "none" ? thinkingLevel : null,
        activeSkillPaths: activeSkillPaths.length > 0 ? activeSkillPaths : null,
        blockFileDeletion,
      });
    } catch (e) {
      const errMsg = String(e);
      addMessage({ type: "error", content: errMsg });
      if (!document.hasFocus()) {
        sendNotification("Grok Agent — Error ✗", errMsg.slice(0, 120));
      }
      setPrompt(userPrompt);
      setConversationHistory(conversationHistory);
    } finally {
      cleanupListeners();
      setRunning(false);
      setStopping(false);
    }
  }, [prompt, running, conversationHistory, model, mode, selectedEndpoint, apiKey, projectId, workingDir, agentTimeout, addMessage, setupListeners, cleanupListeners]);

  const handleStop = useCallback(async () => {
    try {
      await invoke("coding_agent_stop");
      setStopping(true);
      addMessage({ type: "info", content: "Stop requested..." });
    } catch (e) {
      console.error("Failed to stop agent:", e);
    }
  }, [addMessage]);

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

  const handleClear = () => {
    if (running) return;
    setMessages([]);
    setConversationHistory([]);
    setLastSessionTokens(null);
    setFileHistory(new Map());
    setExecResults(new Map());
    setContextFiles([]);
    setExpandedTools(new Set());
  };

  // ── Feature 1: run a code block ──────────────────────────────────────────
  const runCodeBlock = useCallback(async (msgId: string, code: string, language: string) => {
    setExecResults((prev) => new Map(prev).set(msgId, { stdout: "", stderr: "", exitCode: 0, durationMs: 0, running: true }));
    try {
      const result = await invoke<{ stdout: string; stderr: string; exitCode: number; durationMs: number }>(
        "execute_code_snippet",
        { code, language, workingDir: workingDir || "." }
      );
      setExecResults((prev) => new Map(prev).set(msgId, { ...result, running: false }));
    } catch (e) {
      setExecResults((prev) => new Map(prev).set(msgId, {
        stdout: "",
        stderr: String(e),
        exitCode: -1,
        durationMs: 0,
        running: false,
      }));
    }
  }, [workingDir]);

  // ── Feature 3: add context files ─────────────────────────────────────────
  const addContextFiles = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        title: "Add files as context",
        filters: [{ name: "Source files", extensions: ["ts","tsx","js","jsx","py","rs","go","rb","java","cpp","c","h","cs","php","swift","kt","md","txt","json","toml","yaml","yml","sh","css","html"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const loaded = await Promise.all(
        paths.map(async (p) => {
          const content = await readTextFile(p).catch(() => "[binary or unreadable file]");
          return { name: p.split("/").pop() ?? p, path: p, content };
        })
      );
      setContextFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        return [...prev, ...loaded.filter((f) => !existing.has(f.path))];
      });
    } catch (e) {
      console.error("addContextFiles:", e);
    }
  }, []);

  const removeContextFile = useCallback((path: string) => {
    setContextFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const pickDirectory = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: "Select Working Directory" });
      if (selected && typeof selected === "string") {
        setWorkingDir(selected);
        invoke("save_working_dir", { path: selected }).catch(console.error);
      }
    } catch {
      const dir = window.prompt("Enter working directory path:", workingDir);
      if (dir) {
        setWorkingDir(dir);
        invoke("save_working_dir", { path: dir }).catch(console.error);
      }
    }
  };

  const pickImage = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] }],
        title: "Attach Image",
      });
      if (!selected || typeof selected !== "string") return;

      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes = await readFile(selected);
      const ext = selected.split(".").pop()?.toLowerCase() ?? "png";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
      };
      const mimeType = mimeMap[ext] ?? "image/png";
      const base64 = btoa(Array.from(bytes as Uint8Array, (b) => String.fromCharCode(b)).join(""));
      const name = selected.split("/").pop() ?? "image";
      setAttachedImage({ data: base64, mimeType, name });
    } catch (e) {
      console.error("Failed to attach image:", e);
    }
  };

  const renderMessage = (msg: AgentMessage) => {
    switch (msg.type) {
      case "user":
        return (
          <div key={msg.id} className="flex justify-end mb-3">
            <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-blue-500 text-white text-sm whitespace-pre-wrap space-y-1">
              {msg.toolData?.tool === "image" && (
                <div className="flex items-center gap-1.5 text-blue-100 text-xs pb-1 border-b border-blue-400">
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>{String(msg.toolData.input.name ?? "image")}</span>
                </div>
              )}
              {msg.content}
            </div>
          </div>
        );

      case "assistant-text": {
        // Feature 1: parse code fences and render run buttons
        const parts = parseCodeBlocks(msg.content);
        const execResult = execResults.get(msg.id);
        return (
          <div key={msg.id} className="mb-3">
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm theme-surface border theme-border text-sm theme-text leading-relaxed">
              {parts.map((part, pi) =>
                part.type === "text" ? (
                  <MarkdownRenderer key={pi} content={part.content} className="leading-relaxed" />
                ) : (
                   <div key={pi} className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                     {/* Code block header */}
                     <div className="flex items-center justify-between px-3 py-1.5 bg-gray-100 dark:bg-[#1e2030] text-xs border-b border-gray-200 dark:border-gray-700">
                       <span className="font-mono text-blue-600 dark:text-cyan-400">{part.language || "code"}</span>
                       <button
                         onClick={() => runCodeBlock(msg.id + "-" + pi, part.content, part.language)}
                         disabled={execResult?.running}
                         className="flex items-center gap-1 px-2 py-0.5 rounded bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-xs transition-colors"
                         title={`Run this ${part.language || "code"} snippet`}
                       >
                         {execResult?.running ? (
                           <Loader2 className="h-3 w-3 animate-spin" />
                         ) : (
                           <Play className="h-3 w-3" />
                         )}
                         Run
                       </button>
                     </div>
                     {/* Code body — explicit dark bg + light text so it reads in every theme */}
                     <pre className="px-3 py-2.5 text-xs font-mono overflow-x-auto bg-gray-50 dark:bg-[#161821] text-gray-800 dark:text-[#c0caf5] whitespace-pre leading-relaxed">
                       {part.content}
                     </pre>
                     {/* Execution output */}
                     {execResult && !execResult.running && (
                       <div className={`border-t border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-mono ${execResult.exitCode === 0 ? "bg-green-50 dark:bg-[#1a2b1a]" : "bg-red-50 dark:bg-[#2b1a1a]"}`}>
                         <div className="flex items-center gap-2 mb-1 text-[10px] text-gray-500 dark:text-gray-400">
                           <span className={execResult.exitCode === 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}>
                             exit {execResult.exitCode}
                           </span>
                           <span>{execResult.durationMs}ms</span>
                         </div>
                         {execResult.stdout && (
                           <pre className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap max-h-40 overflow-y-auto">{execResult.stdout}</pre>
                         )}
                         {execResult.stderr && (
                           <pre className="text-red-600 dark:text-red-400 whitespace-pre-wrap max-h-40 overflow-y-auto">{execResult.stderr}</pre>
                         )}
                       </div>
                     )}
                   </div>
                )
              )}
            </div>
          </div>
        );
      }

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
                    : td.tool === "write_file" || td.tool === "read_file" || td.tool === "edit_file" || td.tool === "delete_file"
                      ? String(td.input.path || "")
                      : td.tool === "list_directory"
                        ? String(td.input.path || ".")
                        : td.tool === "fetch_url"
                          ? String(td.input.url || "")
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

      case "complete": {
        const tokenInfo = lastSessionTokens;
        let costStr: string | null = null;
        if (showCosts && tokenInfo && model?.pricing) {
          const totalCost = (tokenInfo.input / 1_000_000) * (model.pricing.input * 1000) +
                            (tokenInfo.output / 1_000_000) * (model.pricing.output * 1000);
          const fmt = totalCost < 0.01 ? `$${totalCost.toFixed(4)}` : `$${totalCost.toFixed(3)}`;
          costStr = `${tokenInfo.input.toLocaleString()}↑ ${tokenInfo.output.toLocaleString()}↓ · ${fmt}`;
        }
        return (
          <div key={msg.id} className="mb-3 space-y-1">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{msg.content}</span>
            </div>
            {costStr && (
              <div className="px-2 text-xs font-mono theme-text-muted">
                {costStr}
              </div>
            )}
          </div>
        );
      }

      case "info":
        return (
          <div key={msg.id} className="mb-3 flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 text-sm">
            <Square className="h-4 w-4" />
            {msg.content}
          </div>
        );

      case "sub-agent":
        return (
          <div key={msg.id} className="mb-3 px-4 py-3 rounded-xl theme-surface border border-violet-400 text-sm">
            <div className="flex items-center gap-2 font-semibold mb-2 theme-accent">
              <Bot className="h-4 w-4 shrink-0" />
              Sub-agent review
            </div>
            <div className="theme-text leading-relaxed whitespace-pre-wrap">
              {msg.content.split(/\*\*([^*]+)\*\*/).map((part, i) =>
                i % 2 === 1 ? <strong key={i}>{part}</strong> : part
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-row flex-1 min-h-0">
      {/* Main conversation area */}
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-6">
            <Code2 className="h-20 w-20 opacity-20" />
            <div className="text-center max-w-lg">
              <div className="text-2xl font-semibold mb-2">Grok Coding Agent</div>
              <div className="text-base mb-4">
                Describe what you want to build or fix. Grok reads your codebase,
                writes files, runs commands, and iterates until it ships.
              </div>
              <div className="grid grid-cols-3 gap-3 text-left">
                <div className="p-3 rounded-xl border theme-border theme-surface">
                  <FilePen className="h-5 w-5 mb-2 text-blue-500" />
                  <div className="text-sm font-semibold theme-text">Read, Write & Edit</div>
                  <div className="text-sm theme-text-muted mt-1">Grok reads your repo and modifies files directly on disk</div>
                </div>
                <div className="p-3 rounded-xl border theme-border theme-surface">
                  <Terminal className="h-5 w-5 mb-2 text-green-500" />
                  <div className="text-sm font-semibold theme-text">Run Commands</div>
                  <div className="text-sm theme-text-muted mt-1">Installs deps, builds, tests, and runs scripts autonomously</div>
                </div>
                <div className="p-3 rounded-xl border theme-border theme-surface">
                  <AlertCircle className="h-5 w-5 mb-2 text-amber-500" />
                   <div className="text-sm font-semibold theme-text">Self-Correcting</div>
                   <div className="text-sm theme-text-muted mt-1">Grok detects errors and retries until the build passes — a built-in sub-agent reviews each response and flags improvements automatically</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {messages.map(renderMessage)}
        {running && !stopping && messages[messages.length - 1]?.type !== "tool-call" && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm theme-text">
            <Loader2 className="h-4 w-4 animate-spin" />
            Agent is working...
          </div>
        )}
        {running && stopping && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm theme-text">
            <Loader2 className="h-4 w-4 animate-spin" />
            Stopping...
          </div>
        )}
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <select
            value={model.id}
            onChange={(e) => {
              const found = CODING_MODELS.find((cm: ModelConfig) => cm.id === e.target.value);
              if (found) {
                setModel(found);
                setThinkingLevel(found.defaultThinkingLevel ?? (found.supportsDeepThinking ? "low" : "none"));
              }
            }}
            className="px-2 py-1.5 rounded-lg border theme-border theme-surface theme-text focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm font-medium"
          >
            {CODING_MODELS.map((cm: ModelConfig) => {
              const endpoints = cm.endpointSupport.join(" | ");
              return (
                <option key={cm.id} value={cm.id}>
                  {cm.displayName} ({endpoints})
                </option>
              );
            })}
          </select>

          <div className="flex items-center rounded-lg border theme-border overflow-hidden">
            <button
              onClick={() => setMode("code")}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                mode === "code"
                  ? "bg-blue-500 text-white"
                  : "theme-surface theme-text-muted hover:theme-text"
              }`}
            >
              Code
            </button>
            <button
              onClick={() => setMode("plan")}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                mode === "plan"
                  ? "bg-amber-500 text-white"
                  : "theme-surface theme-text-muted hover:theme-text"
              }`}
            >
              Plan
            </button>
          </div>

          {/* Thinking level — only shown for models that support it */}
          {model?.supportsDeepThinking && (() => {
            const isMultiAgent = model.modelId?.includes("multi-agent");
            if (isMultiAgent) {
              // Multi-agent: two discrete tiers — 4 agents (low/medium) or 16 agents (high/xhigh)
              const tier = (thinkingLevel === "high" || thinkingLevel === "xhigh") ? "high" : "low";
              return (
                <div className="flex items-center rounded-lg border theme-border overflow-hidden" title="Number of parallel agents">
                  <button
                    onClick={() => setThinkingLevel("low")}
                    title="4 agents — fast, focused queries"
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      tier === "low" ? "bg-purple-500 text-white" : "theme-surface theme-text-muted hover:theme-text"
                    }`}
                  >
                    4 agents
                  </button>
                  <button
                    onClick={() => setThinkingLevel("high")}
                    title="16 agents — deep research, complex topics"
                    className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      tier === "high" ? "bg-purple-500 text-white" : "theme-surface theme-text-muted hover:theme-text"
                    }`}
                  >
                    16 agents
                  </button>
                </div>
              );
            }
            // Standard reasoning effort selector
            return (
              <div className="flex items-center rounded-lg border theme-border overflow-hidden" title="Reasoning effort">
                {(["low", "medium", "high", "xhigh"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setThinkingLevel(lvl)}
                    title={`Reasoning effort: ${lvl}`}
                    className={`px-2 py-1.5 text-xs font-medium transition-colors ${
                      thinkingLevel === lvl
                        ? "bg-purple-500 text-white"
                        : "theme-surface theme-text-muted hover:theme-text"
                    }`}
                  >
                    {lvl === "xhigh" ? "max" : lvl}
                  </button>
                ))}
              </div>
            );
          })()}

          <button
            onClick={pickDirectory}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors text-xs truncate max-w-[350px]"
            title={`Working directory: ${workingDir}\nClick to change`}
          >
            <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="font-medium">Working Dir:</span>
            {workingDir.split("/").slice(-2).join("/")}
          </button>

          <button
            onClick={pickImage}
            disabled={running}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-purple-400 dark:border-purple-500 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors text-xs disabled:opacity-50"
            title="Attach an image (screenshot, mockup, diagram)"
          >
            <ImagePlus className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="font-medium">Image</span>
          </button>

          <div className="flex-1" />

          {/* Feature 3: Add context files */}
          <button
            onClick={addContextFiles}
            disabled={running}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors text-xs disabled:opacity-50"
            title="Add files as context for the agent"
          >
            <Files className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">Context</span>
            {contextFiles.length > 0 && (
              <span className="bg-indigo-500 text-white rounded-full text-[10px] px-1.5 leading-4">{contextFiles.length}</span>
            )}
          </button>

          {/* Agent Skills */}
          <button
            onClick={() => { setShowSkills((v) => !v); setShowHistory(false); setShowMcp(false); setShowDebugLog(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
              showSkills
                ? "bg-indigo-500 text-white shadow-md"
                : "bg-indigo-100 dark:bg-indigo-900/25 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-700 hover:bg-indigo-500 hover:text-white"
            }`}
            title="Agent Skills — inject reusable expertise into the agent"
          >
            <Sparkles className="h-4 w-4" />
            <span>Skills</span>
            {activeSkillPaths.length > 0 && (
              <span className={`rounded-full text-[10px] px-1.5 leading-4 ${showSkills ? "bg-white/30 text-white" : "bg-indigo-500 text-white"}`}>
                {activeSkillPaths.length}
              </span>
            )}
          </button>

          {/* Feature 2: History panel */}
          <button
            onClick={() => { setShowHistory((v) => !v); setShowSkills(false); setShowMcp(false); setShowDebugLog(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
              showHistory
                ? "bg-violet-500 text-white shadow-md"
                : "bg-violet-100 dark:bg-violet-900/25 text-violet-800 dark:text-violet-300 border border-violet-300 dark:border-violet-700 hover:bg-violet-500 hover:text-white"
            }`}
            title="File version history and diffs"
          >
            <Clock className="h-4 w-4" />
            <span>History</span>
            {fileHistory.size > 0 && (
              <span className={`rounded-full text-[10px] px-1.5 leading-4 ${showHistory ? "bg-white/30 text-white" : "bg-violet-500 text-white"}`}>
                {fileHistory.size}
              </span>
            )}
          </button>

          {/* MCP toggle */}
          <button
            onClick={() => { setShowMcp((v) => !v); setShowDebugLog(false); setShowHistory(false); setShowSkills(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
              showMcp
                ? "bg-[#7aa2f7] dark:bg-[#7aa2f7] text-[#1a1b26] dark:text-[#1a1b26] shadow-md"
                : "bg-blue-100 dark:bg-[#7aa2f7]/25 text-blue-800 dark:text-[#7aa2f7] border border-blue-300 dark:border-[#7aa2f7]/60 hover:bg-[#7aa2f7] dark:hover:bg-[#7aa2f7] hover:text-[#1a1b26] dark:hover:text-[#1a1b26]"
            }`}
            title="Configure MCP servers — connect external tools to the agent"
          >
            <Plug className="h-4 w-4" />
            <span>MCP</span>
          </button>

          {/* Debug log toggle */}
          <button
            onClick={() => { setShowDebugLog((v) => !v); setShowMcp(false); setShowHistory(false); setShowSkills(false); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
              showDebugLog
                ? "bg-[#e0af68] dark:bg-[#e0af68] text-[#1a1b26] dark:text-[#1a1b26] shadow-md"
                : "bg-amber-100 dark:bg-[#e0af68]/25 text-amber-800 dark:text-[#e0af68] border border-amber-300 dark:border-[#e0af68]/60 hover:bg-[#e0af68] dark:hover:bg-[#e0af68] hover:text-[#1a1b26] dark:hover:text-[#1a1b26]"
            }`}
            title="Toggle debug log"
          >
            <Bug className="h-4 w-4" />
            <span>Logs</span>
          </button>

          <button
            onClick={handleClear}
            disabled={running}
            title="Clear all messages, context files and history for a new project"
            className="px-2.5 py-1.5 rounded-lg text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-800 hover:border-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>

        {attachedImage && (
          <div className="flex items-center gap-2 px-1">
            <div className="relative inline-flex">
              <img
                src={`data:${attachedImage.mimeType};base64,${attachedImage.data}`}
                alt={attachedImage.name}
                className="h-16 w-16 object-cover rounded-lg border theme-border"
              />
              <button
                onClick={() => setAttachedImage(null)}
                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
                title="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <span className="text-xs theme-text-muted truncate max-w-[200px]">{attachedImage.name}</span>
          </div>
        )}

        {/* Feature 3: context file chips */}
        {contextFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {contextFiles.map((f) => (
              <div key={f.path} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 text-xs">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[140px]" title={f.path}>{f.name}</span>
                <span className="text-indigo-400 dark:text-indigo-500 text-[10px]">
                  {Math.round(f.content.length / 1000)}k
                </span>
                <button
                  onClick={() => removeContextFile(f.path)}
                  className="hover:text-red-500 transition-colors ml-0.5"
                  title="Remove from context"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

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
            onClick={running ? handleStop : handleSubmit}
            disabled={!running && !prompt.trim()}
            className={`flex items-center justify-center h-[44px] w-[44px] rounded-xl text-white transition-colors shadow-sm ${
              running
                ? "bg-red-500 hover:bg-red-600"
                : "bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {running ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
      </div>{/* end main column */}

      {/* Agent Skills side panel */}
      {showSkills && (
        <div className="w-80 min-w-[300px] max-w-[400px] flex-shrink-0 overflow-hidden">
          <SkillsPanel
            activeSkillPaths={activeSkillPaths}
            onActiveSkillsChange={setActiveSkillPaths}
            onClose={() => setShowSkills(false)}
          />
        </div>
      )}

      {/* Feature 2: File History side panel */}
      {showHistory && (
        <div className="w-96 min-w-[320px] max-w-[440px] flex-shrink-0 overflow-hidden">
          <FileHistoryPanel history={fileHistory} onClose={() => setShowHistory(false)} />
        </div>
      )}

      {/* Debug Log side panel */}
      {showDebugLog && (
        <div className="w-80 min-w-[280px] max-w-[380px] flex-shrink-0 overflow-hidden">
          <DebugLogPanel onClose={() => setShowDebugLog(false)} />
        </div>
      )}

      {/* MCP side panel */}
      {showMcp && (
        <div className="w-80 min-w-[280px] max-w-[380px] flex-shrink-0 overflow-hidden border-l theme-border">
          <McpPanel onClose={() => setShowMcp(false)} />
        </div>
      )}
    </div>
  );
}

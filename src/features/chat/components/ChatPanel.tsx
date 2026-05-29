import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { Message, EndpointType, ModelConfig, TokenUsage } from "@shared/types";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";

interface ChatPanelProps {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  model: ModelConfig;
  endpoint: EndpointType;
  apiKey: string;
  projectId: string;
  use1MContext: boolean;
  useMemory: boolean;
  useGrounding: boolean;
  thinkingLevel: string;
  includeThoughts: boolean;
  activeProject: string | null;
  lastTokenUsage: TokenUsage | null;
  totalTokens: { input: number; output: number };
  lastRawJson: string | null;
  customUrl?: string;
  customLogin?: string;
  customPassword?: string;
  serviceTier?: string;
  useSearch?: boolean;
  showCosts?: boolean;
  onSendMessage: (
    prompt: string,
    options: {
      model: ModelConfig;
      endpoint: EndpointType;
      apiKey: string;
      projectId: string;
      use1MContext?: boolean;
      useMemory?: boolean;
      useGrounding?: boolean;
      thinkingLevel?: string;
      includeThoughts?: boolean;
      customUrl?: string;
      customLogin?: string;
      customPassword?: string;
      serviceTier?: string;
      useSearch?: boolean;
    },
    attachedFile?: { path: string; data: string; mimeType: string }
  ) => Promise<string | undefined | void>;
  onClearMessages: () => void;
  onStopGeneration: () => void;
}


// Split "REASONING\n====\n...\n\nANSWER\n====\n..." into {reasoning, answer}
function parseReasoningContent(content: string): { reasoning: string | null; answer: string } {
  const reasoningMarker = /^REASONING\n={2,}\n/;
  const answerMarker = /\nANSWER\n={2,}\n/;
  if (!reasoningMarker.test(content)) return { reasoning: null, answer: content };
  const answerIdx = content.search(answerMarker);
  if (answerIdx === -1) return { reasoning: null, answer: content };
  const reasoningText = content.replace(reasoningMarker, "").slice(0, answerIdx).trim();
  const answerText = content.slice(answerIdx).replace(answerMarker, "").trim();
  return { reasoning: reasoningText, answer: answerText };
}

function ThinkingBlock({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors text-left"
      >
        <span className="text-base leading-none">{open ? "▾" : "▸"}</span>
        <span className="italic">Thinking…</span>
        <span className="ml-auto text-purple-400 dark:text-purple-500">
          {reasoning.length.toLocaleString()} chars
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-purple-200 dark:border-purple-800">
          <pre className="whitespace-pre-wrap font-mono text-xs text-purple-800 dark:text-purple-200 leading-relaxed max-h-80 overflow-y-auto pt-2 scrollbar-thin">
            {reasoning}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  messages,
  isLoading,
  error,
  model,
  endpoint,
  apiKey,
  projectId,
  use1MContext,
  useMemory,
  useGrounding,
  thinkingLevel,
  includeThoughts,
  activeProject,
  lastTokenUsage,
  totalTokens,
  lastRawJson,
  customUrl,
  customLogin,
  customPassword,
  serviceTier,
  useSearch,
  showCosts = true,
  onSendMessage,
  onClearMessages,
  onStopGeneration,
}: ChatPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [attachedFile, setAttachedFile] = useState<{
    path: string;
    data: string;
    mimeType: string;
    name: string;
  } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(100);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    selectedText: string;
    msgContent: string;
    msgIdx: number;
    msgRole: "user" | "assistant";
  } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Close context menu on any outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && (e as globalThis.KeyboardEvent).key !== "Escape") return;
      setCtxMenu(null);
    };
    document.addEventListener("mousedown", close as EventListener);
    document.addEventListener("keydown", close as EventListener);
    return () => {
      document.removeEventListener("mousedown", close as EventListener);
      document.removeEventListener("keydown", close as EventListener);
    };
  }, [ctxMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, msgContent: string, msgIdx: number, msgRole: "user" | "assistant") => {
      e.preventDefault();
      const selectedText = window.getSelection()?.toString() ?? "";
      setCtxMenu({ x: e.clientX, y: e.clientY, selectedText, msgContent, msgIdx, msgRole });
    },
    []
  );

  const handleCtxCopySelected = useCallback(async () => {
    if (!ctxMenu?.selectedText) return;
    await writeText(ctxMenu.selectedText);
    setCtxMenu(null);
  }, [ctxMenu]);

  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  const handleSend = async () => {
    if (!prompt.trim() && !attachedFile) return;

    const currentPrompt = prompt;
    const fileData = attachedFile
      ? { path: attachedFile.path, data: attachedFile.data, mimeType: attachedFile.mimeType }
      : undefined;

    try {
      setLastPrompt(currentPrompt);
      await onSendMessage(
        prompt,
        {
          model,
          endpoint,
          apiKey,
          projectId,
          use1MContext,
          useMemory,
          useGrounding,
          thinkingLevel,
          includeThoughts,
          customUrl,
          customLogin,
          customPassword,
          serviceTier,
          useSearch,
        },
        fileData
      );

      setPrompt("");
      setAttachedFile(null);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleResend = () => {
    if (lastPrompt) {
      setPrompt(lastPrompt);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartHeight.current = textareaHeight;

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaY = dragStartY.current - moveEvent.clientY;
      const newHeight = Math.max(60, Math.min(400, dragStartHeight.current + deltaY));
      setTextareaHeight(newHeight);
    };

    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleAttachFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: "All Files", extensions: ["*"] },
          { name: "Text", extensions: ["txt", "md", "json", "py", "js", "ts", "tsx"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (selected) {
        const fileData = await readFile(selected);
        let binary = "";
        const chunkSize = 32768;
        for (let i = 0; i < fileData.length; i += chunkSize) {
          const chunk = fileData.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64 = btoa(binary);
        const ext = selected.split(".").pop()?.toLowerCase() || "";

        let mimeType = "application/octet-stream";
        if (["png"].includes(ext)) mimeType = "image/png";
        else if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
        else if (["gif"].includes(ext)) mimeType = "image/gif";
        else if (["webp"].includes(ext)) mimeType = "image/webp";
        else if (["pdf"].includes(ext)) mimeType = "application/pdf";
        else if (["txt", "md", "json", "py", "js", "ts", "tsx"].includes(ext)) mimeType = "text/plain";

        setAttachedFile({
          path: selected,
          data: base64,
          mimeType,
          name: selected.split("/").pop() || selected,
        });
      }
    } catch (e) {
      console.error("Failed to attach file:", e);
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

  const handleSaveOutput = async (content: string, idx: number, role: "user" | "assistant") => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const prefix = role === "user" ? "prompt" : "output";
      const filename = `${prefix}-${timestamp}.md`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        const subfolder = role === "user" ? "prompts" : "outputs";
        await invoke("save_to_project", { projectPath, subfolder, filename, content });
      } else {
        await invoke("save_output", { content, filename });
      }

      setSavedIdx(idx);
      setTimeout(() => setSavedIdx(null), 2000);
    } catch (e) {
      console.error("Failed to save:", e);
    }
  };

  const handleCtxSave = useCallback(async () => {
    if (!ctxMenu) return;
    await handleSaveOutput(ctxMenu.msgContent, ctxMenu.msgIdx, ctxMenu.msgRole);
    setCtxMenu(null);
  }, [ctxMenu]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  const calculateCost = (inputTokens: number, outputTokens: number) => {
    const inputCost = (inputTokens * model.pricing.input) / 1_000_000;
    const outputCost = (outputTokens * model.pricing.output) / 1_000_000;
    return inputCost + outputCost;
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const inputTokens = Math.floor(prompt.length / 4);
  const inputChars = prompt.length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-6xl">💬</div>
            <div className="text-center">
              <h3 className="text-xl font-semibold theme-text mb-2">Start a Conversation</h3>
              <p className="theme-text-muted">Type a message below to begin chatting with AI</p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="group max-w-[80%]"
              onContextMenu={(e) => handleContextMenu(e, msg.content, idx, msg.role)}
            >
              <div
                className={`rounded-2xl px-4 py-3 ${msg.role === "user"
                  ? "text-white"
                  : "theme-text"
                  }`}
                style={{
                  backgroundColor: msg.role === "user"
                    ? 'var(--user-message-bg, var(--accent))'
                    : 'var(--assistant-message-bg, var(--bg-surface))'
                }}
              >
                {msg.role === "assistant" ? (() => {
                   const { reasoning, answer } = parseReasoningContent(msg.content);
                   return (
                     <>
                       {reasoning && <ThinkingBlock reasoning={reasoning} />}
                       <MarkdownRenderer content={answer} className="text-sm leading-relaxed" />
                     </>
                   );
                 })() : (
                   <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                     {msg.content}
                   </pre>
                 )}
                {msg.images?.map((img, i) => (
                  <img
                    key={i}
                    src={`data:image/png;base64,${img}`}
                    alt={`Generated ${i + 1}`}
                    className="mt-2 rounded-lg max-w-full"
                  />
                ))}
                
                 <div className={`flex gap-1 mt-2 pt-2 border-t ${msg.role === "user" ? "border-white/20" : "border-gray-200 dark:border-gray-700"} ${msg.role === "assistant" ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                   <button
                     onClick={() => handleCopy(msg.content, idx)}
                     className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                       msg.role === "user"
                         ? "hover:bg-white/20 text-white/70 hover:text-white"
                         : copiedIdx === idx
                           ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                           : "bg-gray-100 dark:bg-gray-700/60 hover:bg-gray-200 dark:hover:bg-gray-700 theme-text-muted hover:theme-text"
                     }`}
                     title="Copy to clipboard"
                   >
                     {copiedIdx === idx ? (
                       <>
                         <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                         </svg>
                         Copied!
                       </>
                     ) : (
                       <>
                         <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                         </svg>
                         Copy
                       </>
                     )}
                   </button>
                  <button
                    onClick={() => handleSaveOutput(msg.content, idx, msg.role)}
                    className={`p-1 rounded ${msg.role === "user" ? "hover:bg-white/20 text-white/70 hover:text-white" : "hover:bg-gray-100 dark:hover:bg-gray-700 theme-text-muted"}`}
                    title={activeProject ? `Save to ${activeProject}` : "Save to Downloads"}
                  >
                    {savedIdx === idx ? (
                      <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                    )}
                  </button>
                  {showCosts && msg.role === "assistant" && msg.cost !== undefined && msg.inputTokens !== undefined && msg.outputTokens !== undefined && (
                    <div className="flex-1 flex justify-end items-center text-xs theme-text-muted font-mono pr-1 select-none">
                      <span title={`${msg.inputTokens} input tokens`}>{formatTokens(msg.inputTokens)}↑</span>&nbsp;
                      <span title={`${msg.outputTokens} output tokens`}>{formatTokens(msg.outputTokens)}↓</span>&nbsp;
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">({formatCost(msg.cost)})</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="theme-surface border theme-border rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2 theme-text-muted">
                <div className="animate-pulse">Thinking...</div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {lastTokenUsage && (
        <div className="px-4 py-2 border-t theme-border theme-surface flex items-center justify-between text-xs">
          <div className="flex items-center gap-4 theme-text-muted">
            <span>Last: {formatTokens(lastTokenUsage.inputTokens)} in / {formatTokens(lastTokenUsage.outputTokens)} out ({formatCost(calculateCost(lastTokenUsage.inputTokens, lastTokenUsage.outputTokens))})</span>
            <span>Session: {formatTokens(totalTokens.input)} in / {formatTokens(totalTokens.output)} out ({formatCost(calculateCost(totalTokens.input, totalTokens.output))})</span>
          </div>
          <div className="flex items-center gap-3">
            {lastRawJson && (
              <button
                onClick={() => setShowJsonModal(true)}
                className="px-3 py-1 text-xs font-medium rounded-md bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
              >
                View Raw JSON
              </button>
            )}
          </div>
        </div>
      )}

      <div className="border-t theme-border p-4 space-y-3 theme-surface">
        {attachedFile && (
          <div className="flex items-center gap-2 text-sm">
            <span className="px-2 py-1 bg-[var(--accent)]/10 theme-accent rounded">
              {attachedFile.name}
            </span>
            <button
              onClick={() => setAttachedFile(null)}
              className="theme-text-muted hover:theme-text"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Resize handle at top */}
        <div
          className="flex justify-center cursor-ns-resize py-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-t transition-colors"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        >
          <div className="w-12 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
        </div>

        <div className="relative">
          <Textarea
            value={prompt}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt... (Ctrl+Enter to send)"
            className="w-full pr-24 resize-none"
            style={{ height: `${textareaHeight}px`, minHeight: '60px', maxHeight: '400px' }}
          />
          {isLoading ? (
            <button
              onClick={onStopGeneration}
              className="absolute right-3 bottom-3 z-20 p-3 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg pointer-events-auto"
              title="Stop generation"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!prompt.trim() && !attachedFile}
              className="absolute right-3 bottom-3 z-20 p-3 rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg pointer-events-auto"
              title="Send (Ctrl+Enter)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button onClick={handleResend} size="sm" disabled={!lastPrompt || isLoading}>
              Resend
            </Button>
            <Button onClick={handleAttachFile} size="sm">
              Attach
            </Button>
            <Button onClick={onClearMessages} size="sm">
              Clear
            </Button>
            <span className="text-xs theme-text-muted">
              {inputChars} chars / ~{inputTokens} tokens
            </span>
            {activeProject && (
              <span className="text-xs theme-accent">
                Project: {activeProject}
              </span>
            )}
          </div>
        </div>
      </div>

      {showJsonModal && lastRawJson && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="theme-surface rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b theme-border">
              <h2 className="text-lg font-semibold theme-text">Raw JSON Response</h2>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => handleCopy(lastRawJson, -1)}>
                  {copiedIdx === -1 ? "Copied!" : "Copy"}
                </Button>
                <button
                  onClick={() => setShowJsonModal(false)}
                  className="theme-text-muted hover:theme-text"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-xs font-mono theme-text whitespace-pre-wrap break-all">
                {lastRawJson}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 min-w-[160px] rounded-lg shadow-lg border theme-border theme-surface py-1 text-sm"
          style={{ top: ctxMenu.y, left: ctxMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.selectedText && (
            <button
              className="w-full text-left px-3 py-1.5 theme-text hover:bg-[var(--bg-hover)] transition-colors"
              onClick={handleCtxCopySelected}
            >
              Copy selected text
            </button>
          )}
          <button
            className="w-full text-left px-3 py-1.5 theme-text hover:bg-[var(--bg-hover)] transition-colors"
            onClick={handleCtxSave}
          >
            Save to file
          </button>
        </div>
      )}
    </div>
  );
}

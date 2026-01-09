import { useState, useRef, KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";
import { Button, TextArea, Checkbox } from "./index";
import { Message, EndpointType, ModelConfig, TokenUsage } from "../types";

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
  showRawJson: boolean;
  onShowRawJsonChange: (show: boolean) => void;
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
    },
    attachedFile?: { path: string; data: string; mimeType: string }
  ) => Promise<string | undefined>;
  onClearMessages: () => void;
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
  showRawJson,
  onShowRawJsonChange,
  onSendMessage,
  onClearMessages,
}: ChatPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [attachedFile, setAttachedFile] = useState<{
    path: string;
    data: string;
    mimeType: string;
    name: string;
  } | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<number | null>(null);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleSend = async () => {
    if (!prompt.trim() && !attachedFile) return;

    const fileData = attachedFile
      ? { path: attachedFile.path, data: attachedFile.data, mimeType: attachedFile.mimeType }
      : undefined;

    try {
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
        const base64 = btoa(String.fromCharCode(...fileData));
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
          <div className="flex items-center justify-center h-full theme-text-muted">
            Start a conversation by typing a message below
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="group relative max-w-[80%]">
              <div
                className={`rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-[var(--accent)] text-white"
                    : "theme-surface border theme-border theme-text"
                }`}
              >
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {msg.content}
                </pre>
                {msg.images?.map((img, i) => (
                  <img
                    key={i}
                    src={`data:image/png;base64,${img}`}
                    alt={`Generated ${i + 1}`}
                    className="mt-2 rounded-lg max-w-full"
                  />
                ))}
              </div>

              <div className={`absolute top-0 ${msg.role === "user" ? "left-0 -translate-x-full pr-2" : "right-0 translate-x-full pl-2"} opacity-0 group-hover:opacity-100 transition-opacity flex gap-1`}>
                <button
                  onClick={() => handleCopy(msg.content, idx)}
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
                  onClick={() => handleSaveOutput(msg.content, idx, msg.role)}
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
            <Checkbox
              label="Show Raw JSON"
              checked={showRawJson}
              onChange={(e) => onShowRawJsonChange(e.target.checked)}
            />
            {showRawJson && lastRawJson && (
              <button
                onClick={() => setShowJsonModal(true)}
                className="theme-accent hover:underline"
              >
                View JSON
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

        <div className="flex gap-3 items-end">
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your prompt... (Ctrl+Enter to send)"
            rows={3}
            autoResize
            className="flex-1 min-h-[80px] max-h-[200px]"
          />
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={isLoading || (!prompt.trim() && !attachedFile)}
            className="h-[80px] px-6"
          >
            {isLoading ? "..." : "Send"}
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
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
    </div>
  );
}

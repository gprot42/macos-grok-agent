import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Message, EndpointType, ModelConfig, ChatSession, TokenUsage, StreamTokenEvent, StreamDoneEvent } from "@shared/types";
import { save as tauriSave, open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";

interface ChatOptions {
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
}

interface GenerateImageOptions {
  prompt: string;
  apiKey: string;
  editImage?: string;
  editImageMimeType?: string;
  modelId?: string;
  searchMode?: string;
  aspectRatio?: string;
  /** "us-east-1" | "eu-west-1" — omit for global auto-routing */
  region?: string;
  /** "1k" | "2k" — xAI resolution field */
  resolution?: string;
}



// SESSIONS_FILE kept for reference — sessions are now persisted via Rust save_sessions command
// Sessions persisted via Rust save_sessions/load_sessions commands (not FS plugin directly)

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", name: "Prompt 1", messages: [], createdAt: Date.now() }
  ]);
  const [activeSessionId, setActiveSessionId] = useState("1");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  /** Per-image actual cost in USD returned by the xAI API (index-aligned with generatedImages). */
  const [imageCosts, setImageCosts] = useState<(number | null)[]>([]);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);
  const [lastRawJson, setLastRawJson] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);

  // Keep ref in sync so event listeners can read the current session id
  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];

  // Load sessions from persistent storage on init (Item 1)
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const data = await invoke<string | null>("load_sessions");
        if (data) {
          const loaded: ChatSession[] = JSON.parse(data);
          if (loaded && loaded.length > 0) {
            setSessions(loaded);
            setActiveSessionId(loaded[0].id);
          }
        }
      } catch (e) {
        console.log("No saved sessions found, starting fresh:", e);
      }
    };
    loadSessions();
  }, []);

  // Auto-save sessions whenever they change, debounced 2s (Item 3)
  useEffect(() => {
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("save_sessions", { sessionsJson: JSON.stringify(sessions) });
      } catch (e) {
        console.error("Auto-save failed:", e);
      }
    }, 2000);
    return () => { if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current); };
  }, [sessions]);

  const saveSessions = useCallback(async () => {
    try {
      await invoke("save_sessions", { sessionsJson: JSON.stringify(sessions) });
    } catch (e) {
      console.error("Manual save failed:", e);
      setError("Failed to save sessions to disk");
    }
  }, [sessions]);

  const sendMessage = useCallback(async (
    prompt: string,
    options: ChatOptions,
    _attachedFile?: { path: string; data: string; mimeType: string }
  ) => {
    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    const taskId = `chat-${Date.now()}`;
    const msgId = `msg-${taskId}`;
    const sessionId = activeSessionIdRef.current;

    // Add user message immediately
    const userMessage: Message = { id: `user-${taskId}`, role: "user", content: prompt };
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, messages: [...s.messages, userMessage], lastUpdated: Date.now() }
        : s
    ));

    // Add an empty streaming placeholder for the assistant reply
    const placeholder: Message = { id: msgId, role: "assistant", content: "", streaming: true };
    setSessions(prev => prev.map(s =>
      s.id === sessionId
        ? { ...s, messages: [...s.messages, placeholder] }
        : s
    ));
    setStreamingMessageId(msgId);

    // Set up event listeners before invoking so we don't miss early tokens
    const unlistenToken = await listen<StreamTokenEvent>("chat-stream-token", (event) => {
      if (event.payload.taskId !== taskId) return;
      setSessions(prev => prev.map(s =>
        s.id === activeSessionIdRef.current
          ? {
              ...s,
              messages: s.messages.map(m =>
                m.id === msgId ? { ...m, content: m.content + event.payload.content } : m
              ),
            }
          : s
      ));
    });

    const unlistenDone = await listen<StreamDoneEvent>("chat-stream-done", (event) => {
      if (event.payload.taskId !== taskId) return;
      const { inputTokens, outputTokens } = event.payload;

      let cost: number | undefined;
      if (options.model?.pricing) {
        const inputCost = (inputTokens / 1_000_000) * options.model.pricing.input;
        const outputCost = (outputTokens / 1_000_000) * options.model.pricing.output;
        cost = inputCost + outputCost;
        if (options.serviceTier === "flex") cost = (cost ?? 0) * 0.5;
      }

      // Finalise the streaming placeholder
      setSessions(prev => prev.map(s =>
        s.id === activeSessionIdRef.current
          ? {
              ...s,
              messages: s.messages.map(m =>
                m.id === msgId
                  ? { ...m, streaming: false, inputTokens, outputTokens, cost }
                  : m
              ),
              lastUpdated: Date.now(),
            }
          : s
      ));
      setLastTokenUsage({ inputTokens, outputTokens });
      setTotalTokens(prev => ({ input: prev.input + inputTokens, output: prev.output + outputTokens }));
      setStreamingMessageId(null);
      setIsLoading(false);
      unlistenToken();
      unlistenDone();
    });

    try {
      await invoke("stream_chat_message", {
        taskId,
        prompt,
        history: messages,
        modelId: options.model.modelId,
        publisher: options.model.publisher,
        endpoint: options.endpoint,
        apiKey: options.apiKey,
        projectId: options.projectId,
        use1mContext: options.use1MContext || false,
        useMemory: options.useMemory || false,
        useGrounding: options.useGrounding || false,
        thinkingLevel: options.thinkingLevel,
        includeThoughts: options.includeThoughts ?? true,
        customUrl: options.customUrl,
        customLogin: options.customLogin,
        customPassword: options.customPassword,
        serviceTier: options.serviceTier,
        useSearch: options.useSearch || false,
        attachedFile: _attachedFile,
      });
    } catch (e) {
      unlistenToken();
      unlistenDone();
      // Remove the failed placeholder
      setSessions(prev => prev.map(s =>
        s.id === activeSessionIdRef.current
          ? { ...s, messages: s.messages.filter(m => m.id !== msgId) }
          : s
      ));
      setStreamingMessageId(null);
      if (!cancelledRef.current) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(errorMsg || "Failed to get response from AI. Please check your API key and connection.");
      }
      setIsLoading(false);
    }
  }, [messages, activeSessionId]);

  const generateImage = useCallback(async (options: GenerateImageOptions) => {
    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    try {
      const resp = await invoke<{ image: string; costUsd: number }>("generate_image", {
        prompt: options.prompt,
        apiKey: options.apiKey,
        editImage: options.editImage,
        editImageMimeType: options.editImageMimeType,
        modelId: options.modelId,
        searchMode: options.searchMode,
        aspectRatio: options.aspectRatio,
        region: options.region || null,
        resolution: options.resolution || null,
      });

      if (cancelledRef.current) return;

      setGeneratedImages(prev => [...prev, resp.image]);
      setImageCosts(prev => [...prev, resp.costUsd > 0 ? resp.costUsd : null]);
      return resp.image;
    } catch (e) {
      if (!cancelledRef.current) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError("Image generation failed: " + errorMsg);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const saveImage = useCallback(async (imageBase64: string, filename: string) => {
    try {
      await invoke("save_image", { imageBase64, filename });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError("Failed to save image: " + errorMsg);
      throw e;
    }
  }, []);

  const clearMessages = useCallback(() => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, messages: [], lastUpdated: Date.now() }
        : s
    ));
    setError(null);
    setLastTokenUsage(null);
    setLastRawJson(null);
  }, [activeSessionId]);

  const clearImages = useCallback(() => {
    setGeneratedImages([]);
    setImageCosts([]);
  }, []);

  const createSession = useCallback(() => {
    const newId = String(Date.now());
    const newSession: ChatSession = {
      id: newId,
      name: `Prompt ${sessions.length + 1}`,
      messages: [],
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
    setLastTokenUsage(null);
    setLastRawJson(null);
  }, [sessions.length]);

  const deleteSession = useCallback((id: string) => {
    if (sessions.length <= 1) return;

    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining[0]?.id || "1");
    }
  }, [sessions, activeSessionId]);

  const renameSession = useCallback((id: string, name: string) => {
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, name, lastUpdated: Date.now() } : s
    ));
  }, []);

  const stopGeneration = useCallback(() => {
    cancelledRef.current = true;
    setIsLoading(false);
    setError("Generation stopped by user");
  }, []);

  const deleteImage = useCallback((index: number) => {
    setGeneratedImages(prev => prev.filter((_, i) => i !== index));
    setImageCosts(prev => prev.filter((_, i) => i !== index));
  }, []);

  // New: Export current session as Markdown (Improvement #3)
  const exportSession = useCallback(async (sessionId?: string) => {
    const targetId = sessionId || activeSessionId;
    const session = sessions.find(s => s.id === targetId);
    if (!session) {
      setError("Session not found");
      return;
    }

    const mdContent = `# ${session.name}\n\n` +
      session.messages.map(m => 
        `**${m.role.toUpperCase()}** (${new Date(m.timestamp || Date.now()).toLocaleString()}):\n\n${m.content}\n\n---\n\n`
      ).join("");

    try {
      const filePath = await tauriSave({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: `${session.name.replace(/[^a-zA-Z0-9]/g, "_")}.md`
      });
      if (filePath) {
        await writeTextFile(filePath, mdContent);
        // Optional: also save JSON version
        await writeTextFile(filePath.replace(".md", ".json"), JSON.stringify(session, null, 2));
      }
    } catch (e) {
      setError("Export failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [sessions, activeSessionId]);

  // New: Import session from JSON/MD (Improvement #3)
  const importSession = useCallback(async () => {
    try {
      const selected = await tauriOpen({
        multiple: false,
        filters: [
          { name: "Session Files", extensions: ["json", "md"] }
        ]
      });
      if (!selected) return;

      let importedSession: ChatSession;
      const content = await readTextFile(selected as string);

      if ((selected as string).endsWith(".md")) {
        // Simple MD import - create basic session
        importedSession = {
          id: String(Date.now()),
          name: "Imported Session",
          messages: [{ role: "assistant" as const, content: content }],
          createdAt: Date.now(),
          lastUpdated: Date.now(),
        };
      } else {
        importedSession = JSON.parse(content);
        if (!importedSession.id) importedSession.id = String(Date.now());
      }

      setSessions(prev => [...prev, importedSession]);
      setActiveSessionId(importedSession.id);
    } catch (e) {
      setError("Import failed. Ensure valid JSON or Markdown file: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  return {
    messages,
    sessions,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    error,
    generatedImages,
    imageCosts,
    lastTokenUsage,
    lastRawJson,
    totalTokens,
    streamingMessageId,
    sendMessage,
    generateImage,
    saveImage,
    clearMessages,
    clearImages,
    deleteImage,
    createSession,
    deleteSession,
    renameSession,
    stopGeneration,
    setError,
    saveSessions,
    exportSession,
    importSession,
  };
}

import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Message, EndpointType, ModelConfig, ChatSession, TokenUsage } from "../types";

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
}

interface GenerateImageOptions {
  prompt: string;
  apiKey: string;
  editImage?: string;
  editImageMimeType?: string;
  modelId?: string;
  searchMode?: string;
}

interface ChatResponse {
  content: string;
  rawJson: string;
  inputTokens: number;
  outputTokens: number;
}

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([
    { id: "1", name: "Prompt 1", messages: [], createdAt: Date.now() }
  ]);
  const [activeSessionId, setActiveSessionId] = useState("1");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);
  const [lastRawJson, setLastRawJson] = useState<string | null>(null);
  const [totalTokens, setTotalTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const cancelledRef = useRef(false);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];

  const sendMessage = useCallback(async (
    prompt: string,
    options: ChatOptions,
    attachedFile?: { path: string; data: string; mimeType: string }
  ) => {
    console.log("=== sendMessage called ===");
    console.log("prompt:", prompt.substring(0, 100));
    console.log("options:", options);
    console.log("model:", options.model);
    console.log("modelId:", options.model?.modelId);
    console.log("aiStudioModelId:", options.model?.aiStudioModelId);
    console.log("endpoint:", options.endpoint);

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    const userMessage: Message = { role: "user", content: prompt };

    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, messages: [...s.messages, userMessage] }
        : s
    ));

    try {
      console.log("Calling invoke('send_chat_message')...");
      const response = await invoke<ChatResponse>("send_chat_message", {
        prompt,
        history: messages,
        modelId: options.model.modelId,
        aiStudioModelId: options.model.aiStudioModelId,
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
        attachedFile,
        serviceTier: options.serviceTier,
      });

      console.log("invoke response:", response);

      // If cancelled, don't update with the response
      if (cancelledRef.current) {
        console.log("Cancelled, returning early");
        return;
      }

      const assistantMessage: Message = { role: "assistant", content: response.content };

      setSessions(prev => prev.map(s =>
        s.id === activeSessionId
          ? { ...s, messages: [...s.messages, assistantMessage] }
          : s
      ));

      setLastTokenUsage({ inputTokens: response.inputTokens, outputTokens: response.outputTokens });
      setLastRawJson(response.rawJson);
      setTotalTokens(prev => ({
        input: prev.input + response.inputTokens,
        output: prev.output + response.outputTokens,
      }));

      console.log("Returning response.content:", response.content?.substring(0, 100));
      return response.content;
    } catch (e) {
      console.error("sendMessage ERROR:", e);
      if (!cancelledRef.current) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        console.error("Setting error:", errorMsg);
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, activeSessionId]);

  const generateImage = useCallback(async (options: GenerateImageOptions) => {
    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    try {
      const imageBase64 = await invoke<string>("generate_image", {
        prompt: options.prompt,
        apiKey: options.apiKey,
        editImage: options.editImage,
        editImageMimeType: options.editImageMimeType,
        modelId: options.modelId,
        searchMode: options.searchMode,
      });

      if (cancelledRef.current) {
        return;
      }

      setGeneratedImages(prev => [...prev, imageBase64]);
      return imageBase64;
    } catch (e) {
      if (!cancelledRef.current) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(errorMsg);
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
      setError(errorMsg);
      throw e;
    }
  }, []);

  const clearMessages = useCallback(() => {
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId
        ? { ...s, messages: [] }
        : s
    ));
    setError(null);
    setLastTokenUsage(null);
    setLastRawJson(null);
  }, [activeSessionId]);

  const clearImages = useCallback(() => {
    setGeneratedImages([]);
  }, []);

  const createSession = useCallback(() => {
    const newId = String(Date.now());
    const newSession: ChatSession = {
      id: newId,
      name: `Prompt ${sessions.length + 1}`,
      messages: [],
      createdAt: Date.now(),
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
      s.id === id ? { ...s, name } : s
    ));
  }, []);

  const stopGeneration = useCallback(() => {
    cancelledRef.current = true;
    setIsLoading(false);
    setError("Generation stopped by user");
  }, []);

  const deleteImage = useCallback((index: number) => {
    setGeneratedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  return {
    messages,
    sessions,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    error,
    generatedImages,
    lastTokenUsage,
    lastRawJson,
    totalTokens,
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
  };
}

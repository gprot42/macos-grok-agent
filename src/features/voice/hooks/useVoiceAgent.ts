/**
 * Grok Voice Agent WebSocket session (Speech-to-Speech realtime API).
 *
 * Flow:
 *  1. Tauri backend mints an ephemeral client secret (API key never hits the WS)
 *  2. Browser opens wss://api.x.ai/v1/realtime?model=… with the secret as
 *     a Sec-WebSocket-Protocol token
 *  3. On conversation.created → session.update (voice, VAD, tools, audio format)
 *  4. Stream mic PCM16 ↔ play response audio deltas
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  DebugLogEntry,
  RealtimeMessage,
  TranscriptEntry,
  VoiceAgentSessionConfig,
  VoiceAgentStatus,
} from "../lib/realtimeTypes";
import { DEFAULT_VOICE_INSTRUCTIONS } from "../lib/realtimeTypes";

const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";

interface ClientSecretResponse {
  value: string;
  expires_at: number;
}

export interface UseVoiceAgentOptions {
  apiKey: string;
  onAudioDelta: (base64Pcm16: string) => void;
  onSpeechStarted: () => void;
  onError?: (message: string) => void;
}

export interface UseVoiceAgentReturn {
  status: VoiceAgentStatus;
  isConnected: boolean;
  transcript: TranscriptEntry[];
  debugLogs: DebugLogEntry[];
  error: string | null;
  connect: (config: VoiceAgentSessionConfig, sampleRate: number) => Promise<void>;
  disconnect: () => void;
  sendAudio: (base64Pcm16: string) => void;
  sendText: (text: string) => void;
  clearTranscript: () => void;
  clearLogs: () => void;
}

export function useVoiceAgent(options: UseVoiceAgentOptions): UseVoiceAgentReturn {
  const { apiKey, onAudioDelta, onSpeechStarted, onError } = options;

  const [status, setStatus] = useState<VoiceAgentStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionReadyRef = useRef(false);
  const configRef = useRef<VoiceAgentSessionConfig | null>(null);
  const sampleRateRef = useRef(24000);
  const assistantBufRef = useRef<string>("");
  const assistantIdRef = useRef<string | null>(null);

  // Keep latest callbacks without re-binding connect
  const onAudioDeltaRef = useRef(onAudioDelta);
  const onSpeechStartedRef = useRef(onSpeechStarted);
  const onErrorRef = useRef(onError);
  onAudioDeltaRef.current = onAudioDelta;
  onSpeechStartedRef.current = onSpeechStarted;
  onErrorRef.current = onError;

  const addLog = useCallback((direction: "SEND" | "RECV", msg: RealtimeMessage) => {
    // Skip high-volume audio frames
    if (
      msg.type === "input_audio_buffer.append" ||
      msg.type === "response.output_audio.delta" ||
      msg.type === "response.audio.delta"
    ) {
      return;
    }
    const summary =
      typeof msg.delta === "string"
        ? msg.delta.slice(0, 80)
        : msg.error?.message
          ? String(msg.error.message)
          : undefined;
    setDebugLogs((prev) => [
      ...prev.slice(-199),
      { timestamp: Date.now(), direction, type: msg.type, summary },
    ]);
  }, []);

  const pushError = useCallback((message: string) => {
    setError(message);
    setStatus("error");
    onErrorRef.current?.(message);
  }, []);

  const configureSession = useCallback((ws: WebSocket) => {
    const cfg = configRef.current;
    if (!cfg) return;

    const tools: Record<string, unknown>[] = [];
    if (cfg.webSearch) tools.push({ type: "web_search" });
    if (cfg.xSearch) tools.push({ type: "x_search" });

    const session: Record<string, unknown> = {
      instructions: cfg.instructions || DEFAULT_VOICE_INSTRUCTIONS,
      voice: cfg.voice || "eve",
      turn_detection: { type: "server_vad" },
      audio: {
        input: { format: { type: "audio/pcm", rate: sampleRateRef.current } },
        output: { format: { type: "audio/pcm", rate: sampleRateRef.current } },
      },
    };

    if (cfg.reasoningEffort) {
      session.reasoning = { effort: cfg.reasoningEffort };
    }
    if (tools.length > 0) {
      session.tools = tools;
    }

    const msg = { type: "session.update", session };
    ws.send(JSON.stringify(msg));
    addLog("SEND", msg);
  }, [addLog]);

  const sendGreeting = useCallback((ws: WebSocket) => {
    const greeting = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Say a brief hello and introduce yourself in one short sentence.",
          },
        ],
      },
    };
    ws.send(JSON.stringify(greeting));
    addLog("SEND", greeting);
    ws.send(JSON.stringify({ type: "response.create" }));
    addLog("SEND", { type: "response.create" });
  }, [addLog]);

  const handleServerMessage = useCallback(
    (message: RealtimeMessage) => {
      addLog("RECV", message);

      switch (message.type) {
        case "conversation.created":
        case "session.created":
          if (!sessionReadyRef.current && wsRef.current) {
            configureSession(wsRef.current);
          }
          break;

        case "session.updated":
          if (!sessionReadyRef.current && wsRef.current) {
            sessionReadyRef.current = true;
            setStatus("listening");
            sendGreeting(wsRef.current);
          }
          break;

        case "response.output_audio.delta":
        case "response.audio.delta":
          if (typeof message.delta === "string") {
            setStatus("assistant_speaking");
            onAudioDeltaRef.current(message.delta);
          }
          break;

        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta": {
          const delta = typeof message.delta === "string" ? message.delta : "";
          if (!delta) break;
          assistantBufRef.current += delta;
          if (!assistantIdRef.current) {
            const id = `a-${Date.now()}`;
            assistantIdRef.current = id;
            setTranscript((prev) => [
              ...prev,
              {
                id,
                timestamp: Date.now(),
                role: "assistant",
                content: assistantBufRef.current,
              },
            ]);
          } else {
            const id = assistantIdRef.current;
            setTranscript((prev) =>
              prev.map((t) =>
                t.id === id ? { ...t, content: assistantBufRef.current } : t
              )
            );
          }
          break;
        }

        case "response.done":
          assistantBufRef.current = "";
          assistantIdRef.current = null;
          setStatus("listening");
          break;

        case "input_audio_buffer.speech_started":
          setStatus("user_speaking");
          onSpeechStartedRef.current();
          setTranscript((prev) => {
            if (prev.length > 0 && prev[prev.length - 1].role === "user" && prev[prev.length - 1].content === "…") {
              return prev;
            }
            return [
              ...prev,
              {
                id: `u-${Date.now()}`,
                timestamp: Date.now(),
                role: "user",
                content: "…",
              },
            ];
          });
          break;

        case "conversation.item.added":
        case "conversation.item.created": {
          const item = message.item as
            | {
                role?: string;
                content?: Array<{ type?: string; transcript?: string }>;
              }
            | undefined;
          if (item?.role === "user" && Array.isArray(item.content)) {
            for (const c of item.content) {
              if ((c.type === "input_audio" || c.type === "audio") && c.transcript) {
                setTranscript((prev) => {
                  if (prev.length > 0 && prev[prev.length - 1].role === "user") {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    const base = last.content === "…" ? "" : last.content + " ";
                    next[next.length - 1] = {
                      ...last,
                      content: base + c.transcript,
                    };
                    return next;
                  }
                  return [
                    ...prev,
                    {
                      id: `u-${Date.now()}`,
                      timestamp: Date.now(),
                      role: "user",
                      content: c.transcript!,
                    },
                  ];
                });
                break;
              }
            }
          }
          break;
        }

        case "error": {
          const errMsg =
            message.error?.message ||
            message.message ||
            JSON.stringify(message.error || message);
          pushError(String(errMsg));
          break;
        }

        default:
          break;
      }
    },
    [addLog, configureSession, sendGreeting, pushError]
  );

  const connect = useCallback(
    async (config: VoiceAgentSessionConfig, sampleRate: number) => {
      if (!apiKey?.trim()) {
        pushError("xAI API key required. Add it in Settings.");
        return;
      }

      // Tear down any existing session
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setError(null);
      setStatus("connecting");
      sessionReadyRef.current = false;
      configRef.current = config;
      sampleRateRef.current = sampleRate;
      assistantBufRef.current = "";
      assistantIdRef.current = null;

      try {
        const secret = await invoke<ClientSecretResponse>("create_voice_client_secret", {
          apiKey,
          expiresAfterSecs: 300,
        });

        if (!secret?.value) {
          throw new Error("Empty client secret returned from xAI");
        }

        const model = encodeURIComponent(config.modelId || "grok-voice-think-fast-2.0");
        const url = `${XAI_REALTIME_URL}?model=${model}`;

        // Browser cannot set Authorization headers on WebSocket; pass the
        // ephemeral token via the Sec-WebSocket-Protocol header (xAI convention).
        const ws = new WebSocket(url, [`xai-client-secret.${secret.value}`]);

        ws.onopen = () => {
          setIsConnected(true);
          setStatus("connecting");
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string) as RealtimeMessage;
            handleServerMessage(msg);
          } catch (e) {
            console.error("[voice] Failed to parse WS message:", e);
          }
        };

        ws.onerror = () => {
          pushError("WebSocket connection error");
        };

        ws.onclose = (event) => {
          setIsConnected(false);
          sessionReadyRef.current = false;
          wsRef.current = null;
          if (event.code === 1000 || event.code === 1001) {
            setStatus((s) => (s === "error" ? s : "idle"));
            return;
          }
          const reason = event.reason || `code ${event.code}`;
          setStatus((s) => (s === "error" ? s : "idle"));
          setError((prev) => prev ?? `Connection closed: ${reason}`);
        };

        wsRef.current = ws;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushError(msg);
        setIsConnected(false);
      }
    },
    [apiKey, handleServerMessage, pushError]
  );

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, "user disconnect");
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    sessionReadyRef.current = false;
    setIsConnected(false);
    setStatus("idle");
  }, []);

  const sendAudio = useCallback((base64Pcm16: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReadyRef.current) return;
    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: base64Pcm16,
      })
    );
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReadyRef.current) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      setTranscript((prev) => [
        ...prev,
        {
          id: `u-text-${Date.now()}`,
          timestamp: Date.now(),
          role: "user",
          content: trimmed,
        },
      ]);

      const create = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: trimmed }],
        },
      };
      ws.send(JSON.stringify(create));
      addLog("SEND", create);
      ws.send(JSON.stringify({ type: "response.create" }));
      addLog("SEND", { type: "response.create" });
    },
    [addLog]
  );

  const clearTranscript = useCallback(() => setTranscript([]), []);
  const clearLogs = useCallback(() => setDebugLogs([]), []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  return {
    status,
    isConnected,
    transcript,
    debugLogs,
    error,
    connect,
    disconnect,
    sendAudio,
    sendText,
    clearTranscript,
    clearLogs,
  };
}

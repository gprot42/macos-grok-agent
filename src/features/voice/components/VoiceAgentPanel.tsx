import { useCallback, useState } from "react";
import { Button } from "@shared/components/ui/button";
import { BUILTIN_VOICES } from "@shared/constants/voices";
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Trash2,
  ChevronDown,
  ChevronUp,
  Globe,
  Send,
} from "lucide-react";
import { useAudioStream } from "../hooks/useAudioStream";
import { useVoiceAgent } from "../hooks/useVoiceAgent";
import {
  DEFAULT_VOICE_AGENT_MODEL,
  DEFAULT_VOICE_INSTRUCTIONS,
  VOICE_AGENT_MODELS,
  type VoiceAgentStatus,
} from "../lib/realtimeTypes";

interface VoiceAgentPanelProps {
  apiKey: string;
}

function statusLabel(status: VoiceAgentStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting…";
    case "listening":
      return "Listening — speak anytime";
    case "user_speaking":
      return "Hearing you…";
    case "assistant_speaking":
      return "Grok is speaking…";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

function statusDotClass(status: VoiceAgentStatus): string {
  switch (status) {
    case "connecting":
      return "bg-amber-400 animate-pulse";
    case "listening":
      return "bg-emerald-400";
    case "user_speaking":
      return "bg-blue-400 animate-pulse";
    case "assistant_speaking":
      return "bg-cyan-400 animate-pulse";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-400";
  }
}

export function VoiceAgentPanel({ apiKey }: VoiceAgentPanelProps) {
  const [modelId, setModelId] = useState(DEFAULT_VOICE_AGENT_MODEL);
  const [voice, setVoice] = useState("eve");
  const [instructions, setInstructions] = useState(DEFAULT_VOICE_INSTRUCTIONS);
  const [reasoningEffort, setReasoningEffort] = useState<"high" | "none">("high");
  const [webSearch, setWebSearch] = useState(false);
  const [xSearch, setXSearch] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [textInput, setTextInput] = useState("");

  const selectedModel =
    VOICE_AGENT_MODELS.find((m) => m.id === modelId) ?? VOICE_AGENT_MODELS[0];

  const {
    isCapturing,
    audioLevel,
    startCapture,
    stopCapture,
    stopPlayback,
    playAudio,
  } = useAudioStream();

  const {
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
  } = useVoiceAgent({
    apiKey,
    onAudioDelta: playAudio,
    onSpeechStarted: stopPlayback,
  });

  const handleStart = useCallback(async () => {
    try {
      clearLogs();
      clearTranscript();

      const sampleRate = await startCapture((base64) => {
        sendAudio(base64);
      });

      await connect(
        {
          modelId,
          voice,
          instructions,
          reasoningEffort,
          webSearch,
          xSearch,
        },
        sampleRate
      );
    } catch (e) {
      stopCapture();
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[voice agent] start failed:", msg);
    }
  }, [
    clearLogs,
    clearTranscript,
    startCapture,
    sendAudio,
    connect,
    modelId,
    voice,
    instructions,
    reasoningEffort,
    webSearch,
    xSearch,
    stopCapture,
  ]);

  const handleStop = useCallback(() => {
    stopCapture();
    stopPlayback();
    disconnect();
  }, [stopCapture, stopPlayback, disconnect]);

  const handleSendText = useCallback(() => {
    if (!textInput.trim()) return;
    sendText(textInput);
    setTextInput("");
  }, [textInput, sendText]);

  const active = isConnected || status === "connecting";
  const levelPct = Math.min(100, Math.round(audioLevel * 300));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header + controls */}
      <div className="flex-shrink-0 border-b theme-border theme-surface px-4 pt-3 pb-3 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 shadow-sm flex-shrink-0">
            <Radio className="h-4 w-4 text-white" />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold theme-text">Grok Voice Agent</span>
              <span className="text-xs theme-text-muted hidden sm:inline">Speech-to-speech</span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs theme-text-muted">Using</span>
              <span className="text-xs font-medium text-sky-600 dark:text-sky-400 truncate">
                {selectedModel.label}
              </span>
              <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 truncate">
                {selectedModel.id}
              </code>
            </div>
          </div>
          {active && (
            <div className="flex items-center gap-2 text-xs theme-text-muted">
              <span className={`inline-block w-2 h-2 rounded-full ${statusDotClass(status)}`} />
              {statusLabel(status)}
            </div>
          )}
        </div>

        {/* Model selector — clearly labeled */}
        <div className="flex items-center gap-2">
          <label htmlFor="voice-agent-model" className="text-sm font-medium theme-text whitespace-nowrap flex-shrink-0">
            Model
          </label>
          <select
            id="voice-agent-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={active}
            className="flex-1 min-w-0 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          >
            {VOICE_AGENT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.desc}
              </option>
            ))}
          </select>
        </div>

        {/* Voice + start/stop */}
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="voice-agent-voice" className="text-sm font-medium theme-text whitespace-nowrap flex-shrink-0">
            Voice
          </label>
          <select
            id="voice-agent-voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={active}
            className="flex-1 min-w-[8rem] rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          >
            <optgroup label="Original">
              {BUILTIN_VOICES.filter((v) => v.group === "original").map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} — {v.desc}
                </option>
              ))}
            </optgroup>
            <optgroup label="Flagship">
              {BUILTIN_VOICES.filter((v) => v.group === "flagship").map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} — {v.desc}
                </option>
              ))}
            </optgroup>
          </select>

          {!active ? (
            <Button
              onClick={handleStart}
              disabled={!apiKey}
              className="gap-1.5 bg-sky-500 hover:bg-sky-600 text-white"
            >
              <Phone className="h-4 w-4" />
              Start
            </Button>
          ) : (
            <Button
              onClick={handleStop}
              variant="destructive"
              className="gap-1.5"
            >
              <PhoneOff className="h-4 w-4" />
              End
            </Button>
          )}
        </div>

        {/* Mic level + tools row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[8rem]">
            {isCapturing ? (
              <Mic className="h-4 w-4 text-sky-500 flex-shrink-0" />
            ) : (
              <MicOff className="h-4 w-4 text-gray-400 flex-shrink-0" />
            )}
            <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-500 transition-[width] duration-75"
                style={{ width: `${levelPct}%` }}
              />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs theme-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              disabled={active}
              className="rounded border-gray-300"
            />
            <Globe className="h-3.5 w-3.5" />
            Web
          </label>
          <label className="flex items-center gap-1.5 text-xs theme-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={xSearch}
              onChange={(e) => setXSearch(e.target.checked)}
              disabled={active}
              className="rounded border-gray-300"
            />
            𝕏 Search
          </label>
          <label className="flex items-center gap-1.5 text-xs theme-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reasoningEffort === "high"}
              onChange={(e) => setReasoningEffort(e.target.checked ? "high" : "none")}
              disabled={active}
              className="rounded border-gray-300"
            />
            Reasoning
          </label>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-xs theme-text-muted hover:theme-text"
          >
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            System prompt
          </button>
        </div>

        {showAdvanced && (
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={active}
            rows={3}
            className="w-full rounded-lg border theme-border theme-surface theme-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50 resize-none"
            placeholder="System instructions for the voice agent…"
          />
        )}

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!apiKey && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Add your xAI API key in Settings to start a live voice session.
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 scrollbar-thin">
        {transcript.length === 0 && !active && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-4 py-12">
            <div className="text-6xl">🎙️</div>
            <div className="text-center max-w-md space-y-2">
              <div className="text-lg font-semibold theme-text">Live Voice Agent</div>
              <p className="text-sm leading-relaxed">
                Real-time speech-to-speech. Select a model above — default is{" "}
                <strong className="theme-text">Grok Voice Think Fast 2.0</strong>
                {" "}(<code className="text-xs font-mono">grok-voice-think-fast-2.0</code>).
                Server VAD detects when you stop speaking; interrupt anytime.
              </p>
              <p className="text-xs opacity-70">
                Currently selected: <span className="font-mono">{selectedModel.id}</span>
                {" · "}$0.08/min (2.0) · $0.05/min (1.0)
              </p>
            </div>
          </div>
        )}

        {transcript.length === 0 && active && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-2 py-12">
            <span className={`inline-block w-3 h-3 rounded-full ${statusDotClass(status)}`} />
            <span className="text-sm">{statusLabel(status)}</span>
          </div>
        )}

        {transcript.map((t) => (
          <div
            key={t.id}
            className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                t.role === "user"
                  ? "bg-sky-500 text-white rounded-br-md"
                  : "theme-surface border theme-border theme-text rounded-bl-md"
              }`}
            >
              <div className="text-[10px] opacity-60 mb-0.5 font-medium uppercase tracking-wide">
                {t.role === "user" ? "You" : "Grok"}
              </div>
              {t.content}
            </div>
          </div>
        ))}
      </div>

      {/* Text input + debug */}
      <div className="flex-shrink-0 border-t theme-border theme-surface px-4 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendText();
              }
            }}
            disabled={!isConnected || status === "connecting"}
            placeholder={isConnected ? "Type a message (optional)…" : "Start a session to chat"}
            className="flex-1 rounded-lg border theme-border theme-surface theme-text px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSendText}
            disabled={!isConnected || !textInput.trim()}
            className="p-2 rounded-lg bg-sky-500 text-white disabled:opacity-40 hover:bg-sky-600 transition-colors"
            title="Send text"
          >
            <Send className="h-4 w-4" />
          </button>
          {transcript.length > 0 && (
            <button
              type="button"
              onClick={clearTranscript}
              className="p-2 rounded-lg theme-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="Clear transcript"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className={`px-2 py-1.5 rounded-lg text-xs border theme-border transition-colors ${
              showDebug
                ? "bg-gray-200 dark:bg-gray-700 theme-text"
                : "theme-text-muted hover:theme-text"
            }`}
          >
            Events
          </button>
        </div>

        {showDebug && (
          <div className="max-h-32 overflow-y-auto rounded-lg border theme-border bg-gray-50 dark:bg-[#1a1b26] p-2 font-mono text-[10px] space-y-0.5 scrollbar-thin">
            {debugLogs.length === 0 && (
              <div className="text-gray-400">No events yet</div>
            )}
            {debugLogs.map((log, i) => (
              <div key={`${log.timestamp}-${i}`} className="flex gap-2">
                <span className={log.direction === "SEND" ? "text-blue-500" : "text-emerald-500"}>
                  {log.direction}
                </span>
                <span className="theme-text">{log.type}</span>
                {log.summary && (
                  <span className="text-gray-400 truncate">{log.summary}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

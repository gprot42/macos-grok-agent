/** WebSocket message types for the xAI Speech-to-Speech realtime API. */

export interface RealtimeMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface TranscriptEntry {
  id: string;
  timestamp: number;
  role: "user" | "assistant";
  content: string;
}

export interface DebugLogEntry {
  timestamp: number;
  direction: "SEND" | "RECV";
  type: string;
  summary?: string;
}

export type VoiceAgentStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "assistant_speaking"
  | "error";

export interface VoiceAgentSessionConfig {
  modelId: string;
  voice: string;
  instructions: string;
  /** Reasoning effort for Think Fast models. Defaults to "high". */
  reasoningEffort?: "high" | "none";
  /** Enable web_search tool. */
  webSearch?: boolean;
  /** Enable x_search tool. */
  xSearch?: boolean;
}

/** Default Speech-to-Speech model. */
export const DEFAULT_VOICE_AGENT_MODEL = "grok-voice-think-fast-2.0";

export const VOICE_AGENT_MODELS = [
  {
    id: "grok-voice-think-fast-2.0",
    label: "Grok Voice Think Fast 2.0",
    desc: "Flagship · $0.08/min",
  },
  {
    id: "grok-voice-think-fast-1.0",
    label: "Grok Voice Think Fast 1.0",
    desc: "Previous gen · $0.05/min",
  },
  {
    id: "grok-voice-latest",
    label: "Grok Voice (Latest)",
    desc: "Alias · tracks newest",
  },
] as const;

/** Text-to-Speech models (REST /v1/tts). */
export const DEFAULT_TTS_MODEL = "grok-tts";

export const TTS_MODELS = [
  {
    id: "grok-tts",
    label: "Grok TTS",
    desc: "Text-to-speech · $15 / 1M chars",
  },
] as const;

export const DEFAULT_VOICE_INSTRUCTIONS =
  "You are Grok, a helpful and witty voice assistant from xAI. " +
  "You are speaking to the user in real time over audio. " +
  "Keep responses conversational and concise since they will be spoken aloud. " +
  "Be natural, warm, and clear.";

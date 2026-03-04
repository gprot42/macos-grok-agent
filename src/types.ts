export type EndpointType = "vertex_ai" | "ai_studio" | "openrouter" | "xai" | "kilocode" | "custom";

export interface ModelConfig {
  id: string;
  publisher: "anthropic" | "google" | "openrouter" | "xai" | "kilocode";
  modelId: string;
  aiStudioModelId?: string;
  displayName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  icon: string;
  color: string;
  description: string;
  pricing: {
    input: number;
    output: number;
    inputPremium?: number;
    outputPremium?: number;
  };
  supports1MContext?: boolean;
  supportsMemory?: boolean;
  supportsGrounding?: boolean;
  supportsDeepThinking?: boolean;
  supportsImageGeneration?: boolean;
  supportsDeepResearch?: boolean;
  defaultThinkingLevel?: string;
  defaultGrounding?: boolean;
  endpointSupport: EndpointType[];
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}

export type ThemeMode = "light" | "tokyo" | "dark";

export interface AppSettings {
  theme: ThemeMode;
  fontSize: number;
  fontFamily: string;
  apiKey: string;
  aiStudioKey?: string;
  openrouterKey?: string;
  xaiKey?: string;
  kilocodeKey?: string;
  customLogin?: string;
  customPassword?: string;
  projectId: string;
  activeProject?: string;
  showRawJson?: boolean;
  agentTimeout?: number;
  customColors?: {
    accentColor?: string;
    userMessageBg?: string;
    assistantMessageBg?: string;
  };
}

export const FONT_OPTIONS = [
  { value: "system", label: "System Default" },
  { value: "inter", label: "Inter" },
  { value: "sf-pro", label: "SF Pro" },
  { value: "jetbrains", label: "JetBrains Mono" },
  { value: "fira-code", label: "Fira Code" },
  { value: "roboto", label: "Roboto" },
  { value: "source-code", label: "Source Code Pro" },
];

export interface Project {
  name: string;
  path: string;
}

export interface ChatSession {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
}

export interface ResearchSession {
  id: string;
  name: string;
  createdAt: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

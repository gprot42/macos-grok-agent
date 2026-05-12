export type EndpointType = "openrouter" | "xai" | "kilocode" | "custom";

export interface ModelConfig {
  id: string;
  publisher: "anthropic" | "openrouter" | "xai" | "kilocode";
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
    /** Flat per-image cost estimate (USD) for image-generation models. */
    perImage?: number;
  };
  supports1MContext?: boolean;
  supportsMemory?: boolean;
  supportsGrounding?: boolean;
  supportsDeepThinking?: boolean;
  supportsImageGeneration?: boolean;
  supportsDeepResearch?: boolean;
  supportsTextToSpeech?: boolean;
  supportsVideoGeneration?: boolean;
  supportsSearch?: boolean;
  defaultThinkingLevel?: string;
  defaultGrounding?: boolean;
  supportsServiceTier?: boolean;
  endpointSupport: EndpointType[];
}

export interface Message {
  id?: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  timestamp?: number;
  /** True while the message is being streamed (partial content). */
  streaming?: boolean;
}

// ── Streaming event payloads ──────────────────────────────────────────────────

export interface StreamTokenEvent {
  taskId: string;
  content: string;
}

export interface StreamDoneEvent {
  taskId: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Agent chain types ─────────────────────────────────────────────────────────

export interface ChainStep {
  name: string;
  systemPrompt?: string;
  modelId: string;
  publisher: string;
  endpoint: string;
}

export interface AgentPipeline {
  steps: ChainStep[];
  initialInput: string;
}

export interface ChainStepEvent {
  taskId: string;
  step: number;
  name: string;
  outputPreview?: string;
}

// ── Deep research types ───────────────────────────────────────────────────────

export interface DeepResearchPhaseEvent {
  taskId: string;
  phase: "decompose" | "research" | "synthesise" | "complete";
  message: string;
  subQuestions?: string[];
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
  openrouterKey?: string;
  xaiKey?: string;
  kilocodeKey?: string;
  customLogin?: string;
  customPassword?: string;
  projectId: string;
  activeProject?: string;
  showRawJson?: boolean;
  showCosts?: boolean;
  agentTimeout?: number;
  /** When true, rm/unlink/rmdir commands inside run_command are soft-blocked.
   *  The agent receives a descriptive message and is directed to use delete_file instead.
   *  Defaults to true (blocking on). */
  blockFileDeletion?: boolean;
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
  lastUpdated?: number;
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

// ── Agent / Tool interfaces ───────────────────────────────────────────────────

/** All tool names the coding agent supports */
export type AgentToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "run_command"
  | "list_directory"
  | "search_files"
  | "get_diagnostics"
  | "fetch_url";

/** A single tool invocation recorded in the agent trace */
export interface AgentToolCall {
  id: string;
  tool: AgentToolName;
  /** Parsed input args as passed to the tool */
  input: Record<string, unknown>;
  /** Raw result string from tool execution */
  result?: string;
  isError?: boolean;
  /** Timestamp when the call was made */
  timestamp?: number;
}

/** Agent operational mode */
export type AgentMode = "code" | "plan";

/** High-level state the agent loop can be in */
export type AgentStatus =
  | "idle"
  | "running"
  | "paused"
  | "complete"
  | "cancelled"
  | "error";

/** A single message in the agent conversation */
export interface AgentMessage {
  id: string;
  /** "user" | "assistant-text" | "thinking" | "tool-call" | "tool-result" | "error" | "complete" | "info" */
  type:
    | "user"
    | "assistant-text"
    | "thinking"
    | "tool-call"
    | "tool-result"
    | "error"
    | "complete"
    | "info";
  content: string;
  toolData?: AgentToolCall;
  iteration?: number;
  timestamp?: number;
}

/** Snapshot of one agent session (mirrors the coding agent panel state) */
export interface AgentSession {
  id: string;
  name: string;
  workingDir: string;
  mode: AgentMode;
  messages: AgentMessage[];
  /** Full conversation history sent to the model */
  history: Record<string, unknown>[];
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
  /** Cumulative token usage across all iterations */
  totalTokens?: TokenUsage;
  /** Model ID used for this session */
  modelId?: string;
}

/** Metadata used to index available agent tools in the UI */
export interface AgentToolMeta {
  name: AgentToolName;
  label: string;
  description: string;
  icon: string;
  dangerous?: boolean;
}

// ── MCP (Model Context Protocol) types ───────────────────────────────────────

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServerStatus {
  config: McpServerConfig;
  connected: boolean;
  tools: McpTool[];
  error?: string;
}

export const AGENT_TOOL_META: AgentToolMeta[] = [
  { name: "read_file",       label: "Read File",       description: "Read file contents",                             icon: "file-text" },
  { name: "write_file",      label: "Write File",      description: "Create or overwrite a file",                     icon: "file-pen" },
  { name: "edit_file",       label: "Edit File",       description: "Find-and-replace in an existing file",           icon: "file-pen" },
  { name: "delete_file",     label: "Delete File",     description: "Delete a file (auto-backed up)",                 icon: "trash-2",  dangerous: true },
  { name: "run_command",     label: "Run Command",     description: "Execute a shell command",                        icon: "terminal" },
  { name: "list_directory",  label: "List Directory",  description: "View file tree of a directory",                  icon: "folder-tree" },
  { name: "search_files",    label: "Search Files",    description: "Grep-style search across files",                 icon: "search" },
  { name: "get_diagnostics", label: "Diagnostics",     description: "Run type-check / cargo check / py_compile",     icon: "alert-circle" },
  { name: "fetch_url",       label: "Fetch URL",       description: "Fetch a web page or URL for research",          icon: "globe" },
];

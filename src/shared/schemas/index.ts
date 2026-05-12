import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

export const EndpointTypeSchema = z.enum(["openrouter", "xai", "kilocode", "custom"]);

export const ThemeModeSchema = z.enum(["light", "tokyo", "dark"]);

export const PublisherSchema = z.enum(["anthropic", "openrouter", "xai", "kilocode"]);

// ── AppSettings ───────────────────────────────────────────────────────────────

export const AppSettingsSchema = z.object({
  theme: ThemeModeSchema.default("light"),
  fontSize: z.number().int().min(8).max(32).default(14),
  fontFamily: z.string().default("system"),
  apiKey: z.string().default(""),
  openrouterKey: z.string().optional(),
  xaiKey: z.string().optional(),
  kilocodeKey: z.string().optional(),
  customLogin: z.string().optional(),
  customPassword: z.string().optional(),
  projectId: z.string().default(""),
  activeProject: z.string().optional(),
  showRawJson: z.boolean().optional(),
  showCosts: z.boolean().optional().default(true),
  agentTimeout: z.number().int().positive().optional(),
  blockFileDeletion: z.boolean().optional().default(false),
  customColors: z
    .object({
      accentColor: z.string().optional(),
      userMessageBg: z.string().optional(),
      assistantMessageBg: z.string().optional(),
    })
    .optional(),
});

export type AppSettingsParsed = z.infer<typeof AppSettingsSchema>;

// ── ModelConfig ───────────────────────────────────────────────────────────────

export const ModelPricingSchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  inputPremium: z.number().nonnegative().optional(),
  outputPremium: z.number().nonnegative().optional(),
});

export const ModelConfigSchema = z.object({
  id: z.string().min(1),
  publisher: PublisherSchema,
  modelId: z.string().min(1),
  aiStudioModelId: z.string().optional(),
  displayName: z.string().min(1),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  icon: z.string(),
  color: z.string(),
  description: z.string(),
  pricing: ModelPricingSchema,
  supports1MContext: z.boolean().optional(),
  supportsMemory: z.boolean().optional(),
  supportsGrounding: z.boolean().optional(),
  supportsDeepThinking: z.boolean().optional(),
  supportsImageGeneration: z.boolean().optional(),
  supportsDeepResearch: z.boolean().optional(),
  supportsTextToSpeech: z.boolean().optional(),
  supportsVideoGeneration: z.boolean().optional(),
  supportsSearch: z.boolean().optional(),
  defaultThinkingLevel: z.string().optional(),
  defaultGrounding: z.boolean().optional(),
  supportsServiceTier: z.boolean().optional(),
  endpointSupport: z.array(EndpointTypeSchema).min(1),
});

// ── Message ───────────────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  images: z.array(z.string()).optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  timestamp: z.number().optional(),
  streaming: z.boolean().optional(),
});

export const ChatSessionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  messages: z.array(MessageSchema),
  createdAt: z.number(),
  lastUpdated: z.number().optional(),
});

// ── Agent types ───────────────────────────────────────────────────────────────

export const AgentToolNameSchema = z.enum([
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "run_command",
  "list_directory",
  "search_files",
  "get_diagnostics",
  "fetch_url",
]);

export const AgentToolCallSchema = z.object({
  id: z.string(),
  tool: AgentToolNameSchema,
  input: z.record(z.string(), z.unknown()),
  result: z.string().optional(),
  isError: z.boolean().optional(),
  timestamp: z.number().optional(),
});

export const AgentStatusSchema = z.enum([
  "idle",
  "running",
  "paused",
  "complete",
  "cancelled",
  "error",
]);

export const AgentMessageSchema = z.object({
  id: z.string(),
  type: z.enum([
    "user",
    "assistant-text",
    "thinking",
    "tool-call",
    "tool-result",
    "error",
    "complete",
    "info",
  ]),
  content: z.string(),
  toolData: AgentToolCallSchema.optional(),
  iteration: z.number().int().optional(),
  timestamp: z.number().optional(),
});

// ── MCP types ─────────────────────────────────────────────────────────────────

export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Safely parse an unknown value against a Zod schema.
 * Returns `{ data, error: null }` on success or `{ data: null, error }` on failure.
 */
export function safeParse<T>(
  schema: z.ZodType<T>,
  value: unknown
): { data: T; error: null } | { data: null; error: z.ZodError } {
  const result = schema.safeParse(value);
  if (result.success) return { data: result.data, error: null };
  return { data: null, error: result.error };
}

/**
 * Parse with fallback — returns the default-filled parsed value on success,
 * or the provided fallback on failure (logging issues to the structured logger).
 */
export function parseWithFallback<T>(
  schema: z.ZodType<T>,
  value: unknown,
  fallback: T,
  context = "parseWithFallback"
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // Lazy import to avoid circular deps with logger
  import("@lib/logger").then(({ log }) =>
    log.warn(`${context}: schema validation failed`, { issues: result.error.issues })
  );
  return fallback;
}

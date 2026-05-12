import { describe, it, expect } from "vitest";
import {
  AppSettingsSchema,
  ModelConfigSchema,
  MessageSchema,
  ChatSessionSchema,
  AgentToolCallSchema,
  McpServerConfigSchema,
  safeParse,
} from "../index";

// ── AppSettingsSchema ─────────────────────────────────────────────────────────

describe("AppSettingsSchema", () => {
  const valid = {
    theme: "tokyo",
    fontSize: 14,
    fontFamily: "system",
    apiKey: "sk-abc",
    projectId: "proj-1",
    showCosts: true,
  };

  it("accepts a valid settings object", () => {
    const result = AppSettingsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("applies defaults for missing optional fields", () => {
    const result = AppSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.theme).toBe("light");
      expect(result.data.fontSize).toBe(14);
      expect(result.data.fontFamily).toBe("system");
    }
  });

  it("rejects an invalid theme value", () => {
    const result = AppSettingsSchema.safeParse({ ...valid, theme: "purple" });
    expect(result.success).toBe(false);
  });

  it("rejects fontSize outside 8–32 range", () => {
    expect(AppSettingsSchema.safeParse({ fontSize: 7 }).success).toBe(false);
    expect(AppSettingsSchema.safeParse({ fontSize: 33 }).success).toBe(false);
    expect(AppSettingsSchema.safeParse({ fontSize: 16 }).success).toBe(true);
  });

  it("accepts optional customColors", () => {
    const result = AppSettingsSchema.safeParse({
      ...valid,
      customColors: { accentColor: "#7aa2f7" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customColors?.accentColor).toBe("#7aa2f7");
    }
  });
});

// ── ModelConfigSchema ─────────────────────────────────────────────────────────

describe("ModelConfigSchema", () => {
  const valid = {
    id: "grok-4-3",
    publisher: "xai",
    modelId: "grok-4.3",
    displayName: "Grok 4.3",
    maxInputTokens: 2000000,
    maxOutputTokens: 32768,
    icon: "crown",
    color: "#FF6B00",
    description: "xAI flagship",
    pricing: { input: 0.00125, output: 0.0025 },
    endpointSupport: ["xai"],
  };

  it("accepts a valid model config", () => {
    expect(ModelConfigSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects negative pricing values", () => {
    const result = ModelConfigSchema.safeParse({
      ...valid,
      pricing: { input: -1, output: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty endpointSupport", () => {
    expect(
      ModelConfigSchema.safeParse({ ...valid, endpointSupport: [] }).success
    ).toBe(false);
  });

  it("rejects unknown publisher", () => {
    expect(
      ModelConfigSchema.safeParse({ ...valid, publisher: "google" }).success
    ).toBe(false);
  });
});

// ── MessageSchema ─────────────────────────────────────────────────────────────

describe("MessageSchema", () => {
  it("accepts a valid user message", () => {
    const result = MessageSchema.safeParse({ role: "user", content: "Hello" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid assistant message with tokens", () => {
    const result = MessageSchema.safeParse({
      role: "assistant",
      content: "Hi there",
      inputTokens: 10,
      outputTokens: 5,
      cost: 0.001,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown roles", () => {
    const result = MessageSchema.safeParse({ role: "system", content: "nope" });
    expect(result.success).toBe(false);
  });

  it("rejects negative token counts", () => {
    const result = MessageSchema.safeParse({
      role: "user",
      content: "Hi",
      inputTokens: -5,
    });
    expect(result.success).toBe(false);
  });
});

// ── ChatSessionSchema ─────────────────────────────────────────────────────────

describe("ChatSessionSchema", () => {
  it("accepts a valid session", () => {
    const result = ChatSessionSchema.safeParse({
      id: "sess-1",
      name: "My session",
      messages: [],
      createdAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = ChatSessionSchema.safeParse({
      id: "",
      name: "X",
      messages: [],
      createdAt: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ── AgentToolCallSchema ───────────────────────────────────────────────────────

describe("AgentToolCallSchema", () => {
  it("accepts a valid tool call", () => {
    const result = AgentToolCallSchema.safeParse({
      id: "call-1",
      tool: "read_file",
      input: { path: "/src/main.ts" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown tool name", () => {
    const result = AgentToolCallSchema.safeParse({
      id: "call-2",
      tool: "hack_nasa",
      input: {},
    });
    expect(result.success).toBe(false);
  });
});

// ── McpServerConfigSchema ─────────────────────────────────────────────────────

describe("McpServerConfigSchema", () => {
  it("accepts a valid MCP server config", () => {
    const result = McpServerConfigSchema.safeParse({
      name: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name or command", () => {
    expect(
      McpServerConfigSchema.safeParse({ name: "", command: "npx", args: [] }).success
    ).toBe(false);
    expect(
      McpServerConfigSchema.safeParse({ name: "fs", command: "", args: [] }).success
    ).toBe(false);
  });
});

// ── safeParse helper ──────────────────────────────────────────────────────────

describe("safeParse helper", () => {
  it("returns data on success", () => {
    const result = safeParse(MessageSchema, { role: "user", content: "Hi" });
    expect(result.error).toBeNull();
    expect(result.data?.role).toBe("user");
  });

  it("returns error on failure", () => {
    const result = safeParse(MessageSchema, { role: "bot", content: "Hi" });
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { AGENT_TOOL_META, FONT_OPTIONS } from "../index";

describe("AGENT_TOOL_META", () => {
  it("contains all expected tool names", () => {
    const names = AGENT_TOOL_META.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("delete_file");
    expect(names).toContain("run_command");
    expect(names).toContain("list_directory");
    expect(names).toContain("search_files");
    expect(names).toContain("get_diagnostics");
    expect(names).toContain("fetch_url");
  });

  it("every tool has required metadata fields", () => {
    for (const tool of AGENT_TOOL_META) {
      expect(tool.name).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.icon).toBeTruthy();
    }
  });

  it("delete_file is marked as dangerous", () => {
    const del = AGENT_TOOL_META.find((t) => t.name === "delete_file");
    expect(del?.dangerous).toBe(true);
  });

  it("non-destructive tools are not marked as dangerous", () => {
    const safe = AGENT_TOOL_META.filter((t) => t.name !== "delete_file");
    for (const tool of safe) {
      expect(tool.dangerous).toBeFalsy();
    }
  });
});

describe("FONT_OPTIONS", () => {
  it("includes System Default", () => {
    const systemFont = FONT_OPTIONS.find((f) => f.value === "system");
    expect(systemFont).toBeDefined();
    expect(systemFont?.label).toBe("System Default");
  });

  it("all options have value and label", () => {
    for (const font of FONT_OPTIONS) {
      expect(font.value).toBeTruthy();
      expect(font.label).toBeTruthy();
    }
  });
});

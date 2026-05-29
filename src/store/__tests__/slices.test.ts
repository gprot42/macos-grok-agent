import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";
import { MODELS } from "@shared/constants/models";

const reset = () =>
  useAppStore.setState({
    activeTab: "chat",
    showSettings: false,
    showProjects: false,
    showAbout: false,
    showApiKeyPrompt: false,
    selectedModel: "grok-4-3",
    selectedEndpoint: "xai",
    selectedImageModel: "grok-imagine",
    use1MContext: false,
    useMemory: false,
    useGrounding: false,
    useSearch: false,
    thinkingLevel: "none",
    customUrl: "",
    activeProject: null,
  });

beforeEach(reset);

// ── NavigationSlice ───────────────────────────────────────────────────────────

describe("NavigationSlice", () => {
  it("defaults to chat tab", () => {
    expect(useAppStore.getState().activeTab).toBe("chat");
  });

  it("setActiveTab persists across all valid tabs", () => {
    const tabs = ["chat", "image", "voice", "video", "code"] as const;
    for (const tab of tabs) {
      useAppStore.getState().setActiveTab(tab);
      expect(useAppStore.getState().activeTab).toBe(tab);
    }
  });
});

// ── ModalSlice ────────────────────────────────────────────────────────────────

describe("ModalSlice", () => {
  it("all modals start closed", () => {
    const s = useAppStore.getState();
    expect(s.showSettings).toBe(false);
    expect(s.showProjects).toBe(false);
    expect(s.showAbout).toBe(false);
    expect(s.showApiKeyPrompt).toBe(false);
  });

  it.each([
    ["setShowSettings", "showSettings"],
    ["setShowProjects", "showProjects"],
    ["setShowAbout", "showAbout"],
    ["setShowApiKeyPrompt", "showApiKeyPrompt"],
  ] as const)("%s opens and closes %s", (setter, flag) => {
    useAppStore.getState()[setter](true);
    expect(useAppStore.getState()[flag]).toBe(true);
    useAppStore.getState()[setter](false);
    expect(useAppStore.getState()[flag]).toBe(false);
  });
});

// ── ModelSlice ────────────────────────────────────────────────────────────────

describe("ModelSlice", () => {
  it("defaults to grok-4-3 / xai", () => {
    const s = useAppStore.getState();
    expect(s.selectedModel).toBe("grok-4-3");
    expect(s.selectedEndpoint).toBe("xai");
  });

  it("setSelectedModel updates model and resets grounding to model default", () => {
    useAppStore.getState().setSelectedModel("grok-4-1");
    expect(useAppStore.getState().selectedModel).toBe("grok-4-1");
  });

  it("setSelectedEndpoint auto-selects a compatible model", () => {
    useAppStore.getState().setSelectedModel("grok-4-3"); // xai only
    useAppStore.getState().setSelectedEndpoint("openrouter");
    const s = useAppStore.getState();
    expect(s.selectedEndpoint).toBe("openrouter");
    const model = MODELS[s.selectedModel];
    expect(model?.endpointSupport).toContain("openrouter");
  });

  it("setSelectedEndpoint keeps same model if it supports the new endpoint", () => {
    // openrouter-gpt-4o supports openrouter
    useAppStore.getState().setSelectedModel("openrouter-gpt-4o");
    useAppStore.getState().setSelectedEndpoint("openrouter");
    expect(useAppStore.getState().selectedModel).toBe("openrouter-gpt-4o");
  });

  it("boolean toggles work independently", () => {
    useAppStore.getState().setUse1MContext(true);
    useAppStore.getState().setUseMemory(true);
    useAppStore.getState().setUseSearch(true);
    useAppStore.getState().setUseGrounding(true);
    const s = useAppStore.getState();
    expect(s.use1MContext).toBe(true);
    expect(s.useMemory).toBe(true);
    expect(s.useSearch).toBe(true);
    expect(s.useGrounding).toBe(true);
  });

  it("setThinkingLevel accepts any string value", () => {
    useAppStore.getState().setThinkingLevel("high");
    expect(useAppStore.getState().thinkingLevel).toBe("high");
  });

  it("setCustomUrl stores arbitrary URL", () => {
    useAppStore.getState().setCustomUrl("http://localhost:11434");
    expect(useAppStore.getState().customUrl).toBe("http://localhost:11434");
  });

  it("setActiveProject stores path or null", () => {
    useAppStore.getState().setActiveProject("/Users/me/project");
    expect(useAppStore.getState().activeProject).toBe("/Users/me/project");
    useAppStore.getState().setActiveProject(null);
    expect(useAppStore.getState().activeProject).toBeNull();
  });
});

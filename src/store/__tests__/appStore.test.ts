import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "../appStore";
import { MODELS } from "@shared/constants/models";

// Reset Zustand store state between tests
beforeEach(() => {
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
});

describe("useAppStore – navigation", () => {
  it("defaults to the chat tab", () => {
    expect(useAppStore.getState().activeTab).toBe("chat");
  });

  it("setActiveTab updates the active tab", () => {
    useAppStore.getState().setActiveTab("code");
    expect(useAppStore.getState().activeTab).toBe("code");
  });
});

describe("useAppStore – modal flags", () => {
  it("all modals default to false", () => {
    const s = useAppStore.getState();
    expect(s.showSettings).toBe(false);
    expect(s.showProjects).toBe(false);
    expect(s.showAbout).toBe(false);
    expect(s.showApiKeyPrompt).toBe(false);
  });

  it("setShowSettings toggles settings modal", () => {
    useAppStore.getState().setShowSettings(true);
    expect(useAppStore.getState().showSettings).toBe(true);
    useAppStore.getState().setShowSettings(false);
    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it("setShowProjects toggles projects modal", () => {
    useAppStore.getState().setShowProjects(true);
    expect(useAppStore.getState().showProjects).toBe(true);
  });
});

describe("useAppStore – model/endpoint config", () => {
  it("defaults to grok-4-3 on xai endpoint", () => {
    const s = useAppStore.getState();
    expect(s.selectedModel).toBe("grok-4-3");
    expect(s.selectedEndpoint).toBe("xai");
  });

  it("setSelectedModel updates model id", () => {
    useAppStore.getState().setSelectedModel("grok-4-1");
    expect(useAppStore.getState().selectedModel).toBe("grok-4-1");
  });

  it("setSelectedEndpoint switches to openrouter and auto-selects a compatible model", () => {
    // Start on xai with a grok model
    useAppStore.getState().setSelectedModel("grok-4-3");
    useAppStore.getState().setSelectedEndpoint("openrouter");

    const s = useAppStore.getState();
    expect(s.selectedEndpoint).toBe("openrouter");
    // The model must now support openrouter
    // (grok-4-3 only supports xai, so it should have switched)
    const model = MODELS[s.selectedModel];
    expect(model?.endpointSupport).toContain("openrouter");
  });

  it("setUse1MContext toggles the flag", () => {
    useAppStore.getState().setUse1MContext(true);
    expect(useAppStore.getState().use1MContext).toBe(true);
  });

  it("setUseSearch toggles the flag", () => {
    useAppStore.getState().setUseSearch(true);
    expect(useAppStore.getState().useSearch).toBe(true);
  });

  it("setThinkingLevel updates thinking level", () => {
    useAppStore.getState().setThinkingLevel("high");
    expect(useAppStore.getState().thinkingLevel).toBe("high");
  });

  it("setActiveProject updates active project", () => {
    useAppStore.getState().setActiveProject("/home/user/projects/myapp");
    expect(useAppStore.getState().activeProject).toBe("/home/user/projects/myapp");
  });

  it("setCustomUrl updates custom URL", () => {
    useAppStore.getState().setCustomUrl("http://localhost:11434");
    expect(useAppStore.getState().customUrl).toBe("http://localhost:11434");
  });
});

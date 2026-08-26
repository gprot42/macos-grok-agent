import { describe, it, expect } from "vitest";
import {
  MODELS,
  ENDPOINT_URLS,
  GROK_46_THINKING_OPTIONS,
  getThinkingOptions,
  isGrok46,
  resolveThinkingLevel,
} from "../models";

describe("MODELS registry", () => {
  it("contains at least one model", () => {
    expect(Object.keys(MODELS).length).toBeGreaterThan(0);
  });

  it("every model has required fields", () => {
    for (const [id, model] of Object.entries(MODELS)) {
      expect(model.id, `${id}: id`).toBe(id);
      expect(model.modelId, `${id}: modelId`).toBeTruthy();
      expect(model.displayName, `${id}: displayName`).toBeTruthy();
      expect(model.maxInputTokens, `${id}: maxInputTokens`).toBeGreaterThan(0);
      expect(model.maxOutputTokens, `${id}: maxOutputTokens`).toBeGreaterThan(0);
      expect(model.pricing.input, `${id}: pricing.input`).toBeGreaterThanOrEqual(0);
      expect(model.pricing.output, `${id}: pricing.output`).toBeGreaterThanOrEqual(0);
      expect(model.endpointSupport, `${id}: endpointSupport`).toBeInstanceOf(Array);
      expect(model.endpointSupport.length, `${id}: endpointSupport not empty`).toBeGreaterThan(0);
    }
  });

  it("includes Grok 4.6 as the flagship with Auto/Fast/Expert/Heavy modes", () => {
    const grok46 = MODELS["grok-4-6"];
    expect(grok46).toBeDefined();
    expect(grok46.modelId).toBe("grok-4.6");
    expect(grok46.displayName).toBe("Grok 4.6");
    expect(grok46.supportsDeepThinking).toBe(true);
    expect(grok46.supportsSearch).toBe(true);
    expect(grok46.defaultThinkingLevel).toBe("medium");
    expect(grok46.maxInputTokens).toBe(500000);
    expect(grok46.endpointSupport).toEqual(["xai"]);
    expect(isGrok46(grok46)).toBe(true);

    const labels = GROK_46_THINKING_OPTIONS.map((o) => o.label);
    expect(labels).toEqual(["Auto", "Fast", "Expert", "Heavy"]);

    const options = getThinkingOptions(grok46, "xai");
    expect(options.map((o) => o.label)).toEqual(["Auto", "Fast", "Expert", "Heavy"]);
    expect(options.map((o) => o.value)).toEqual(["medium", "low", "high", "xhigh"]);

    expect(resolveThinkingLevel(grok46, "none")).toBe("medium");
    expect(resolveThinkingLevel(grok46, "high")).toBe("high");
    expect(resolveThinkingLevel(grok46, "xhigh")).toBe("xhigh");
  });

  it("xAI models only support the xai endpoint", () => {
    const xaiModels = Object.values(MODELS).filter((m) => m.publisher === "xai");
    for (const model of xaiModels) {
      expect(model.endpointSupport).toContain("xai");
    }
  });

  it("kilocode models only support the kilocode endpoint", () => {
    const kiloModels = Object.values(MODELS).filter((m) => m.publisher === "kilocode");
    for (const model of kiloModels) {
      expect(model.endpointSupport).toContain("kilocode");
    }
  });

  it("image generation models are flagged correctly", () => {
    const image2 = MODELS["grok-imagine-image-2"];
    expect(image2).toBeDefined();
    expect(image2.supportsImageGeneration).toBe(true);
    expect(image2.modelId).toBe("grok-imagine-image-2");
    expect(image2.displayName).toMatch(/2\.0/);

    const imageMod = MODELS["grok-imagine"];
    expect(imageMod).toBeDefined();
    expect(imageMod.supportsImageGeneration).toBe(true);

    const quality = MODELS["grok-imagine-quality"];
    expect(quality?.supportsImageGeneration).toBe(true);
    expect(quality?.modelId).toBe("grok-imagine-image-quality");
  });

  it("video generation models are flagged correctly", () => {
    const videoMod = MODELS["grok-imagine-video-1-5"];
    expect(videoMod).toBeDefined();
    expect(videoMod.supportsVideoGeneration).toBe(true);
    expect(videoMod.modelId).toBe("grok-imagine-video-1.5");
  });

  it("TTS models are flagged correctly", () => {
    const ttsMod = MODELS["grok-voice"];
    expect(ttsMod).toBeDefined();
    expect(ttsMod.supportsTextToSpeech).toBe(true);
  });

  it("voice agent models include Think Fast 2.0", () => {
    const v2 = MODELS["grok-voice-think-fast-2.0"];
    expect(v2).toBeDefined();
    expect(v2.supportsVoiceAgent).toBe(true);
    expect(v2.modelId).toBe("grok-voice-think-fast-2.0");
    expect(v2.endpointSupport).toContain("xai");

    const v1 = MODELS["grok-voice-think-fast-1.0"];
    expect(v1?.supportsVoiceAgent).toBe(true);

    const latest = MODELS["grok-voice-latest"];
    expect(latest?.supportsVoiceAgent).toBe(true);
  });
});

describe("ENDPOINT_URLS", () => {
  it("defines xai endpoint URL", () => {
    expect(ENDPOINT_URLS.xai).toMatch(/^https:\/\//);
  });

  it("defines openrouter endpoint URL", () => {
    expect(ENDPOINT_URLS.openrouter).toMatch(/^https:\/\//);
  });

  it("defines kilocode endpoint URL", () => {
    expect(ENDPOINT_URLS.kilocode).toMatch(/^https:\/\//);
  });
});

import { describe, it, expect } from "vitest";
import { MODELS, ENDPOINT_URLS } from "../models";

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
    const imageMod = MODELS["grok-imagine"];
    expect(imageMod).toBeDefined();
    expect(imageMod.supportsImageGeneration).toBe(true);
  });

  it("video generation models are flagged correctly", () => {
    const videoMod = MODELS["grok-video"];
    expect(videoMod).toBeDefined();
    expect(videoMod.supportsVideoGeneration).toBe(true);
  });

  it("TTS models are flagged correctly", () => {
    const ttsMod = MODELS["grok-voice"];
    expect(ttsMod).toBeDefined();
    expect(ttsMod.supportsTextToSpeech).toBe(true);
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

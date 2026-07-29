import { describe, it, expect } from "vitest";
import {
  float32ToPCM16Base64,
  base64PCM16ToFloat32,
  nearestSupportedSampleRate,
  SUPPORTED_SAMPLE_RATES,
} from "../audio";

describe("nearestSupportedSampleRate", () => {
  it("returns exact matches", () => {
    for (const rate of SUPPORTED_SAMPLE_RATES) {
      expect(nearestSupportedSampleRate(rate)).toBe(rate);
    }
  });

  it("snaps common browser rates", () => {
    expect(nearestSupportedSampleRate(48000)).toBe(48000);
    expect(nearestSupportedSampleRate(44100)).toBe(44100);
    expect(nearestSupportedSampleRate(96000)).toBe(48000);
  });
});

describe("PCM16 round-trip", () => {
  it("round-trips silence", () => {
    const input = new Float32Array(100);
    const b64 = float32ToPCM16Base64(input);
    const out = base64PCM16ToFloat32(b64);
    expect(out.length).toBe(100);
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBeCloseTo(0, 5);
    }
  });

  it("round-trips a sine-like amplitude", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const b64 = float32ToPCM16Base64(input);
    const out = base64PCM16ToFloat32(b64);
    expect(out.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) {
      expect(out[i]).toBeCloseTo(input[i], 3);
    }
  });
});

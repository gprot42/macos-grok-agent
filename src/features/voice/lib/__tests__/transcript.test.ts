import { describe, expect, it } from "vitest";
import { buildSegments, formatDuration, speakerTranscript, srtTime, toSrt, type SttWord } from "../transcript";

const w = (text: string, start: number, end: number, speaker?: number): SttWord => ({ text, start, end, speaker });

describe("transcript helpers", () => {
  it("formats durations and SRT timestamps", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(srtTime(3661.5)).toBe("01:01:01,500");
    expect(srtTime(0.24)).toBe("00:00:00,240");
  });

  it("breaks segments on sentence end, long pauses and speaker change", () => {
    const segs = buildSegments([
      w("Hello", 0, 0.4, 0), w("there.", 0.4, 0.8, 0),
      w("How", 0.9, 1.1, 0), w("are", 1.1, 1.3, 0),
      w("you", 3.0, 3.2, 0), // >1s pause
      w("Fine", 3.3, 3.6, 1), w("thanks.", 3.6, 4.0, 1),
    ]);
    expect(segs.map((s) => s.text)).toEqual(["Hello there.", "How are", "you", "Fine thanks."]);
    expect(segs[3].speaker).toBe(1);
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBe(0.8);
  });

  it("caps segments at subtitle length", () => {
    const words = Array.from({ length: 30 }, (_, i) => w(`w${i}`, i * 0.2, i * 0.2 + 0.1));
    const segs = buildSegments(words);
    expect(segs.length).toBe(3);
    expect(segs[0].text.split(" ").length).toBe(14);
  });

  it("merges speaker turns for plain text and labels SRT cues", () => {
    const segs = buildSegments([
      w("Hi.", 0, 0.3, 0), w("Welcome.", 0.4, 0.9, 0), w("Thanks.", 1.0, 1.4, 1),
    ]);
    expect(speakerTranscript(segs)).toBe("Speaker 1: Hi. Welcome.\n\nSpeaker 2: Thanks.");
    const srt = toSrt(segs);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:00,300\nSpeaker 1: Hi.");
    expect(srt).toContain("3\n00:00:01,000 --> 00:00:01,400\nSpeaker 2: Thanks.");
  });

  it("omits speaker labels when not diarized", () => {
    const segs = buildSegments([w("Plain", 0, 0.3), w("text.", 0.3, 0.6)]);
    expect(speakerTranscript(segs)).toBe("Plain text.");
    expect(toSrt(segs)).toContain("\nPlain text.\n");
  });
});

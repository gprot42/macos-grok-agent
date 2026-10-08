import { describe, expect, it } from "vitest";
import {
  batchName,
  customIdFor,
  extractVideoResult,
  isOurBatch,
  parsePromptLines,
  promptIndexFromCustomId,
  summarizeBatch,
} from "../batch";

describe("video batch helpers", () => {
  it("parses one prompt per non-empty line", () => {
    expect(parsePromptLines(" a cat \n\n  \na dog\n")).toEqual(["a cat", "a dog"]);
  });

  it("round-trips request ids", () => {
    expect(customIdFor(0)).toBe("v-001");
    expect(customIdFor(41)).toBe("v-042");
    expect(promptIndexFromCustomId("v-042")).toBe(41);
    expect(promptIndexFromCustomId("other")).toBeNull();
  });

  it("names batches so the app can recognise its own", () => {
    const name = batchName(3, "a very long prompt about a cat walking across a sunny garden at dawn", new Date("2026-10-08T12:34:00Z"));
    expect(name.startsWith("grok-agent-video: 3 × ")).toBe(true);
    expect(name).toContain("…");
    expect(name).toContain("2026-10-08 12:34");
    expect(isOurBatch({ batch_id: "b", name })).toBe(true);
    expect(isOurBatch({ batch_id: "b", name: "chat eval" })).toBe(false);
  });

  it("summarises progress and phase", () => {
    const running = summarizeBatch({ batch_id: "b", state: { num_requests: 4, num_pending: 3, num_success: 1 } });
    expect(running.phase).toBe("running");
    expect(running.progress).toBe(0.25);
    const done = summarizeBatch({ batch_id: "b", state: { num_requests: 4, num_pending: 0, num_success: 3, num_error: 1 } });
    expect(done.phase).toBe("done");
    expect(done.progress).toBe(1);
    const cancelled = summarizeBatch({
      batch_id: "b",
      cancel_time: "2026-10-08T12:00:00Z",
      state: { num_requests: 4, num_pending: 0, num_success: 1, num_cancelled: 3 },
    });
    expect(cancelled.phase).toBe("cancelled");
  });

  it("extracts video urls and errors from results", () => {
    expect(
      extractVideoResult({
        batch_request_id: "v-001",
        batch_result: { response: { video_generation: { video: { url: "https://x/v.mp4" } } } },
      }),
    ).toEqual({ customId: "v-001", url: "https://x/v.mp4", error: null });
    expect(extractVideoResult({ batch_request_id: "v-002", batch_result: { error: "moderated" } })).toEqual({
      customId: "v-002",
      url: null,
      error: "moderated",
    });
    expect(extractVideoResult({ batch_request_id: "v-003", error_message: "bad prompt" }).error).toBe("bad prompt");
  });
});

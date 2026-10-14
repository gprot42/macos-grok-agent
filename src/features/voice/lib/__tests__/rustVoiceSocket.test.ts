import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (e: { payload: unknown }) => void;
let listener: Listener | null = null;
const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: Listener) => {
    listener = cb;
    return () => {
      listener = null;
    };
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { RustVoiceSocket, SOCKET_OPEN } from "../rustVoiceSocket";

describe("RustVoiceSocket", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listener = null;
  });

  it("delivers frames that arrive before the caller attaches handlers, in order", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "voice_ws_connect") {
        // The server speaks first, before connect() even returns.
        listener?.({ payload: { session: 7, kind: "message", data: '{"type":"conversation.created"}' } });
        return { session: 7, credential: "xAI API key", fallbackUsed: true };
      }
    });
    const { socket, info } = await RustVoiceSocket.connect("k", "grok-voice-3.0");
    const got: string[] = [];
    const opened = vi.fn();
    socket.onopen = opened;
    socket.onmessage = (e) => got.push(e.data);
    listener?.({ payload: { session: 7, kind: "message", data: '{"type":"session.updated"}' } });
    await new Promise((r) => setTimeout(r, 5));
    expect(info.fallbackUsed).toBe(true);
    expect(opened).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(SOCKET_OPEN);
    expect(got).toEqual(['{"type":"conversation.created"}', '{"type":"session.updated"}']);
  });

  it("ignores other sessions and reports server closes", async () => {
    invokeMock.mockResolvedValue({ session: 2, credential: "SuperGrok sign-in", fallbackUsed: false });
    const { socket } = await RustVoiceSocket.connect("k", "grok-voice-3.0");
    const got: string[] = [];
    const closed = vi.fn();
    socket.onmessage = (e) => got.push(e.data);
    socket.onclose = closed;
    await new Promise((r) => setTimeout(r, 5));
    listener?.({ payload: { session: 1, kind: "message", data: "stale" } });
    listener?.({ payload: { session: 2, kind: "close", code: 1011, reason: "boom" } });
    expect(got).toEqual([]);
    expect(closed).toHaveBeenCalledWith({ code: 1011, reason: "boom" });
  });

  it("rejects with the backend's reason when every credential is refused", async () => {
    invokeMock.mockRejectedValue("xAI refused realtime voice for your SuperGrok sign-in");
    await expect(RustVoiceSocket.connect("k", "grok-voice-3.0")).rejects.toMatch(/refused/);
    expect(listener).toBeNull();
  });
});

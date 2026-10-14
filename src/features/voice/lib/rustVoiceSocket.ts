/**
 * Live Agent socket backed by the Rust realtime proxy (`voice_ws_*` commands).
 *
 * Exposes the slice of the browser `WebSocket` API the voice hook uses —
 * `readyState`, `send`, `close` and the `on*` callbacks — so the session logic
 * stays the same while authentication happens in Rust with a real
 * Authorization header (SuperGrok first, then a saved API key).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface VoiceWsEvent {
  session: number;
  kind: "message" | "close";
  data?: string;
  code?: number;
  reason?: string;
}

export interface VoiceConnectInfo {
  session: number;
  /** Which credential the server accepted, e.g. "SuperGrok sign-in" or "xAI API key". */
  credential: string;
  fallbackUsed: boolean;
}

export const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

export class RustVoiceSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  private session: number | null = null;
  private unlisten: UnlistenFn | null = null;
  /** Events that arrive before we know our session id (the server talks first). */
  private early: VoiceWsEvent[] = [];

  /** Opens the proxy; rejects with xAI's reason if every credential is refused. */
  static async connect(apiKey: string, model: string): Promise<{ socket: RustVoiceSocket; info: VoiceConnectInfo }> {
    const socket = new RustVoiceSocket();
    socket.unlisten = await listen<VoiceWsEvent>("voice-ws", ({ payload }) => socket.handle(payload));
    try {
      const info = await invoke<VoiceConnectInfo>("voice_ws_connect", { apiKey, model });
      socket.session = info.session;
      // Open on a later task: the caller attaches its handlers when this await
      // resumes (a microtask), so a microtask here would fire before them and
      // drop the server's first frames. Events keep buffering until then.
      setTimeout(() => {
        socket.readyState = SOCKET_OPEN;
        socket.onopen?.();
        const pending = socket.early;
        socket.early = [];
        pending.forEach((e) => socket.handle(e));
      }, 0);
      return { socket, info };
    } catch (e) {
      socket.dispose();
      throw e;
    }
  }

  private handle(ev: VoiceWsEvent) {
    if (this.session === null || this.readyState === 0) {
      this.early.push(ev);
      return;
    }
    if (ev.session !== this.session) return;
    if (ev.kind === "message" && ev.data !== undefined) {
      this.onmessage?.({ data: ev.data });
    } else if (ev.kind === "close") {
      this.readyState = SOCKET_CLOSED;
      this.dispose();
      this.onclose?.({ code: ev.code ?? 1006, reason: ev.reason ?? "" });
    }
  }

  send(text: string) {
    if (this.readyState !== SOCKET_OPEN) return;
    void invoke("voice_ws_send", { text }).catch(() => this.onerror?.());
  }

  close(_code?: number, _reason?: string) {
    if (this.readyState === SOCKET_CLOSED) return;
    this.readyState = SOCKET_CLOSED;
    void invoke("voice_ws_close").catch(() => {});
    this.dispose();
    this.onclose?.({ code: 1000, reason: "user disconnect" });
  }

  private dispose() {
    this.unlisten?.();
    this.unlisten = null;
  }
}

/**
 * Structured logging utility.
 *
 * In production (Tauri), warnings and errors are forwarded to the Rust backend
 * via the `log_event` command so they appear in the system log.
 * In development / tests, output goes to the browser console.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function formatEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
  return { level, message, context, timestamp: new Date().toISOString() };
}

async function sendToRust(entry: LogEntry): Promise<void> {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("log_event", { entry }).catch(() => {
      // log_event may not be registered in all builds — fail silently
    });
  } catch {
    // tauri api not available in test environment
  }
}

function consoleOutput(entry: LogEntry): void {
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
  const args: unknown[] = [prefix, entry.message];
  if (entry.context) args.push(entry.context);

  switch (entry.level) {
    case "debug":
      // Only log debug in development
      if (import.meta.env.DEV) console.log(...args);
      break;
    case "info":
      if (import.meta.env.DEV) console.log(...args);
      break;
    case "warn":
      console.warn(...args);
      break;
    case "error":
      console.error(...args);
      break;
  }
}

function createLogger() {
  function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry = formatEntry(level, message, context);
    consoleOutput(entry);
    if (level === "warn" || level === "error") {
      void sendToRust(entry);
    }
  }

  return {
    debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
    info:  (msg: string, ctx?: Record<string, unknown>) => write("info",  msg, ctx),
    warn:  (msg: string, ctx?: Record<string, unknown>) => write("warn",  msg, ctx),
    error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
  };
}

export const log = createLogger();

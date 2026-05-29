import "@testing-library/jest-dom";
import { vi } from "vitest";

// ── localStorage polyfill for jsdom + Zustand persist middleware ─────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ── Mock Tauri APIs (not available in jsdom) ──────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    load: vi.fn(),
  })),
  load: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
  Command: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
  readText: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

// ── Suppress noisy console output in tests ────────────────────────────────────
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  // Suppress React act() warnings in tests
  if (typeof args[0] === "string" && args[0].includes("act(")) return;
  originalConsoleError(...args);
};

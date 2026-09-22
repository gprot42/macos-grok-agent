import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  MODELS,
  defaultChatModelId,
  resolveThinkingLevel,
} from "@shared/constants/models";
import {
  createNavigationSlice,
  createModalSlice,
  createModelSlice,
} from "./slices";
import type { NavigationSlice, ModalSlice, ModelSlice, TabType } from "./slices";

// Re-export for consumers that previously imported TabType from here
export type { TabType };

// ── Combined store type ───────────────────────────────────────────────────────
type AppState = NavigationSlice & ModalSlice & ModelSlice;

// ── Persisted keys (user preferences only — no ephemeral modal state) ─────────
export type PersistedState = Pick<
  AppState,
  | "activeTab"
  | "selectedModel"
  | "selectedEndpoint"
  | "use1MContext"
  | "useMemory"
  | "useSearch"
  | "thinkingLevel"
  | "customUrl"
  | "activeProject"
>;

/** Persist schema version. v1 moves a stored model that no longer exists to the current default. */
export const APP_STATE_VERSION = 1;

export function migratePersistedAppState(
  persistedState: unknown,
  version: number,
): PersistedState {
  const state = { ...(persistedState as PersistedState) };
  if (version < 1) {
    const endpoint = state.selectedEndpoint ?? "xai";
    // Retired models (Grok 4.1 / 4.3 / 4.20) are no longer in MODELS — fall back to the default.
    if (!state.selectedModel || !MODELS[state.selectedModel]) {
      state.selectedModel = defaultChatModelId(endpoint);
    }
  }
  return state;
}

export const useAppStore = create<AppState>()(
  persist(
    (...args) => ({
      ...createNavigationSlice(...args),
      ...createModalSlice(...args),
      ...createModelSlice(...args),
    }),
    {
      name: "cortex-app-state",
      version: APP_STATE_VERSION,
      migrate: migratePersistedAppState,

      partialize: (s): PersistedState => ({
        activeTab: s.activeTab,
        selectedModel: s.selectedModel,
        selectedEndpoint: s.selectedEndpoint,
        use1MContext: s.use1MContext,
        useMemory: s.useMemory,
        useSearch: s.useSearch,
        thinkingLevel: s.thinkingLevel,
        customUrl: s.customUrl,
        activeProject: s.activeProject,
      }),

      // Validate rehydrated model ID — reset to a safe default if the model no longer exists
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!MODELS[state.selectedModel]) {
          state.selectedModel = defaultChatModelId(state.selectedEndpoint);
        }
        state.thinkingLevel = resolveThinkingLevel(
          MODELS[state.selectedModel],
          state.thinkingLevel,
        );
      },
    }
  )
);

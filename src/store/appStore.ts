import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODELS } from "@shared/constants/models";
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
type PersistedState = Pick<
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

export const useAppStore = create<AppState>()(
  persist(
    (...args) => ({
      ...createNavigationSlice(...args),
      ...createModalSlice(...args),
      ...createModelSlice(...args),
    }),
    {
      name: "cortex-app-state",

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
          const fallback = Object.values(MODELS).find(
            (m) =>
              m.endpointSupport.includes(state.selectedEndpoint) &&
              !m.supportsImageGeneration &&
              !m.supportsVideoGeneration &&
              !m.supportsTextToSpeech
          );
          state.selectedModel = fallback?.id ?? "grok-4-3";
        }
      },
    }
  )
);

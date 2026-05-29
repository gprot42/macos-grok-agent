import type { StateCreator } from "zustand";

export interface ModalSlice {
  showSettings: boolean;
  showProjects: boolean;
  showAbout: boolean;
  showApiKeyPrompt: boolean;
  setShowSettings: (v: boolean) => void;
  setShowProjects: (v: boolean) => void;
  setShowAbout: (v: boolean) => void;
  setShowApiKeyPrompt: (v: boolean) => void;
}

export const createModalSlice: StateCreator<ModalSlice> = (set) => ({
  showSettings: false,
  showProjects: false,
  showAbout: false,
  showApiKeyPrompt: false,
  setShowSettings: (v) => set({ showSettings: v }),
  setShowProjects: (v) => set({ showProjects: v }),
  setShowAbout: (v) => set({ showAbout: v }),
  setShowApiKeyPrompt: (v) => set({ showApiKeyPrompt: v }),
});

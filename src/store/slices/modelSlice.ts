import type { StateCreator } from "zustand";
import { MODELS } from "@shared/constants/models";
import type { EndpointType } from "@shared/types";

export interface ModelSlice {
  selectedModel: string;
  selectedEndpoint: EndpointType;
  selectedImageModel: string;
  use1MContext: boolean;
  useMemory: boolean;
  useGrounding: boolean;
  useSearch: boolean;
  thinkingLevel: string;
  customUrl: string;
  activeProject: string | null;

  setSelectedModel: (id: string) => void;
  /** Also auto-switches model when it doesn't support the new endpoint. */
  setSelectedEndpoint: (ep: EndpointType) => void;
  setUse1MContext: (v: boolean) => void;
  setUseMemory: (v: boolean) => void;
  setUseGrounding: (v: boolean) => void;
  setUseSearch: (v: boolean) => void;
  setThinkingLevel: (level: string) => void;
  setCustomUrl: (url: string) => void;
  setActiveProject: (p: string | null) => void;
}

export const createModelSlice: StateCreator<ModelSlice> = (set, get) => ({
  selectedModel: "grok-4-3",
  selectedEndpoint: "xai",
  selectedImageModel: "grok-imagine-quality",
  use1MContext: false,
  useMemory: false,
  useGrounding: false,
  useSearch: false,
  thinkingLevel: "none",
  customUrl: "",
  activeProject: null,

  setSelectedModel: (id) => {
    const model = MODELS[id];
    set({
      selectedModel: id,
      useGrounding: model?.defaultGrounding ?? false,
    });
  },

  setSelectedEndpoint: (ep) => {
    const { selectedModel } = get();
    const current = MODELS[selectedModel];
    let newModel = selectedModel;
    if (current && !current.endpointSupport.includes(ep)) {
      const first = Object.values(MODELS).find(
        (m) =>
          m.endpointSupport.includes(ep) &&
          !m.supportsImageGeneration &&
          !m.supportsVideoGeneration &&
          !m.supportsTextToSpeech
      );
      if (first) newModel = first.id;
    }
    set({ selectedEndpoint: ep, selectedModel: newModel });
  },

  setUse1MContext: (v) => set({ use1MContext: v }),
  setUseMemory: (v) => set({ useMemory: v }),
  setUseGrounding: (v) => set({ useGrounding: v }),
  setUseSearch: (v) => set({ useSearch: v }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  setCustomUrl: (url) => set({ customUrl: url }),
  setActiveProject: (p) => set({ activeProject: p }),
});

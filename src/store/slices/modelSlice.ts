import type { StateCreator } from "zustand";
import {
  DEFAULT_CHAT_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  MODELS,
  defaultChatModelId,
  resolveImageModelId,
  resolveThinkingLevel,
} from "@shared/constants/models";
import type { EndpointType } from "@shared/types";

export interface ModelSlice {
  selectedModel: string;
  selectedEndpoint: EndpointType;
  selectedImageModel: string;
  selectedVideoModel: string;
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
  setSelectedImageModel: (id: string) => void;
  setSelectedVideoModel: (id: string) => void;
  setUse1MContext: (v: boolean) => void;
  setUseMemory: (v: boolean) => void;
  setUseGrounding: (v: boolean) => void;
  setUseSearch: (v: boolean) => void;
  setThinkingLevel: (level: string) => void;
  setCustomUrl: (url: string) => void;
  setActiveProject: (p: string | null) => void;
}

export const createModelSlice: StateCreator<ModelSlice> = (set, get) => ({
  selectedModel: DEFAULT_CHAT_MODEL_ID,
  selectedEndpoint: "xai",
  selectedImageModel: DEFAULT_IMAGE_MODEL_ID,
  selectedVideoModel: "grok-imagine-video-1-5",
  use1MContext: false,
  useMemory: false,
  useGrounding: false,
  useSearch: false,
  thinkingLevel: "medium",
  customUrl: "",
  activeProject: null,

  setSelectedModel: (id) => {
    const model = MODELS[id];
    set({
      selectedModel: id,
      useGrounding: model?.defaultGrounding ?? false,
      thinkingLevel: resolveThinkingLevel(model, get().thinkingLevel),
    });
  },

  setSelectedEndpoint: (ep) => {
    const { selectedModel } = get();
    const current = MODELS[selectedModel];
    let newModel = selectedModel;
    if (current && !current.endpointSupport.includes(ep)) {
      newModel = defaultChatModelId(ep);
    }
    set({
      selectedEndpoint: ep,
      selectedModel: newModel,
      thinkingLevel: resolveThinkingLevel(MODELS[newModel], get().thinkingLevel),
    });
  },

  setSelectedImageModel: (id) => set({ selectedImageModel: resolveImageModelId(id) }),
  setSelectedVideoModel: (id) => set({ selectedVideoModel: id }),
  setUse1MContext: (v) => set({ use1MContext: v }),
  setUseMemory: (v) => set({ useMemory: v }),
  setUseGrounding: (v) => set({ useGrounding: v }),
  setUseSearch: (v) => set({ useSearch: v }),
  setThinkingLevel: (level) => set({ thinkingLevel: level }),
  setCustomUrl: (url) => set({ customUrl: url }),
  setActiveProject: (p) => set({ activeProject: p }),
});

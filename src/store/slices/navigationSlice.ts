import type { StateCreator } from "zustand";

export type TabType = "chat" | "image" | "voice" | "video" | "code";

export interface NavigationSlice {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export const createNavigationSlice: StateCreator<NavigationSlice> = (set) => ({
  activeTab: "chat",
  setActiveTab: (tab) => set({ activeTab: tab }),
});

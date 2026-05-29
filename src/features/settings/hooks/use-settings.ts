import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ThemeMode, AppSettings } from "@shared/types";
import { AppSettingsSchema } from "@shared/schemas";
import { log } from "@lib/logger";

const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  fontSize: 14,
  fontFamily: "system",
  apiKey: "",
  projectId: "",
  showCosts: true,
  blockFileDeletion: false,
};

const FONT_FAMILIES: Record<string, string> = {
  system: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  inter: "Inter, system-ui, sans-serif",
  "sf-pro": "'SF Pro Text', system-ui, sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
  "fira-code": "'Fira Code', monospace",
  roboto: "Roboto, system-ui, sans-serif",
  "source-code": "'Source Code Pro', monospace",
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const saved = await invoke<AppSettings | null>("load_settings");
      if (saved) {
        const parsed = AppSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...saved });
        if (!parsed.success) {
          log.warn("useSettings: loaded settings failed validation, using safe defaults", {
            issues: parsed.error.issues,
          });
        }
        const merged = parsed.success ? (parsed.data as AppSettings) : { ...DEFAULT_SETTINGS, ...saved };
        setSettings(merged);
        applyTheme(merged.theme);
        applyFont(merged.fontFamily || "system", merged.fontSize);
      }
    } catch (e) {
      log.error("Failed to load settings", { error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const applyTheme = (theme: ThemeMode) => {
    const root = document.documentElement;
    root.classList.remove("light", "dark", "tokyo");
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "tokyo") {
      root.classList.add("tokyo");
    }
  };

  const applyFont = (fontFamily: string, fontSize: number) => {
    const root = document.documentElement;
    root.style.setProperty("--font-family", FONT_FAMILIES[fontFamily] || FONT_FAMILIES.system);
    root.style.setProperty("--font-size", `${fontSize}px`);
    document.body.style.fontFamily = FONT_FAMILIES[fontFamily] || FONT_FAMILIES.system;
    document.body.style.fontSize = `${fontSize}px`;
  };

  const updateSettings = useCallback(async (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    
    if (updates.theme) {
      applyTheme(updates.theme);
    }
    
    if (updates.fontFamily !== undefined || updates.fontSize !== undefined) {
      applyFont(newSettings.fontFamily, newSettings.fontSize);
    }
    
    try {
      await invoke("save_settings", { settings: newSettings });
    } catch (e) {
      log.error("Failed to save settings", { error: String(e) });
    }
  }, [settings]);

  const saveApiKey = useCallback(async (apiKey: string) => {
    try {
      await invoke("save_api_key", { apiKey });
      setSettings(prev => ({ ...prev, apiKey }));
    } catch (e) {
      log.error("Failed to save API key", { error: String(e) });
    }
  }, []);

  return { settings, updateSettings, saveApiKey, loading };
}

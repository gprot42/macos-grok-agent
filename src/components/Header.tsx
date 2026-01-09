import { useState, useRef, useEffect } from "react";
import { ThemeMode } from "../types";

interface HeaderProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  activeTab: "chat" | "image" | "research";
  onTabChange: (tab: "chat" | "image" | "research") => void;
  onShowSettings: () => void;
  onShowProjects: () => void;
  onShowAbout: () => void;
  activeProject: string | null;
}

export function Header({
  theme,
  onThemeChange,
  activeTab,
  onTabChange,
  onShowSettings,
  onShowProjects,
  onShowAbout,
  activeProject,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const themeLabels: Record<ThemeMode, string> = {
    light: "Light",
    tokyo: "Tokyo Night",
    dark: "Dark",
  };

  return (
    <header className="bg-white dark:bg-tokyo-surface border-b border-gray-200 dark:border-tokyo-border px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
            Cortex Agent
          </h1>

          {activeProject && (
            <div className="flex items-center gap-2 px-3 py-1 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
              <span className="text-xs text-indigo-600 dark:text-indigo-300">Project:</span>
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-200">{activeProject}</span>
            </div>
          )}

          <div className="flex bg-gray-100 dark:bg-tokyo-bg rounded-lg p-1">
            <button
              onClick={() => onTabChange("chat")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "chat"
                  ? "bg-white dark:bg-tokyo-surface text-gray-900 dark:text-tokyo-text shadow-sm"
                  : "text-gray-600 dark:text-tokyo-muted hover:text-gray-900 dark:hover:text-tokyo-text"
              }`}
            >
              Prompt
            </button>
            <button
              onClick={() => onTabChange("image")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "image"
                  ? "bg-white dark:bg-tokyo-surface text-gray-900 dark:text-tokyo-text shadow-sm"
                  : "text-gray-600 dark:text-tokyo-muted hover:text-gray-900 dark:hover:text-tokyo-text"
              }`}
            >
              Image
            </button>
            <button
              onClick={() => onTabChange("research")}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === "research"
                  ? "bg-white dark:bg-tokyo-surface text-gray-900 dark:text-tokyo-text shadow-sm"
                  : "text-gray-600 dark:text-tokyo-muted hover:text-gray-900 dark:hover:text-tokyo-text"
              }`}
            >
              Deep Research
            </button>
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-tokyo-text bg-gray-100 dark:bg-tokyo-bg hover:bg-gray-200 dark:hover:bg-tokyo-surface rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Menu
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-tokyo-surface rounded-xl shadow-xl border border-gray-200 dark:border-tokyo-border z-50 overflow-hidden">
              <div className="py-1">
                <button
                  onClick={() => { onShowSettings(); setMenuOpen(false); }}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-tokyo-text hover:bg-gray-100 dark:hover:bg-tokyo-bg flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>

                <button
                  onClick={() => { onShowProjects(); setMenuOpen(false); }}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-tokyo-text hover:bg-gray-100 dark:hover:bg-tokyo-bg flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Projects
                </button>

                <button
                  onClick={() => { onShowAbout(); setMenuOpen(false); }}
                  className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-tokyo-text hover:bg-gray-100 dark:hover:bg-tokyo-bg flex items-center gap-3"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  About
                </button>

                <div className="border-t border-gray-200 dark:border-tokyo-border my-1" />

                <div className="px-4 py-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-tokyo-muted uppercase tracking-wider">Theme</span>
                  <div className="mt-2 flex gap-1">
                    {(["light", "tokyo", "dark"] as ThemeMode[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => onThemeChange(t)}
                        className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
                          theme === t
                            ? "bg-indigo-500 text-white"
                            : "bg-gray-100 dark:bg-tokyo-bg text-gray-700 dark:text-tokyo-text hover:bg-gray-200 dark:hover:bg-tokyo-border"
                        }`}
                      >
                        {themeLabels[t]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

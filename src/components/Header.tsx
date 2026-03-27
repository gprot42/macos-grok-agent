import { useState, useRef, useEffect } from "react";
import { ThemeMode } from "../types";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Settings, FolderOpen, Info, Menu, Sun, Moon, Palette } from "lucide-react";

interface HeaderProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  activeTab: "chat" | "image" | "research" | "parser" | "code" | "video" | "rag" | "live";
  onTabChange: (tab: "chat" | "image" | "research" | "parser" | "code" | "video" | "rag" | "live") => void;
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

  const themeIcons: Record<ThemeMode, { icon: React.ReactNode; label: string }> = {
    light: { icon: <Sun className="h-4 w-4" />, label: "Light" },
    tokyo: { icon: <Palette className="h-4 w-4" />, label: "Tokyo" },
    dark: { icon: <Moon className="h-4 w-4" />, label: "Dark" },
  };

  return (
    <header className="bg-card border-b px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
            Cortex Agent
          </h1>

          {activeProject && (
            <Badge variant="secondary" className="gap-1.5">
              <FolderOpen className="h-3 w-3" />
              {activeProject}
            </Badge>
          )}

          <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as "chat" | "image" | "research" | "parser" | "code" | "video" | "rag" | "live")}>
            <TabsList className="grid grid-cols-8 w-[850px]">
              <TabsTrigger value="chat" className="gap-1.5">
                💬 Prompt
              </TabsTrigger>
              <TabsTrigger value="rag" className="gap-1.5">
                🧠 RAG
              </TabsTrigger>
              <TabsTrigger value="image" className="gap-1.5">
                🖼️ Image
              </TabsTrigger>
              <TabsTrigger value="video" className="gap-1.5">
                🎬 Video
              </TabsTrigger>
              <TabsTrigger value="research" className="gap-1.5">
                🔬 Research
              </TabsTrigger>
              <TabsTrigger value="parser" className="gap-1.5">
                📄 Parser
              </TabsTrigger>
              <TabsTrigger value="code" className="gap-1.5">
                🖥️ Code
              </TabsTrigger>
              <TabsTrigger value="live" className="gap-1.5">
                🎙️ Gemini Live
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme Switcher */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {(["light", "tokyo", "dark"] as ThemeMode[]).map((t) => (
              <Button
                key={t}
                variant={theme === t ? "default" : "ghost"}
                size="sm"
                onClick={() => onThemeChange(t)}
                className="h-8 w-8 p-0"
                title={themeIcons[t].label}
              >
                {themeIcons[t].icon}
              </Button>
            ))}
          </div>

          {/* Menu */}
          <div className="relative" ref={menuRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMenuOpen(!menuOpen)}
              className="gap-2"
            >
              <Menu className="h-4 w-4" />
              Menu
            </Button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-popover rounded-lg shadow-lg border z-50 overflow-hidden animate-in fade-in-0 zoom-in-95">
                <div className="p-1">
                  <button
                    onClick={() => { onShowSettings(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </button>

                  <button
                    onClick={() => { onShowProjects(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Projects
                  </button>

                  <button
                    onClick={() => { onShowAbout(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <Info className="h-4 w-4" />
                    About
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

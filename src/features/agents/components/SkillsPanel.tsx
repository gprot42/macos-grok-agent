import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, FolderOpen, BookOpen, RefreshCw, ChevronDown, ChevronRight, Sparkles } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  skillMdPath: string;
  dir: string;
}

interface SkillsPanelProps {
  activeSkillPaths: string[];
  onActiveSkillsChange: (paths: string[]) => void;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultSkillsDir(): string {
  // Best-effort: agentskills.io convention is ~/.agent-skills
  // We expose this as the default; users can override
  return "~/.agent-skills";
}

// ── Skill card ────────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  active,
  onToggle,
}: {
  skill: SkillMeta;
  active: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const handleExpand = async () => {
    if (!expanded && content === null) {
      setLoadingContent(true);
      try {
        const c = await invoke<string>("read_skill_content", { skillMdPath: skill.skillMdPath });
        setContent(c);
      } catch {
        setContent("(failed to load skill content)");
      } finally {
        setLoadingContent(false);
      }
    }
    setExpanded((v) => !v);
  };

  return (
    <div className={`rounded-lg border transition-colors ${active ? "border-indigo-400 dark:border-indigo-600 bg-indigo-50/50 dark:bg-indigo-900/10" : "theme-border theme-surface"}`}>
      <div className="flex items-start gap-2 px-3 py-2.5">
        {/* Toggle */}
        <label className="relative inline-flex items-center cursor-pointer mt-0.5 flex-shrink-0">
          <input type="checkbox" checked={active} onChange={onToggle} className="sr-only peer" />
          <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-indigo-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
        </label>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold theme-text truncate">{skill.name}</span>
            {active && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500 text-white font-medium">active</span>
            )}
          </div>
          {skill.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{skill.description}</p>
          )}
        </div>

        {/* Expand */}
        <button
          onClick={handleExpand}
          className="flex-shrink-0 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 theme-text-muted hover:theme-text transition-colors"
          title="View skill instructions"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t theme-border px-3 py-2.5">
          {loadingContent ? (
            <div className="text-xs theme-text-muted italic">Loading…</div>
          ) : (
            <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SkillsPanel({ activeSkillPaths, onActiveSkillsChange, onClose }: SkillsPanelProps) {
  const [skillsDir, setSkillsDir] = useState(defaultSkillsDir);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingDir, setEditingDir] = useState(false);
  const [dirInput, setDirInput] = useState(skillsDir);

  const loadSkills = useCallback(async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<SkillMeta[]>("list_skills", { skillsDir: dir });
      setSkills(list);
      if (list.length === 0) setError(null);
    } catch (e) {
      setError(String(e));
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSkills(skillsDir); }, [skillsDir, loadSkills]);

  const handleDirSubmit = () => {
    setSkillsDir(dirInput);
    setEditingDir(false);
  };

  const handlePickDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, title: "Select Skills Directory" });
      if (selected && typeof selected === "string") {
        setDirInput(selected);
        setSkillsDir(selected);
        setEditingDir(false);
      }
    } catch {
      setEditingDir(true);
    }
  };

  const toggleSkill = (skill: SkillMeta) => {
    if (activeSkillPaths.includes(skill.skillMdPath)) {
      onActiveSkillsChange(activeSkillPaths.filter((p) => p !== skill.skillMdPath));
    } else {
      onActiveSkillsChange([...activeSkillPaths, skill.skillMdPath]);
    }
  };

  const activeCount = skills.filter((s) => activeSkillPaths.includes(s.skillMdPath)).length;

  return (
    <div className="flex flex-col h-full border-l theme-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b theme-border theme-surface flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-sm theme-text">Agent Skills</span>
          {activeCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-500 text-white font-medium">
              {activeCount} active
            </span>
          )}
        </div>
        <button onClick={onClose} className="theme-text-muted hover:theme-text transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Skills directory selector */}
      <div className="px-3 py-2.5 border-b theme-border theme-surface flex-shrink-0 space-y-2">
        <div className="text-xs font-medium theme-text-muted uppercase tracking-wider">Skills directory</div>
        {editingDir ? (
          <div className="flex gap-1.5">
            <input
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleDirSubmit(); if (e.key === "Escape") setEditingDir(false); }}
              className="flex-1 text-xs rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
              autoFocus
            />
            <button onClick={handleDirSubmit} className="px-2 py-1 text-xs rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 transition-colors">OK</button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setDirInput(skillsDir); setEditingDir(true); }}
              className="flex-1 text-left text-xs font-mono text-gray-600 dark:text-gray-400 truncate hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors"
              title={skillsDir}
            >
              {skillsDir}
            </button>
            <button onClick={handlePickDir} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 theme-text-muted hover:theme-text transition-colors" title="Browse for skills directory">
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => loadSkills(skillsDir)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 theme-text-muted hover:theme-text transition-colors" title="Refresh skills">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        )}
      </div>

      {/* Skills list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && (
          <div className="flex items-center justify-center py-8 theme-text-muted text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" /> Scanning…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && skills.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
            <BookOpen className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <div className="text-sm theme-text-muted">No skills found</div>
            <div className="text-xs text-gray-400 dark:text-gray-500 max-w-[220px] leading-relaxed">
              Create a folder with a <code className="font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">SKILL.md</code> file inside <span className="font-mono break-all">{skillsDir}</span>
            </div>
            <a
              href="https://agentskills.io"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-500 hover:underline"
            >
              Learn about Agent Skills →
            </a>
          </div>
        )}

        {!loading && skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            active={activeSkillPaths.includes(skill.skillMdPath)}
            onToggle={() => toggleSkill(skill)}
          />
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t theme-border text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">
        Active skills are injected into the agent's system prompt for every run.
      </div>
    </div>
  );
}

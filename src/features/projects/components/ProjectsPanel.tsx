import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Input } from "@shared/components";

interface ProjectsPanelProps {
  activeProject: string | null;
  onSelectProject: (name: string | null) => void;
  onClose: () => void;
}

export function ProjectsPanel({ activeProject, onSelectProject, onClose }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<string[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const list = await invoke<string[]>("list_projects");
      setProjects(list);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await invoke("create_project", { projectName: newProjectName.trim() });
      await loadProjects();
      setNewProjectName("");
      onSelectProject(newProjectName.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-tokyo-surface rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-tokyo-border">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-tokyo-text">Projects</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-tokyo-text"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 dark:text-tokyo-text">
              Create New Project
            </label>
            <div className="flex gap-2">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name..."
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
              />
              <Button onClick={handleCreateProject} disabled={loading || !newProjectName.trim()}>
                {loading ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700 dark:text-tokyo-text">
                Your Projects
              </label>
              {activeProject && (
                <button
                  onClick={() => onSelectProject(null)}
                  className="text-xs text-indigo-500 hover:text-indigo-600"
                >
                  Clear Selection
                </button>
              )}
            </div>
            
            {projects.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-tokyo-muted py-8 text-center">
                No projects yet. Create one above.
              </div>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {projects.map((name) => (
                  <button
                    key={name}
                    onClick={() => { onSelectProject(name); onClose(); }}
                    className={`w-full px-4 py-3 text-left rounded-lg flex items-center gap-3 transition-colors ${
                      activeProject === name
                        ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                        : "hover:bg-gray-100 dark:hover:bg-tokyo-bg text-gray-700 dark:text-tokyo-text"
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="font-medium">{name}</span>
                    {activeProject === name && (
                      <span className="ml-auto text-xs bg-indigo-500 text-white px-2 py-0.5 rounded">
                        Active
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-500 dark:text-tokyo-muted">
            Projects are saved in $HOME/Cortex Projects/
          </div>
        </div>
      </div>
    </div>
  );
}

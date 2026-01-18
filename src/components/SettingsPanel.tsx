import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Input, Select } from "./index";
import { AppSettings, FONT_OPTIONS } from "../types";

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
  onSaveApiKey: (apiKey: string) => void;
  onClose: () => void;
}

export function SettingsPanel({
  settings,
  onUpdateSettings,
  onSaveApiKey,
  onClose,
}: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [projectId, setProjectId] = useState(settings.projectId);
  const [hasServiceAccount, setHasServiceAccount] = useState(false);
  const [saProjectId, setSaProjectId] = useState<string | null>(null);
  const [setupProjectId, setSetupProjectId] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setApiKey(settings.apiKey);
    setProjectId(settings.projectId);
  }, [settings]);

  useEffect(() => {
    invoke<boolean>("has_service_account").then(setHasServiceAccount);
    invoke<string | null>("get_service_account_project_id").then((id) => {
      setSaProjectId(id);
      if (id) setSetupProjectId(id);
    });
  }, []);

  const handleSave = () => {
    onSaveApiKey(apiKey);
    onUpdateSettings({ projectId });
    onClose();
  };

  const handleVertexSetup = async (remove: boolean) => {
    if (!setupProjectId.trim()) {
      setSetupResult({ success: false, message: "Please enter a Project ID" });
      return;
    }

    setSetupLoading(true);
    setSetupResult(null);

    try {
      const result = await invoke<string>("run_vertex_setup", {
        projectId: setupProjectId,
        remove,
      });
      setSetupResult({ success: true, message: result });
      const updated = await invoke<boolean>("has_service_account");
      setHasServiceAccount(updated);
      const newId = await invoke<string | null>("get_service_account_project_id");
      setSaProjectId(newId);
      if (!remove && updated) {
        onUpdateSettings({ projectId: setupProjectId });
        setProjectId(setupProjectId);
      }
    } catch (e) {
      setSetupResult({ success: false, message: String(e) });
    } finally {
      setSetupLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-tokyo-surface rounded-xl shadow-2xl w-full max-w-4xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-tokyo-border flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-tokyo-text">
            Settings
          </h2>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="border border-gray-200 dark:border-tokyo-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-tokyo-text uppercase tracking-wider mb-3">
                  AI Studio / OpenRouter / xAI
                </h3>
                <p className="text-xs text-gray-500 dark:text-tokyo-muted mb-4">
                  API keys are required for non-Vertex endpoints. Get your key from the respective provider's console.
                </p>

                <Input
                  label="API Key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                />
                <p className="text-xs text-gray-400 dark:text-tokyo-muted mt-2">
                  Encrypted and stored locally on this device.
                </p>

                <div className="mt-4">
                  <Input
                    label="Project ID (optional for AI Studio)"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="my-project-id"
                  />
                </div>
              </div>

              <div className="border border-gray-200 dark:border-tokyo-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-tokyo-text uppercase tracking-wider mb-3">
                  Display
                </h3>

                <div className="flex items-center gap-4 mb-4">
                  <label className="text-sm text-gray-600 dark:text-tokyo-muted w-20">
                    Font Size
                  </label>
                  <input
                    type="range"
                    min="12"
                    max="20"
                    value={settings.fontSize}
                    onChange={(e) =>
                      onUpdateSettings({ fontSize: parseInt(e.target.value) })
                    }
                    className="flex-1"
                  />
                  <span className="text-sm text-gray-700 dark:text-tokyo-text w-8">
                    {settings.fontSize}
                  </span>
                </div>

                <Select
                  label="Font Family"
                  value={settings.fontFamily || "system"}
                  onChange={(e) => onUpdateSettings({ fontFamily: e.target.value })}
                  options={FONT_OPTIONS}
                />

                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-tokyo-muted">Accent</label>
                    <input
                      type="color"
                      value={settings.customColors?.accentColor || "#6366f1"}
                      onChange={(e) => onUpdateSettings({
                        customColors: { ...settings.customColors, accentColor: e.target.value }
                      })}
                      className="w-full h-8 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-tokyo-muted">You</label>
                    <input
                      type="color"
                      value={settings.customColors?.userMessageBg || "#6366f1"}
                      onChange={(e) => onUpdateSettings({
                        customColors: { ...settings.customColors, userMessageBg: e.target.value }
                      })}
                      className="w-full h-8 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-500 dark:text-tokyo-muted">AI</label>
                    <input
                      type="color"
                      value={settings.customColors?.assistantMessageBg || "#f3f4f6"}
                      onChange={(e) => onUpdateSettings({
                        customColors: { ...settings.customColors, assistantMessageBg: e.target.value }
                      })}
                      className="w-full h-8 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
                    />
                  </div>
                </div>
                <button
                  onClick={() => onUpdateSettings({ customColors: undefined })}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mt-2"
                >
                  Reset colors
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="border border-gray-200 dark:border-tokyo-border rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-tokyo-text uppercase tracking-wider mb-3">
                  Vertex AI Setup
                </h3>
                <p className="text-xs text-gray-500 dark:text-tokyo-muted mb-4">
                  Configure a GCP service account to use Vertex AI for Claude and Gemini models. This creates credentials stored locally.
                </p>

                <div className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
                  hasServiceAccount 
                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    : "bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
                }`}>
                  <span className={`w-3 h-3 rounded-full ${hasServiceAccount ? "bg-green-500" : "bg-gray-400"}`} />
                  <div className="flex-1">
                    <span className={`text-sm font-medium ${hasServiceAccount ? "text-green-800 dark:text-green-200" : "text-gray-600 dark:text-gray-400"}`}>
                      {hasServiceAccount ? "Service Account Configured" : "Not Configured"}
                    </span>
                    {hasServiceAccount && saProjectId && (
                      <p className="text-xs text-green-600 dark:text-green-400">
                        Project: {saProjectId}
                      </p>
                    )}
                  </div>
                </div>

                {!hasServiceAccount && (
                  <>
                    <Input
                      label="GCP Project ID"
                      value={setupProjectId}
                      onChange={(e) => setSetupProjectId(e.target.value)}
                      placeholder="my-gcp-project"
                    />
                    <p className="text-xs text-gray-400 dark:text-tokyo-muted mt-1 mb-3">
                      Your Google Cloud project where Vertex AI is enabled.
                    </p>
                  </>
                )}

                <div className="flex gap-3">
                  {!hasServiceAccount ? (
                    <Button
                      variant="primary"
                      onClick={() => handleVertexSetup(false)}
                      disabled={setupLoading || !setupProjectId.trim()}
                    >
                      {setupLoading ? "Running..." : "Setup Service Account"}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleVertexSetup(true)}
                      disabled={setupLoading}
                    >
                      {setupLoading ? "Running..." : "Remove Service Account"}
                    </Button>
                  )}
                </div>

                {setupResult && (
                  <div className={`mt-3 p-3 rounded text-sm max-h-32 overflow-auto ${
                    setupResult.success
                      ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                      : "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200"
                  }`}>
                    <pre className="whitespace-pre-wrap font-mono text-xs">{setupResult.message}</pre>
                  </div>
                )}
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                <h4 className="font-medium text-purple-800 dark:text-purple-200 mb-2">
                  Enable Anthropic Models
                </h4>
                <p className="text-sm text-purple-700 dark:text-purple-300">
                  Run <code className="bg-purple-100 dark:bg-purple-800/50 px-1 rounded">scripts/02-enable-vertex-models.sh</code> and follow instructions.
                </p>
              </div>

              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
                  Disclaimer
                </h4>
                <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <li>• Use at your own risk</li>
                  <li>• All pricing shown is for demonstration only</li>
                  <li>• This is not an official Google product</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-tokyo-border flex justify-end gap-3 flex-shrink-0">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

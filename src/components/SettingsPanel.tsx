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

function SettingRow({ 
  title, 
  description, 
  children 
}: { 
  title: string; 
  description: React.ReactNode; 
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 py-4 border-b border-gray-300 dark:border-gray-600 last:border-b-0">
      <div className="pr-6 md:border-r border-gray-300 dark:border-gray-600">
        <h4 className="font-medium text-gray-800 dark:text-tokyo-text mb-1">{title}</h4>
        <div className="text-sm text-gray-500 dark:text-tokyo-muted">{description}</div>
      </div>
      <div className="flex flex-col justify-center pl-0 md:pl-6 mt-4 md:mt-0">{children}</div>
    </div>
  );
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
        <div className="px-6 py-4 border-b border-gray-200 dark:border-tokyo-border flex-shrink-0 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-tokyo-text">
            Settings
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              API Keys
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4">
              <SettingRow
                title="API Key"
                description={
                  <>
                    Required for <strong>AI Studio</strong>, <strong>OpenRouter</strong>, <strong>xAI</strong>, and <strong>Kilo Code</strong> endpoints.
                    <ul className="mt-2 list-disc list-inside text-xs">
                      <li><strong>AI Studio:</strong> Powers Gemini models, Image generation, and Deep Research</li>
                      <li><strong>OpenRouter:</strong> Access to 100+ models with one key</li>
                      <li><strong>xAI:</strong> Grok models with real-time X data</li>
                    </ul>
                    <p className="mt-2 text-xs italic">Encrypted and stored locally.</p>
                  </>
                }
              >
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter your API key"
                />
              </SettingRow>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              Vertex AI (Google Cloud)
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4">
              <SettingRow
                title="Service Account"
                description={
                  <>
                    Vertex AI requires a <strong>GCP Project</strong> with billing enabled to access Claude and Gemini models via Google Cloud.
                    <p className="mt-2">The service account provides secure authentication without exposing your credentials.</p>
                    {hasServiceAccount && saProjectId && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-green-600 dark:text-green-400 font-medium">
                          Configured: {saProjectId}
                        </span>
                      </div>
                    )}
                  </>
                }
              >
                <div className="space-y-3">
                  <Input
                    label="GCP Project ID"
                    value={setupProjectId}
                    onChange={(e) => setSetupProjectId(e.target.value)}
                    placeholder="my-gcp-project"
                    disabled={hasServiceAccount}
                  />
                  <div className="flex gap-2">
                    {!hasServiceAccount ? (
                      <Button
                        variant="primary"
                        onClick={() => handleVertexSetup(false)}
                        disabled={setupLoading}
                      >
                        {setupLoading ? "Running..." : "Setup Service Account"}
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleVertexSetup(true)}
                        disabled={setupLoading}
                      >
                        {setupLoading ? "Removing..." : "Remove"}
                      </Button>
                    )}
                  </div>
                  {setupResult && (
                    <div className={`p-2 rounded text-xs max-h-24 overflow-auto ${
                      setupResult.success
                        ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200"
                        : "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200"
                    }`}>
                      <pre className="whitespace-pre-wrap font-mono">{setupResult.message}</pre>
                    </div>
                  )}
                </div>
              </SettingRow>

              <SettingRow
                title="Enable Anthropic Models"
                description={
                  <>
                    Claude models must be enabled in the Vertex AI Model Garden before use.
                  </>
                }
              >
                <p className="text-sm text-gray-600 dark:text-tokyo-muted">
                  Run <code className="bg-gray-200 dark:bg-tokyo-border px-1.5 py-0.5 rounded text-xs">scripts/02-enable-vertex-models.sh</code> and follow instructions.
                </p>
              </SettingRow>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              Deep Research
            </h3>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Requirements</h4>
                  <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <li>1. <strong>AI Studio API Key</strong> (required)</li>
                    <li>2. Uses Gemini 2.5 Pro Deep Research model</li>
                    <li>3. Performs multi-step web searches automatically</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Features</h4>
                  <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                    <li>• Autonomous web browsing and research</li>
                    <li>• Source synthesis and citation</li>
                    <li>• Supports file attachments for context</li>
                    <li>• Configurable thinking level (Low/Medium/High)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              Display
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4">
              <SettingRow
                title="Font Size"
                description="Adjust the text size for messages and UI elements."
              >
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="12"
                    max="20"
                    value={settings.fontSize}
                    onChange={(e) => onUpdateSettings({ fontSize: parseInt(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-tokyo-text w-8">
                    {settings.fontSize}
                  </span>
                </div>
              </SettingRow>

              <SettingRow
                title="Font Family"
                description="Choose a font for the interface."
              >
                <Select
                  value={settings.fontFamily || "system"}
                  onChange={(e) => onUpdateSettings({ fontFamily: e.target.value })}
                  options={FONT_OPTIONS}
                />
              </SettingRow>

              <SettingRow
                title="Colors"
                description="Customize accent and message bubble colors."
              >
                <div className="flex gap-4 items-center">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Accent</label>
                    <input
                      type="color"
                      value={settings.customColors?.accentColor || "#6366f1"}
                      onChange={(e) => onUpdateSettings({
                        customColors: { ...settings.customColors, accentColor: e.target.value }
                      })}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">You</label>
                    <input
                      type="color"
                      value={settings.customColors?.userMessageBg || "#6366f1"}
                      onChange={(e) => onUpdateSettings({
                        customColors: { ...settings.customColors, userMessageBg: e.target.value }
                      })}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">AI</label>
                    <input
                      type="color"
                      value={settings.customColors?.assistantMessageBg || "#f3f4f6"}
                      onChange={(e) => onUpdateSettings({
                        customColors: { ...settings.customColors, assistantMessageBg: e.target.value }
                      })}
                      className="w-8 h-8 rounded cursor-pointer border border-gray-300"
                    />
                  </div>
                  <button
                    onClick={() => onUpdateSettings({ customColors: undefined })}
                    className="text-xs text-gray-400 hover:text-gray-600 ml-2"
                  >
                    Reset
                  </button>
                </div>
              </SettingRow>
            </div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-1">Disclaimer</h4>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Use at your own risk. All pricing is for demonstration only. This is not an official Google product.
            </p>
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

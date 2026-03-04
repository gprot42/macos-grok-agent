import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Button, Input, Select } from "./index";
import { AppSettings, FONT_OPTIONS } from "../types";

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
  onSaveApiKey: (apiKey: string) => void;
  onClose: () => void;
}

function ExternalLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={() => open(href)}
      className={`text-indigo-600 dark:text-indigo-400 hover:underline ${className}`}
    >
      {children}
    </button>
  );
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
  const [aiStudioKey, setAiStudioKey] = useState(settings.aiStudioKey || "");
  const [openrouterKey, setOpenrouterKey] = useState(settings.openrouterKey || "");
  const [xaiKey, setXaiKey] = useState(settings.xaiKey || "");
  const [kilocodeKey, setKilocodeKey] = useState(settings.kilocodeKey || "");
  const [customLogin, setCustomLogin] = useState(settings.customLogin || "");
  const [customPassword, setCustomPassword] = useState(settings.customPassword || "");
  const [projectId, setProjectId] = useState(settings.projectId);
  const [hasServiceAccount, setHasServiceAccount] = useState(false);
  const [saProjectId, setSaProjectId] = useState<string | null>(null);
  const [setupProjectId, setSetupProjectId] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<{ success: boolean; message: string } | null>(null);
  const [gcloudAuth, setGcloudAuth] = useState<{ authenticated: boolean; account?: string; error?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    setApiKey(settings.apiKey);
    setAiStudioKey(settings.aiStudioKey || "");
    setOpenrouterKey(settings.openrouterKey || "");
    setXaiKey(settings.xaiKey || "");
    setKilocodeKey(settings.kilocodeKey || "");
    setCustomLogin(settings.customLogin || "");
    setCustomPassword(settings.customPassword || "");
    setProjectId(settings.projectId);
  }, [settings]);

  useEffect(() => {
    invoke<boolean>("has_service_account").then(setHasServiceAccount);
    invoke<string | null>("get_service_account_project_id").then((id) => {
      setSaProjectId(id);
      if (id) setSetupProjectId(id);
    });
    checkGcloudAuth();
  }, []);

  const checkGcloudAuth = async () => {
    try {
      const account = await invoke<string>("check_gcloud_auth");
      setGcloudAuth({ authenticated: true, account });
    } catch (e) {
      setGcloudAuth({ authenticated: false, error: String(e) });
    }
  };

  const handleOpenAuth = async () => {
    if (authLoading) return;
    setAuthLoading(true);
    try {
      await invoke("open_gcloud_auth");
      let attempts = 0;
      const maxAttempts = 60;
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const account = await invoke<string>("check_gcloud_auth");
          setGcloudAuth({ authenticated: true, account });
          clearInterval(pollInterval);
          setAuthLoading(false);
        } catch {
          if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setAuthLoading(false);
            checkGcloudAuth();
          }
        }
      }, 3000);
    } catch (e) {
      setSetupResult({ success: false, message: String(e) });
      setAuthLoading(false);
    }
  };

  const handleSave = () => {
    onSaveApiKey(aiStudioKey || apiKey);
    onUpdateSettings({ 
      projectId,
      aiStudioKey,
      openrouterKey,
      xaiKey,
      kilocodeKey,
      customLogin,
      customPassword,
    });
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
      
      // Small delay to ensure file system has synced
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const updated = await invoke<boolean>("has_service_account");
      setHasServiceAccount(updated);
      const newId = await invoke<string | null>("get_service_account_project_id");
      setSaProjectId(newId);
      
      if (!remove && updated) {
        onUpdateSettings({ projectId: setupProjectId });
        setProjectId(setupProjectId);
      }
      if (remove) {
        setSaProjectId(null);
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
                title="AI Studio"
                description={
                  <>
                    Required for <strong>Gemini models</strong>, <strong>Image generation</strong>, and <strong>Deep Research</strong>.
                    <p className="mt-1 text-xs">Get your key from <ExternalLink href="https://aistudio.google.com/apikey">aistudio.google.com</ExternalLink></p>
                  </>
                }
              >
                <Input
                  type="password"
                  value={aiStudioKey}
                  onChange={(e) => setAiStudioKey(e.target.value)}
                  placeholder="AI Studio API key"
                />
              </SettingRow>

              <SettingRow
                title="OpenRouter"
                description={
                  <>
                    Access <strong>100+ models</strong> (Claude, GPT-4, Llama, Gemini) with one key.
                    <p className="mt-1 text-xs">Get your key from <ExternalLink href="https://openrouter.ai/keys">openrouter.ai</ExternalLink></p>
                  </>
                }
              >
                <Input
                  type="password"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder="OpenRouter API key"
                />
              </SettingRow>

              <SettingRow
                title="xAI"
                description={
                  <>
                    Required for <strong>Grok models</strong> with real-time X (Twitter) data access.
                    <p className="mt-1 text-xs">Get your key from <ExternalLink href="https://console.x.ai">console.x.ai</ExternalLink></p>
                  </>
                }
              >
                <Input
                  type="password"
                  value={xaiKey}
                  onChange={(e) => setXaiKey(e.target.value)}
                  placeholder="xAI API key"
                />
              </SettingRow>

              <SettingRow
                title="Kilo Code"
                description={
                  <>
                    Coding-optimized access to Claude, Gemini, and DeepSeek models.
                    <p className="mt-1 text-xs">Get your key from <ExternalLink href="https://kilocode.ai">kilocode.ai</ExternalLink></p>
                  </>
                }
              >
                <Input
                  type="password"
                  value={kilocodeKey}
                  onChange={(e) => setKilocodeKey(e.target.value)}
                  placeholder="Kilo Code API key"
                />
              </SettingRow>

              <SettingRow
                title="Custom Endpoint"
                description={
                  <>
                    Login and password for custom OpenAI-compatible API endpoints.
                    <p className="mt-1 text-xs">Configure the URL in the model selector when using Custom endpoint.</p>
                  </>
                }
              >
                <div className="space-y-2">
                  <Input
                    value={customLogin}
                    onChange={(e) => setCustomLogin(e.target.value)}
                    placeholder="Login / Username"
                  />
                  <Input
                    type="password"
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    placeholder="Password / API Key"
                  />
                </div>
              </SettingRow>

              <p className="text-xs text-gray-400 dark:text-tokyo-muted mt-2 italic">
                All keys are encrypted and stored locally on this device.
              </p>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              Vertex AI (Google Cloud)
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4">
              <div className="mb-4 text-sm text-gray-600 dark:text-tokyo-muted leading-relaxed">
                Vertex AI uses your <strong>Google Cloud project</strong> with a service account for authentication (no API key needed).
                This unlocks <strong>Claude models</strong> (Haiku, Sonnet, Opus) and <strong>Gemini models</strong> (Pro, Flash) via Google Cloud's enterprise endpoint with higher rate limits and SLA guarantees. Requires a GCP project with billing enabled.
              </div>
              <SettingRow
                title="Google Cloud Authentication"
                description={
                  <>
                    Required for Vertex AI setup. Authenticates with your Google Cloud account.
                  </>
                }
              >
                <div className="space-y-2">
                  {gcloudAuth === null ? (
                    <div className="text-sm text-gray-500">Checking...</div>
                  ) : gcloudAuth.authenticated ? (
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                      <span className="text-sm text-green-700 dark:text-green-300">
                        Authenticated: <strong>{gcloudAuth.account}</strong>
                      </span>
                      <button
                        onClick={checkGcloudAuth}
                        className="ml-2 text-xs text-gray-400 hover:text-gray-600"
                        title="Refresh"
                      >
                        ↻
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        <span className="text-sm text-red-700 dark:text-red-300">
                          Not authenticated
                        </span>
                      </div>
                      <Button
                        onClick={handleOpenAuth}
                        disabled={authLoading}
                      >
                        {authLoading ? "Waiting for authentication..." : "Authenticate with Google Cloud"}
                      </Button>
                      <p className="text-xs text-gray-500">
                        {authLoading 
                          ? "Complete authentication in Terminal, then this will update automatically."
                          : "Opens Terminal to complete browser-based authentication."}
                        {!authLoading && (
                          <button
                            onClick={checkGcloudAuth}
                            className="ml-2 text-indigo-500 hover:underline"
                          >
                            Check again
                          </button>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </SettingRow>

              <SettingRow
                title="Service Account"
                description={
                  <>
                    Vertex AI requires a <strong>GCP Project</strong> with billing enabled to access Claude and Gemini models via Google Cloud.
                    <p className="mt-2">The service account provides secure authentication without exposing your credentials.</p>
                  </>
                }
              >
                <div className="space-y-3">
                  {hasServiceAccount && saProjectId ? (
                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-3 h-3 rounded-full bg-green-500" />
                        <span className="text-green-800 dark:text-green-200 font-semibold">
                          Already Configured
                        </span>
                      </div>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        Project: <strong>{saProjectId}</strong>
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        To reconfigure, remove the existing service account first.
                      </p>
                      <Button
                        onClick={() => handleVertexSetup(true)}
                        disabled={setupLoading}
                        className="mt-3"
                      >
                        {setupLoading ? "Removing..." : "Remove Service Account"}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Input
                        label="GCP Project ID"
                        value={setupProjectId}
                        onChange={(e) => setSetupProjectId(e.target.value)}
                        placeholder="my-gcp-project"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      <Button
                        variant="primary"
                        onClick={() => handleVertexSetup(false)}
                        disabled={setupLoading}
                      >
                        {setupLoading ? "Running..." : "Setup Service Account"}
                      </Button>
                    </>
                  )}
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
                  Run <code className="bg-gray-200 dark:bg-tokyo-border px-1.5 py-0.5 rounded text-xs">scripts/02-enable-vertex-models.sh</code> and follow the instructions, or enable them through the <ExternalLink href="https://console.cloud.google.com/vertex-ai/model-garden">Model Garden UI</ExternalLink> directly.
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
              Vibe Coding
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4">
              <SettingRow
                title="Agent Timeout"
                description="Maximum seconds to wait for each LLM response in both Code and Plan modes. Increase for complex or deep-thinking queries."
              >
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="60"
                    max="1800"
                    step="60"
                    value={settings.agentTimeout || 900}
                    onChange={(e) => onUpdateSettings({ agentTimeout: parseInt(e.target.value) })}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-tokyo-text w-16 text-right">
                    {settings.agentTimeout || 900}s
                  </span>
                </div>
              </SettingRow>
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
            <p className="text-sm text-amber-700 dark:text-amber-300">
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

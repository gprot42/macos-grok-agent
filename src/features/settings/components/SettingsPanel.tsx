import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Button, Input, Select } from "@shared/components";
import {
  AppSettings,
  AuthMode,
  FONT_OPTIONS,
  SuperGrokDeviceCode,
  SuperGrokSessionInfo,
} from "@shared/types";

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
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
  onClose,
}: SettingsPanelProps) {
  const [openrouterKey, setOpenrouterKey] = useState(settings.openrouterKey || "");
  const [xaiKey, setXaiKey] = useState(settings.xaiKey || "");
  const [kilocodeKey, setKilocodeKey] = useState(settings.kilocodeKey || "");
  const [customLogin, setCustomLogin] = useState(settings.customLogin || "");
  const [customPassword, setCustomPassword] = useState(settings.customPassword || "");
  const [projectId, setProjectId] = useState(settings.projectId || "");

  const authMode: AuthMode = settings.authMode === "SUPERGROK_OAUTH" ? "SUPERGROK_OAUTH" : "API_KEY";
  const [oauthLoginInProgress, setOauthLoginInProgress] = useState(false);
  const [oauthUserCode, setOauthUserCode] = useState<string | null>(null);
  const [oauthVerificationUri, setOauthVerificationUri] = useState<string | null>(null);
  const [oauthLoginMessage, setOauthLoginMessage] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const loginAbortRef = useRef(false);

  useEffect(() => {
    setOpenrouterKey(settings.openrouterKey || "");
    setXaiKey(settings.xaiKey || "");
    setKilocodeKey(settings.kilocodeKey || "");
    setCustomLogin(settings.customLogin || "");
    setCustomPassword(settings.customPassword || "");
    setProjectId(settings.projectId || "");
  }, [settings]);

  const handleSave = () => {
    onUpdateSettings({
      projectId,
      openrouterKey,
      xaiKey,
      kilocodeKey,
      customLogin,
      customPassword,
    });
    onClose();
  };

  const setAuthMode = (mode: AuthMode) => {
    if (mode === "SUPERGROK_OAUTH" && !settings.oauthSignedIn) {
      onUpdateSettings({ authMode: mode });
      setOauthLoginMessage("Sign in with SuperGrok below, or import from Grok CLI (`grok login`).");
      return;
    }
    onUpdateSettings({ authMode: mode });
    setOauthLoginMessage(null);
  };

  const startSuperGrokLogin = async () => {
    if (oauthLoginInProgress) return;
    loginAbortRef.current = false;
    setOauthLoginInProgress(true);
    setOauthLoginMessage("Requesting device code…");
    setOauthUserCode(null);
    setOauthVerificationUri(null);
    try {
      const device = await invoke<SuperGrokDeviceCode>("supergrok_start_login");
      if (loginAbortRef.current) return;
      const openUri = device.verificationUriComplete || device.verificationUri;
      setOauthUserCode(device.userCode);
      setOauthVerificationUri(openUri);
      setOauthLoginMessage(`Open the link, approve access, then wait — code ${device.userCode}`);
      if (openUri) {
        try {
          await open(openUri);
        } catch {
          /* user can click Open browser */
        }
      }
      const info = await invoke<SuperGrokSessionInfo>("supergrok_complete_login", {
        deviceCode: device.deviceCode,
        intervalSeconds: device.intervalSeconds,
      });
      if (loginAbortRef.current) return;
      setOauthLoginInProgress(false);
      setOauthUserCode(null);
      setOauthVerificationUri(null);
      setOauthLoginMessage(null);
      onUpdateSettings({
        authMode: "SUPERGROK_OAUTH",
        oauthSignedIn: true,
        oauthEmail: info.email ?? undefined,
      });
    } catch (e) {
      if (loginAbortRef.current) return;
      setOauthLoginInProgress(false);
      setOauthLoginMessage(String(e));
    }
  };

  const cancelSuperGrokLogin = () => {
    loginAbortRef.current = true;
    setOauthLoginInProgress(false);
    setOauthUserCode(null);
    setOauthVerificationUri(null);
    setOauthLoginMessage("Sign-in cancelled.");
  };

  const signOutSuperGrok = async () => {
    setOauthBusy(true);
    try {
      await invoke("supergrok_sign_out");
      onUpdateSettings({
        authMode: "API_KEY",
        oauthSignedIn: false,
        oauthEmail: undefined,
      });
      setOauthLoginMessage("Signed out of SuperGrok. Using API key mode.");
    } catch (e) {
      setOauthLoginMessage(String(e));
    } finally {
      setOauthBusy(false);
    }
  };

  const importCliAuth = async () => {
    setOauthBusy(true);
    setOauthLoginMessage("Importing from ~/.grok/auth.json…");
    try {
      const info = await invoke<SuperGrokSessionInfo>("supergrok_import_cli_auth", { path: null });
      onUpdateSettings({
        authMode: "SUPERGROK_OAUTH",
        oauthSignedIn: true,
        oauthEmail: info.email ?? undefined,
      });
      setOauthLoginMessage(
        info.email
          ? `Imported SuperGrok session for ${info.email}.`
          : "Imported SuperGrok session from Grok CLI."
      );
    } catch (e) {
      setOauthLoginMessage(String(e));
    } finally {
      setOauthBusy(false);
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
          {/* ── Authentication (API key vs SuperGrok Heavy) ───────────────── */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              Authentication
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4 space-y-4">
              <p className="text-sm text-gray-500 dark:text-tokyo-muted">
                Choose how Grok Agent authenticates to <code className="text-xs">api.x.ai</code>.
                SuperGrok OAuth uses your SuperGrok / SuperGrok Heavy subscription (same OIDC flow as Grok Build).
                It is experimental — xAI may still gate some endpoints by API prepaid credits.
              </p>

              <div className="flex rounded-lg border border-gray-300 dark:border-tokyo-border overflow-hidden">
                {(
                  [
                    { mode: "API_KEY" as AuthMode, label: "xAI API key" },
                    { mode: "SUPERGROK_OAUTH" as AuthMode, label: "SuperGrok Heavy" },
                  ] as const
                ).map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={oauthLoginInProgress}
                    onClick={() => setAuthMode(mode)}
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                      authMode === mode
                        ? "bg-indigo-600 text-white"
                        : "bg-white dark:bg-tokyo-surface text-gray-700 dark:text-tokyo-text hover:bg-gray-100 dark:hover:bg-tokyo-hover"
                    } disabled:opacity-50`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="border-t border-gray-200 dark:border-tokyo-border pt-4">
                <h4 className="font-medium text-gray-800 dark:text-tokyo-text mb-1">
                  SuperGrok sign-in
                </h4>
                <p className="text-xs text-gray-500 dark:text-tokyo-muted mb-3">
                  Device-code login via auth.x.ai, or import an existing{" "}
                  <code className="text-[11px]">grok login</code> session from{" "}
                  <code className="text-[11px]">~/.grok/auth.json</code>.
                </p>

                {settings.oauthSignedIn ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
                      Signed in{settings.oauthEmail ? ` · ${settings.oauthEmail}` : ""}
                      {authMode === "SUPERGROK_OAUTH" ? " · active for xAI" : " · not active (switch mode above)"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={signOutSuperGrok} disabled={oauthBusy}>
                        Sign out
                      </Button>
                      <Button onClick={importCliAuth} disabled={oauthBusy || oauthLoginInProgress}>
                        Re-import Grok CLI
                      </Button>
                    </div>
                  </div>
                ) : oauthLoginInProgress ? (
                  <div className="space-y-3">
                    {oauthUserCode && (
                      <p className="text-2xl font-bold tracking-widest text-indigo-600 dark:text-indigo-400">
                        {oauthUserCode}
                      </p>
                    )}
                    {oauthLoginMessage && (
                      <p className="text-sm text-gray-500 dark:text-tokyo-muted">{oauthLoginMessage}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="primary"
                        disabled={!oauthVerificationUri}
                        onClick={() => oauthVerificationUri && open(oauthVerificationUri)}
                      >
                        Open browser
                      </Button>
                      <Button onClick={cancelSuperGrokLogin}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="primary" onClick={startSuperGrokLogin} disabled={oauthBusy}>
                        Sign in with SuperGrok
                      </Button>
                      <Button onClick={importCliAuth} disabled={oauthBusy}>
                        Import Grok CLI login
                      </Button>
                    </div>
                    {oauthLoginMessage && (
                      <p className="text-sm text-red-600 dark:text-red-400">{oauthLoginMessage}</p>
                    )}
                  </div>
                )}

                {settings.oauthSignedIn && oauthLoginMessage && (
                  <p className="text-sm text-gray-500 dark:text-tokyo-muted mt-2">{oauthLoginMessage}</p>
                )}
              </div>

              {authMode === "API_KEY" && (
                <div className="border-t border-gray-200 dark:border-tokyo-border pt-4">
                  <SettingRow
                    title="xAI API key"
                    description={
                      <>
                        Prepaid developer API key from{" "}
                        <ExternalLink href="https://console.x.ai">console.x.ai</ExternalLink>.
                        Required when mode is <strong>xAI API key</strong>. SuperGrok subscription alone does not
                        replace this unless you switch mode above.
                      </>
                    }
                  >
                    <Input
                      type="password"
                      value={xaiKey}
                      onChange={(e) => setXaiKey(e.target.value)}
                      placeholder="xai-..."
                    />
                  </SettingRow>
                </div>
              )}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
              Other API Keys
            </h3>
            <div className="bg-gray-50 dark:bg-tokyo-bg rounded-lg p-4">
              {authMode === "SUPERGROK_OAUTH" && (
                <SettingRow
                  title="xAI API key (optional)"
                  description="Still stored if you switch back to API key mode. Not used while SuperGrok is active."
                >
                  <Input
                    type="password"
                    value={xaiKey}
                    onChange={(e) => setXaiKey(e.target.value)}
                    placeholder="xai-..."
                  />
                </SettingRow>
              )}

              <SettingRow
                title="OpenRouter"
                description={
                  <>
                    Access <strong>100+ models</strong> (Claude, GPT-4, Llama) with one key.
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
                Keys and SuperGrok tokens are stored locally on this device (OAuth session encrypted).
              </p>
            </div>
          </div>

           <div className="mb-6">
             <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
               Agent
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

              <SettingRow
                title="Block File Deletion"
                description="When enabled, rm / rmdir / unlink commands inside run_command are soft-blocked. The agent is redirected to use the delete_file tool instead of shell deletions. Disable to allow unrestricted shell deletion."
              >
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.blockFileDeletion ?? true}
                    onChange={(e) => onUpdateSettings({ blockFileDeletion: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 dark:peer-focus:ring-indigo-600 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
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
                title="Show Costs"
                description="Display token usage and cost estimates under each response."
              >
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.showCosts ?? true}
                    onChange={(e) => onUpdateSettings({ showCosts: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-500 dark:peer-focus:ring-indigo-600 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
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
               Use at your own risk. All pricing is for demonstration only. This is not an official product of any AI provider.
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

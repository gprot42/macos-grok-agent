import { useState, useEffect } from "react";
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

  useEffect(() => {
    setApiKey(settings.apiKey);
    setProjectId(settings.projectId);
  }, [settings]);

  const handleSave = () => {
    onSaveApiKey(apiKey);
    onUpdateSettings({ projectId });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-tokyo-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-tokyo-border">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-tokyo-text">
            Settings
          </h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-tokyo-muted uppercase tracking-wider">
              Authentication
            </h3>

            <Input
              label="Google Cloud Project ID"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="my-project-id"
            />

            <Input
              label="API Key (for AI Studio)"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
            />

            <p className="text-xs text-gray-500 dark:text-tokyo-muted">
              Your API key is encrypted and stored securely on this device.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-tokyo-muted uppercase tracking-wider">
              Display
            </h3>

            <div className="flex items-center gap-4">
              <label className="text-sm text-gray-600 dark:text-tokyo-muted">
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
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2">
              ⚠️ Disclaimer
            </h4>
            <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
              <li>• Use at your own risk</li>
              <li>• All pricing shown is fictional and for demonstration only</li>
              <li>• Actual costs may vary significantly</li>
              <li>• This is not an official Google product</li>
            </ul>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 dark:border-tokyo-border flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}

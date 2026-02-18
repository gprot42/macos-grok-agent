import { EndpointType } from "../types";
import { MODELS } from "../models";
import { Select, Checkbox, Input } from "./index";

interface ModelSelectorProps {
  selectedModel: string;
  selectedEndpoint: EndpointType;
  use1MContext: boolean;
  useMemory: boolean;
  useGrounding: boolean;
  thinkingLevel: string;
  customUrl: string;
  customLogin: string;
  customPassword: string;
  onModelChange: (modelId: string) => void;
  onEndpointChange: (endpoint: EndpointType) => void;
  onUse1MContextChange: (value: boolean) => void;
  onUseMemoryChange: (value: boolean) => void;
  onUseGroundingChange: (value: boolean) => void;
  onThinkingLevelChange: (level: string) => void;
  onCustomUrlChange: (url: string) => void;
  onCustomLoginChange: (login: string) => void;
  onCustomPasswordChange: (password: string) => void;
}

const ICONS: Record<string, string> = {
  zap: "⚡",
  rocket: "🚀",
  crown: "👑",
  target: "🎯",
  star: "🌟",
  brain: "🧠",
  image: "🖼️",
  search: "🔬",
};

export function ModelSelector({
  selectedModel,
  selectedEndpoint,
  use1MContext,
  useMemory,
  useGrounding,
  thinkingLevel,
  customUrl,
  customLogin,
  customPassword,
  onModelChange,
  onEndpointChange,
  onUse1MContextChange,
  onUseMemoryChange,
  onUseGroundingChange,
  onThinkingLevelChange,
  onCustomUrlChange,
  onCustomLoginChange,
  onCustomPasswordChange,
}: ModelSelectorProps) {
  const model = MODELS[selectedModel];

  const availableModels = Object.values(MODELS).filter(m =>
    m.endpointSupport.includes(selectedEndpoint)
  );

  const endpointOptions = [
    { value: "vertex_ai", label: "🔷 Vertex AI" },
    { value: "ai_studio", label: "🌟 AI Studio" },
    { value: "openrouter", label: "🔀 OpenRouter" },
    { value: "xai", label: "🅧 xAI" },
    { value: "kilocode", label: "💻 Kilo Code" },
    { value: "custom", label: "🔧 Custom" },
  ];

  const modelOptions = availableModels.map(m => ({
    value: m.id,
    label: `${ICONS[m.icon] || "🤖"} ${m.displayName}`,
  }));

  const thinkingOptions = [
    { value: "none", label: "None" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Select
        options={endpointOptions}
        value={selectedEndpoint}
        onChange={(e) => onEndpointChange(e.target.value as EndpointType)}
        className="min-w-[140px]"
      />

      {selectedEndpoint === "custom" && (
        <>
          <Input
            value={customUrl}
            onChange={(e) => onCustomUrlChange(e.target.value)}
            placeholder="https://api.example.com/v1/chat"
            className="min-w-[300px]"
          />
          <Input
            value={customLogin}
            onChange={(e) => onCustomLoginChange(e.target.value)}
            placeholder="Login (optional)"
            className="min-w-[130px]"
          />
          <Input
            type="password"
            value={customPassword}
            onChange={(e) => onCustomPasswordChange(e.target.value)}
            placeholder="Password / API key"
            className="min-w-[150px]"
          />
        </>
      )}

      <Select
        options={modelOptions}
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        className="min-w-[180px]"
      />

      {model?.supports1MContext && selectedEndpoint !== "custom" && (
        <Checkbox
          label="1M Context"
          checked={use1MContext}
          onChange={(e) => onUse1MContextChange(e.target.checked)}
        />
      )}

      {model?.supportsMemory && selectedEndpoint !== "custom" && (
        <Checkbox
          label="Memory"
          checked={useMemory}
          onChange={(e) => onUseMemoryChange(e.target.checked)}
        />
      )}

      {model?.supportsGrounding && selectedEndpoint !== "custom" && (
        <Checkbox
          label="🔍 Grounding"
          checked={useGrounding}
          onChange={(e) => onUseGroundingChange(e.target.checked)}
        />
      )}

      {model?.supportsDeepThinking && selectedEndpoint !== "custom" && (
        <Select
          label="Think Level"
          options={thinkingOptions}
          value={thinkingLevel}
          onChange={(e) => onThinkingLevelChange(e.target.value)}
          className="min-w-[100px]"
        />
      )}

      <div className="border-l border-gray-300 dark:border-tokyo-border h-6 mx-2" />

      <div className="text-base theme-text-muted italic">
        {model?.description}
      </div>
    </div>
  );
}

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
  onModelChange: (modelId: string) => void;
  onEndpointChange: (endpoint: EndpointType) => void;
  onUse1MContextChange: (value: boolean) => void;
  onUseMemoryChange: (value: boolean) => void;
  onUseGroundingChange: (value: boolean) => void;
  onThinkingLevelChange: (level: string) => void;
  onCustomUrlChange: (url: string) => void;
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
  onModelChange,
  onEndpointChange,
  onUse1MContextChange,
  onUseMemoryChange,
  onUseGroundingChange,
  onThinkingLevelChange,
  onCustomUrlChange,
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
        <Input
          value={customUrl}
          onChange={(e) => onCustomUrlChange(e.target.value)}
          placeholder="https://api.example.com/v1/chat"
          className="min-w-[300px]"
        />
      )}

      <Select
        options={modelOptions}
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        className="min-w-[180px]"
      />

      {model?.supports1MContext && (
        <Checkbox
          label="1M Context"
          checked={use1MContext}
          onChange={(e) => onUse1MContextChange(e.target.checked)}
        />
      )}

      {model?.supportsMemory && (
        <Checkbox
          label="🧠 Memory"
          checked={useMemory}
          onChange={(e) => onUseMemoryChange(e.target.checked)}
        />
      )}

      {model?.supportsGrounding && (
        <Checkbox
          label="🔍 Grounding"
          checked={useGrounding}
          onChange={(e) => onUseGroundingChange(e.target.checked)}
        />
      )}

      {model?.supportsDeepThinking && (
        <Select
          label="Think Level"
          options={thinkingOptions}
          value={thinkingLevel}
          onChange={(e) => onThinkingLevelChange(e.target.value)}
          className="min-w-[100px]"
        />
      )}

      <div className="text-xs text-gray-500 dark:text-tokyo-muted">
        {model?.description}
      </div>
    </div>
  );
}

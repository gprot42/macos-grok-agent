import { useState } from "react";
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
  serviceTier: string;
  onModelChange: (modelId: string) => void;
  onEndpointChange: (endpoint: EndpointType) => void;
  onUse1MContextChange: (value: boolean) => void;
  onUseMemoryChange: (value: boolean) => void;
  onUseGroundingChange: (value: boolean) => void;
  onThinkingLevelChange: (level: string) => void;
  onCustomUrlChange: (url: string) => void;
  onCustomLoginChange: (login: string) => void;
  onCustomPasswordChange: (password: string) => void;
  onServiceTierChange: (tier: string) => void;
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
  serviceTier,
  onModelChange,
  onEndpointChange,
  onUse1MContextChange,
  onUseMemoryChange,
  onUseGroundingChange,
  onThinkingLevelChange,
  onCustomUrlChange,
  onCustomLoginChange,
  onCustomPasswordChange,
  onServiceTierChange,
}: ModelSelectorProps) {
  const [showHelp, setShowHelp] = useState(false);
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

  const serviceTierOptions = [
    { value: "standard", label: "Standard" },
    { value: "flex", label: "Flex (-50%)" },
    { value: "priority", label: "Priority" },
  ];

  return (
    <div className="relative">
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

        {model?.supportsServiceTier && (selectedEndpoint === "ai_studio" || selectedEndpoint === "vertex_ai") && (
          <Select
            label="Tier"
            options={serviceTierOptions}
            value={serviceTier}
            onChange={(e) => onServiceTierChange(e.target.value)}
            className="min-w-[100px]"
          />
        )}

        <button
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center justify-center w-7 h-7 rounded-full border theme-border theme-text-muted hover:theme-text hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-semibold"
          title="Help - explain options"
        >
          ?
        </button>

        <div className="border-l border-gray-300 dark:border-tokyo-border h-6 mx-2" />

        <div className="text-base theme-text italic">
          {model?.description}
        </div>
      </div>

      {showHelp && (
        <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl border theme-border theme-surface shadow-lg p-5 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold theme-text">Model Options Guide</h3>
            <button
              onClick={() => setShowHelp(false)}
              className="theme-text-muted hover:theme-text text-lg px-2"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4 text-sm theme-text leading-relaxed">
            <div>
              <h4 className="font-semibold text-blue-500 mb-1">Endpoint</h4>
              <p>Choose your API provider. <strong>Vertex AI</strong> uses a GCP service account. <strong>AI Studio</strong> uses a Google AI API key (free tier available). <strong>OpenRouter</strong>, <strong>xAI</strong>, and <strong>Kilo Code</strong> are third-party providers with their own API keys. <strong>Custom</strong> lets you point to any OpenAI-compatible endpoint.</p>
            </div>

            <div>
              <h4 className="font-semibold text-blue-500 mb-1">Model</h4>
              <p>Select the AI model. Options change based on your chosen endpoint. Larger models (Opus, Pro) are more capable but slower and costlier. Flash/Lite models are faster and cheaper.</p>
            </div>

            <div>
              <h4 className="font-semibold text-blue-500 mb-1">1M Context</h4>
              <p>Enables extended context window (up to 1 million tokens) for Claude Sonnet models. Useful for very long documents or conversations. Costs more per token when enabled (premium pricing applies).</p>
            </div>

            <div>
              <h4 className="font-semibold text-blue-500 mb-1">Memory</h4>
              <p>Enables persistent memory for Anthropic models. The model can store and recall facts across conversations. Useful for long-running assistant workflows where context needs to persist.</p>
            </div>

            <div>
              <h4 className="font-semibold text-blue-500 mb-1">Grounding (Google Search)</h4>
              <p>Connects Gemini models to Google Search for real-time information. The model can look up current facts, news, and data to provide up-to-date answers instead of relying only on training data.</p>
            </div>

            <div className="border-t theme-border pt-4">
              <h4 className="font-semibold text-purple-500 mb-1">Think Level (Deep Thinking)</h4>
              <p>Controls how much the model "thinks" before responding. Available for Gemini Pro, Opus, and some other models.</p>
              <ul className="mt-2 ml-4 space-y-1 list-disc">
                <li><strong>None</strong> — Standard response, no extended reasoning. Fastest and cheapest.</li>
                <li><strong>Low</strong> — Brief internal reasoning. Good for straightforward tasks that benefit from a quick sanity check.</li>
                <li><strong>Medium</strong> — Moderate reasoning. Balances quality and speed for most tasks.</li>
                <li><strong>High</strong> — Deep extended reasoning. Best for complex problems like math, coding, logic, and multi-step analysis. Slower and uses more tokens.</li>
              </ul>
              <p className="mt-2 text-xs theme-text-muted">Thinking tokens count toward output token usage and billing. Higher levels produce longer internal chain-of-thought.</p>
            </div>

            <div className="border-t theme-border pt-4">
              <h4 className="font-semibold text-green-500 mb-1">Tier (Inference Tier)</h4>
              <p>Controls cost, latency, and reliability trade-offs for Gemini API requests. Available on AI Studio and Vertex AI.</p>
              <ul className="mt-2 ml-4 space-y-1 list-disc">
                <li><strong>Standard</strong> — Default tier. Normal pricing, low latency, high reliability.</li>
                <li><strong>Flex (-50%)</strong> — Half the cost of Standard. Requests may queue for 1-15 minutes with variable latency. Best for background tasks, batch-style work, agentic workflows, and large-scale research where you don't need immediate responses. Same API interface (synchronous), just slower.</li>
                <li><strong>Priority</strong> — Premium tier with lowest latency and highest reliability. Your requests are prioritized above Standard and Flex traffic. Best for production apps, real-time interactions, and business-critical workloads. Costs more than Standard.</li>
              </ul>
              <p className="mt-2 text-xs theme-text-muted">Flex is ideal for cost-sensitive workloads. Priority requires Tier 2+ API access.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

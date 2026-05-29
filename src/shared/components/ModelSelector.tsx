import { useState } from "react";
import { MODELS } from "@shared/constants/models";
import { Select, Checkbox, Input } from "./index";
import { useAppStore } from "@store/appStore";
import { useSettings } from "@/hooks";

const ICONS: Record<string, string> = {
  zap: "⚡", rocket: "🚀", crown: "👑", target: "🎯",
  star: "🌟", brain: "🧠", image: "🖼️", video: "🎬", mic: "🎤", search: "🔬",
};

// ModelSelector reads all model/endpoint config directly from the Zustand store.
// Only customLogin and customPassword still come from encrypted settings (via useSettings).
export function ModelSelector() {
  const [showHelp, setShowHelp] = useState(false);
  const {
    selectedModel, setSelectedModel,
    selectedEndpoint, setSelectedEndpoint,
    use1MContext, setUse1MContext,
    useMemory, setUseMemory,
    useGrounding, setUseGrounding,
    useSearch, setUseSearch,
    thinkingLevel, setThinkingLevel,
    customUrl, setCustomUrl,
  } = useAppStore();
  const { settings, updateSettings } = useSettings();

  const customLogin = settings.customLogin || "";
  const customPassword = settings.customPassword || "";

  const model = MODELS[selectedModel];

  const availableModels = Object.values(MODELS).filter(m =>
    m.endpointSupport.includes(selectedEndpoint) &&
    !m.supportsImageGeneration &&
    !m.supportsVideoGeneration &&
    !m.supportsTextToSpeech
  );

  const endpointOptions = [
    { value: "xai", label: "🅧 xAI" },
    { value: "openrouter", label: "🔀 OpenRouter" },
    { value: "kilocode", label: "💻 Kilo Code" },
    { value: "custom", label: "🔧 Custom" },
  ];

  const modelOptions = availableModels.map(m => ({
    value: m.id,
    label: `${ICONS[m.icon] || "🤖"} ${m.displayName}`,
  }));

  // xAI uses "Fast" / "Expert" terminology; multi-agent adds "Ultra" (xhigh = 16 agents)
  const isXai = selectedEndpoint === "xai";
  const isMultiAgent = model?.id === "grok-4-20-multi-agent";
  const thinkingOptions = isXai
    ? isMultiAgent
      ? [
          { value: "none",   label: "None" },
          { value: "low",    label: "Fast (4 agents)" },
          { value: "medium", label: "Balanced (4 agents)" },
          { value: "high",   label: "Expert (16 agents)" },
          { value: "xhigh",  label: "Ultra (16 agents)" },
        ]
      : [
          { value: "none",  label: "None" },
          { value: "low",   label: "Fast" },
          { value: "high",  label: "Expert" },
        ]
    : [
        { value: "none",   label: "None" },
        { value: "low",    label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high",   label: "High" },
      ];



  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-4">
        <Select
          options={endpointOptions}
          value={selectedEndpoint}
          onChange={(e) => setSelectedEndpoint(e.target.value as import("../types").EndpointType)}
          className="min-w-[140px]"
        />

        {selectedEndpoint === "custom" && (
          <>
            <Input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://api.example.com/v1/chat"
              className="min-w-[300px]"
            />
            <Input
              value={customLogin}
              onChange={(e) => updateSettings({ customLogin: e.target.value })}
              placeholder="Login (optional)"
              className="min-w-[130px]"
            />
            <Input
              type="password"
              value={customPassword}
              onChange={(e) => updateSettings({ customPassword: e.target.value })}
              placeholder="Password / API key"
              className="min-w-[150px]"
            />
          </>
        )}

        <Select
          options={modelOptions}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="min-w-[180px]"
        />

        {model?.supports1MContext && selectedEndpoint !== "custom" && (
          <Checkbox
            label="1M Context"
            checked={use1MContext}
            onChange={(e) => setUse1MContext(e.target.checked)}
          />
        )}

        {model?.supportsMemory && selectedEndpoint !== "custom" && (
          <Checkbox
            label="Memory"
            checked={useMemory}
            onChange={(e) => setUseMemory(e.target.checked)}
          />
        )}

        {model?.supportsGrounding && selectedEndpoint !== "custom" && (
          <Checkbox
            label="🔍 Grounding"
            checked={useGrounding}
            onChange={(e) => setUseGrounding(e.target.checked)}
          />
        )}

        {model?.supportsSearch && selectedEndpoint !== "custom" && (
          <Checkbox
            label="🔎 Search X"
            checked={useSearch}
            onChange={(e) => setUseSearch(e.target.checked)}
          />
        )}

        {model?.supportsDeepThinking && selectedEndpoint !== "custom" && (
          <Select
            label={isMultiAgent ? "Agents" : "Think Level"}
            options={thinkingOptions}
            value={thinkingLevel}
            onChange={(e) => setThinkingLevel(e.target.value)}
            className="min-w-[130px]"
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
               <p>Choose your API provider:</p>
               <ul className="mt-1 ml-4 space-y-1 list-disc">
                 <li><strong>xAI</strong> — Grok models with real-time X/web search, image generation, voice, and video. Recommended for most tasks.</li>
                 <li><strong>OpenRouter</strong> — 100+ models (Claude, GPT-4o, Llama, DeepSeek) with one API key.</li>
                 <li><strong>Kilo Code</strong> — Coding-optimised access via Kilo Code API key.</li>
                 <li><strong>Custom</strong> — Any OpenAI-compatible endpoint. Enter the base URL, optional login and API key.</li>
               </ul>
             </div>

             <div>
               <h4 className="font-semibold text-blue-500 mb-1">Model</h4>
               <p>Available models depend on the selected endpoint. Current xAI models:</p>
               <ul className="mt-1 ml-4 space-y-1 list-disc">
                 <li><strong>Grok 4.3</strong> — Latest flagship. 2M context, native video understanding, auto-reasoning.</li>
                 <li><strong>Grok 4.20 Reasoning</strong> — Reasons automatically before every response. Best for complex tasks.</li>
                 <li><strong>Grok 4.20 Non-Reasoning</strong> — Fast, no chain-of-thought. Good for chat &amp; quick answers.</li>
                 <li><strong>Grok 4.20 Multi-Agent</strong> — Council of agents (4 or 16). Best for deep research.</li>
                 <li><strong>Grok 4.1</strong> — Stable reasoning model with X search support.</li>
               </ul>
             </div>

             <div>
               <h4 className="font-semibold text-blue-500 mb-1">🔎 Search X</h4>
               <p>Lets Grok search X (Twitter) posts and threads in real-time before answering. URLs in the response are clickable. Uses xAI's Agent Tools API. Only available on xAI endpoint with supported models. Adds ~$5 / 1k calls to cost.</p>
             </div>

             <div>
               <h4 className="font-semibold text-blue-500 mb-1">Think Level / Agents</h4>
               <p>Controls reasoning depth. Shown only on models that support it:</p>
               <ul className="mt-1 ml-4 space-y-1 list-disc">
                 <li><strong>None</strong> — No reasoning. Fastest and cheapest.</li>
                 <li><strong>Fast</strong> (xAI) / <strong>Low</strong> (Anthropic) — Brief internal reasoning.</li>
                 <li><strong>Expert</strong> (xAI) / <strong>High</strong> (Anthropic) — Deep reasoning. Best for math, code, multi-step problems.</li>
               </ul>
               <p className="mt-1">For <strong>Grok 4.20 Multi-Agent</strong>, this controls agent count: Fast/Balanced = 4 agents, Expert/Ultra = 16 agents ($$$).</p>
               <p className="mt-1 text-xs theme-text-muted">Reasoning tokens count toward output usage.</p>
             </div>

             <div>
               <h4 className="font-semibold text-blue-500 mb-1">1M Context</h4>
               <p>Extends the context window to ~1 million tokens for supported Claude Sonnet models via OpenRouter. Useful for very long documents. Premium pricing applies.</p>
             </div>

             <div>
               <h4 className="font-semibold text-blue-500 mb-1">Memory</h4>
               <p>Persistent memory for Anthropic models (Claude). The model stores and recalls facts across conversations. Useful for long-running assistant workflows.</p>
             </div>

             <div>
               <h4 className="font-semibold text-blue-500 mb-1">🔍 Grounding</h4>
               <p>Enables Google Search grounding for applicable models via OpenRouter. Grounds responses in current web data rather than training knowledge alone.</p>
             </div>
           </div>
        </div>
      )}
    </div>
  );
}

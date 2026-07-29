import { useState } from "react";
import { Mic, Radio } from "lucide-react";
import { GrokVoicePanel } from "./GrokVoicePanel";
import { VoiceAgentPanel } from "./VoiceAgentPanel";

interface VoiceTabProps {
  apiKey: string;
}

type VoiceMode = "agent" | "tts";

const MODES: {
  id: VoiceMode;
  title: string;
  subtitle: string;
  model: string;
  icon: typeof Radio;
  activeRing: string;
  activeBg: string;
  activeIcon: string;
  activeDot: string;
}[] = [
  {
    id: "agent",
    title: "Live Agent",
    subtitle: "Real-time speech-to-speech conversation",
    model: "grok-voice-think-fast-2.0",
    icon: Radio,
    activeRing: "border-sky-500 ring-2 ring-sky-500/30",
    activeBg: "bg-sky-50 dark:bg-sky-950/40",
    activeIcon: "bg-sky-500 text-white",
    activeDot: "bg-sky-500",
  },
  {
    id: "tts",
    title: "Text to Speech",
    subtitle: "Turn written text into spoken audio",
    model: "grok-tts",
    icon: Mic,
    activeRing: "border-blue-500 ring-2 ring-blue-500/30",
    activeBg: "bg-blue-50 dark:bg-blue-950/40",
    activeIcon: "bg-blue-500 text-white",
    activeDot: "bg-blue-500",
  },
];

export function VoiceTab({ apiKey }: VoiceTabProps) {
  const [mode, setMode] = useState<VoiceMode>("agent");

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Mode picker — two clear selectable cards */}
      <div className="flex-shrink-0 border-b theme-border theme-surface px-4 pt-3 pb-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide theme-text-muted">
            Choose a mode
          </span>
          <span className="text-[11px] theme-text-muted">
            Click a card to switch
          </span>
        </div>

        <div
          className="grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label="Voice mode"
        >
          {MODES.map((m) => {
            const selected = mode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(m.id)}
                className={`relative flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                  selected
                    ? `${m.activeRing} ${m.activeBg}`
                    : "theme-border theme-surface hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/40"
                }`}
              >
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                    selected
                      ? m.activeIcon
                      : "bg-gray-100 dark:bg-gray-800 theme-text-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        selected ? "theme-text" : "theme-text-muted"
                      }`}
                    >
                      {m.title}
                    </span>
                    {selected && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white ${m.activeDot}`}
                      >
                        Selected
                      </span>
                    )}
                  </div>
                  <p
                    className={`mt-0.5 text-xs leading-snug ${
                      selected ? "theme-text-muted" : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {m.subtitle}
                  </p>
                  <code
                    className={`mt-1 inline-block text-[10px] font-mono ${
                      selected
                        ? "text-sky-700 dark:text-sky-300"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {m.model}
                  </code>
                </div>

                {/* Radio indicator */}
                <span
                  className={`mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                    selected
                      ? m.id === "agent"
                        ? "border-sky-500"
                        : "border-blue-500"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                  aria-hidden
                >
                  {selected && (
                    <span
                      className={`h-2 w-2 rounded-full ${m.activeDot}`}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === "agent" ? (
          <VoiceAgentPanel apiKey={apiKey} />
        ) : (
          <GrokVoicePanel apiKey={apiKey} />
        )}
      </div>
    </div>
  );
}

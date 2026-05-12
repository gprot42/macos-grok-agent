import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@shared/components/ui/button";
import { Mic, Wand2, Info, Copy, Check, X } from "lucide-react";

interface GrokVoicePanelProps {
  apiKey: string;
}

const BUILTIN_VOICES = [
  { value: "eve",   label: "Eve",   desc: "Warm female"     },
  { value: "ara",   label: "Ara",   desc: "Expressive"      },
  { value: "rex",   label: "Rex",   desc: "Deep male"       },
  { value: "adam",  label: "Adam",  desc: "Clear male"      },
  { value: "ava",   label: "Ava",   desc: "Bright female"   },
  { value: "leo",   label: "Leo",   desc: "Friendly male"   },
  { value: "luna",  label: "Luna",  desc: "Soft female"     },
  { value: "orion", label: "Orion", desc: "Rich male"       },
];

const LANGUAGES = [
  { value: "en", label: "English" }, { value: "es", label: "Spanish" },
  { value: "fr", label: "French"  }, { value: "de", label: "German"  },
  { value: "it", label: "Italian" }, { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch"   }, { value: "pl", label: "Polish"  },
  { value: "ru", label: "Russian" }, { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean"  }, { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic"  }, { value: "hi", label: "Hindi"   },
  { value: "tr", label: "Turkish" }, { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish"  }, { value: "fi", label: "Finnish" },
  { value: "nb", label: "Norwegian" }, { value: "cs", label: "Czech" },
  { value: "ro", label: "Romanian" }, { value: "uk", label: "Ukrainian" },
  { value: "id", label: "Indonesian" }, { value: "vi", label: "Vietnamese" },
];

const SPEECH_TAGS = [
  { tag: "[laugh]",                  desc: "Natural laugh" },
  { tag: "[sigh]",                   desc: "Audible sigh" },
  { tag: "<whisper>…</whisper>",     desc: "Whispered segment" },
  { tag: "<emphasis>…</emphasis>",   desc: "Emphasis" },
  { tag: "<break time='1s'/>",       desc: "Pause N seconds" },
  { tag: "<slow>…</slow>",           desc: "Slower delivery" },
  { tag: "<fast>…</fast>",           desc: "Faster delivery" },
];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" title="Copy">
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function GrokVoicePanel({ apiKey }: GrokVoicePanelProps) {
  const [text, setText] = useState("");
  const [voiceMode, setVoiceMode] = useState<"builtin" | "custom">("builtin");
  const [builtinVoice, setBuiltinVoice] = useState("eve");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [language, setLanguage] = useState("en");
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTags, setShowTags] = useState(false);
  const [showCloneGuide, setShowCloneGuide] = useState(false);

  const activeVoiceId = voiceMode === "custom" ? customVoiceId.trim() : builtinVoice;
  const canGenerate = !isLoading && text.trim().length > 0 && activeVoiceId.length > 0;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setAudioBase64(null);
    try {
      const b64 = await invoke<string>("generate_speech", { text, apiKey, voiceId: activeVoiceId, language });
      setAudioBase64(b64);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Top controls (fixed height) ──────────────────────────────── */}
      <div className="flex-shrink-0 border-b theme-border theme-surface px-4 pt-3 pb-2 space-y-2.5">

        {/* Header row */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 shadow-sm flex-shrink-0">
            <Mic className="h-4 w-4 text-white" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold theme-text">Grok Voice</span>
            <span className="text-sm font-mono text-gray-400 dark:text-gray-400 hidden sm:inline">
              grok-tts · 20+ languages · $4.20/1M chars
            </span>
          </div>
        </div>

        {/* Voice mode toggle + built-in picker OR custom input */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Toggle */}
          <div className="flex rounded-lg border theme-border overflow-hidden text-sm flex-shrink-0">
            <button onClick={() => setVoiceMode("builtin")}
              className={`px-3 py-1.5 transition-colors ${voiceMode === "builtin" ? "bg-blue-500 text-white" : "theme-surface theme-text-muted hover:theme-text"}`}>
              Built-in
            </button>
            <button onClick={() => { setVoiceMode("custom"); setShowCloneGuide(true); }}
              className={`px-3 py-1.5 transition-colors flex items-center gap-1.5 ${voiceMode === "custom" ? "bg-indigo-500 text-white" : "theme-surface theme-text-muted hover:theme-text"}`}>
              <Wand2 className="h-3.5 w-3.5" /> Cloned
            </button>
          </div>

          {voiceMode === "builtin" ? (
            /* Compact voice pills */
            <div className="flex gap-1 flex-wrap">
              {BUILTIN_VOICES.map((v) => (
                <button key={v.value} onClick={() => setBuiltinVoice(v.value)}
                  title={v.desc}
                  className={`px-2.5 py-1 rounded-md text-sm font-medium transition-colors ${
                    builtinVoice === v.value
                      ? "bg-blue-500 text-white"
                      : "theme-surface border theme-border theme-text-muted hover:border-blue-400 hover:theme-text"
                  }`}>
                  {v.label}
                </button>
              ))}
            </div>
          ) : (
            /* Custom voice ID */
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input type="text" value={customVoiceId} onChange={(e) => setCustomVoiceId(e.target.value)}
                placeholder="Voice ID (e.g. nlbqfwie)"
                maxLength={16}
                className="flex-1 min-w-0 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button onClick={() => setShowCloneGuide((v) => !v)}
                className={`p-1.5 rounded-lg border theme-border transition-colors ${showCloneGuide ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-500" : "theme-surface text-indigo-400 hover:text-indigo-600"}`}
                title="How to clone your voice">
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Language + speech-tags row */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium theme-text whitespace-nowrap flex-shrink-0">Language</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}
            className="flex-1 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <button onClick={() => setShowTags((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm transition-colors flex-shrink-0 ${
              showTags ? "bg-blue-100 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-300" : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            }`}>
            <Info className="h-3.5 w-3.5" /> Tags
          </button>
        </div>

        {/* Speech tags reference */}
        {showTags && (
          <div className="rounded-lg border theme-border bg-gray-50 dark:bg-[#1e2030] p-3 grid grid-cols-2 gap-x-4 gap-y-1">
            {SPEECH_TAGS.map(({ tag, desc }) => (
              <div key={tag} className="flex items-center gap-2 py-0.5">
                <code className="font-mono bg-white dark:bg-[#2a2f45] px-1.5 py-0.5 rounded text-sm text-blue-600 dark:text-cyan-300 border border-gray-200 dark:border-gray-600 flex items-center gap-1 whitespace-nowrap">
                  {tag} <CopyBtn text={tag} />
                </code>
                <span className="text-sm text-gray-600 dark:text-gray-300 truncate">{desc}</span>
              </div>
            ))}
          </div>
        )}

        {/* Clone guide */}
        {showCloneGuide && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                <Wand2 className="h-3.5 w-3.5" /> Clone your voice (under 4 min)
              </span>
              <button onClick={() => setShowCloneGuide(false)} className="text-indigo-400 hover:text-indigo-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ol className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                <>Go to <a href="https://console.x.ai/team/default/voice/voice-library" target="_blank" rel="noreferrer" className="underline">console.x.ai → Voice Library</a></>,
                <>Click <strong>Clone a Voice</strong></>,
                <>Record <strong>30–60 s</strong> of clear speech in a quiet room</>,
                <>Complete the passphrase verification</>,
                <>Wait ~2 minutes for processing</>,
                <>Three-dot menu → <strong>Copy Voice ID</strong> → paste above</>,
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm text-indigo-800 dark:text-indigo-200">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-200 dark:bg-indigo-800 text-[9px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* ── Text input (flex, fills remaining space) ─────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-base font-medium theme-text">Text to speak</span>
          <span className="text-sm font-mono text-gray-400 dark:text-gray-400">
            {text.length} chars · ≈ ${((text.length / 1_000_000) * 4.20).toFixed(6)}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleGenerate(); } }}
          placeholder={"Enter text to speak…\n\nTip: [laugh], <whisper>soft</whisper>, <emphasis>important</emphasis>"}
          className="flex-1 resize-none rounded-xl border theme-border theme-surface theme-text px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 scrollbar-thin"
        />

        <Button onClick={handleGenerate} disabled={!canGenerate} className="w-full flex-shrink-0">
          {isLoading ? "Generating…" : "Generate Speech"}
        </Button>
      </div>

      {/* ── Audio output (fixed height, appears at bottom) ───────────── */}
      {(error || audioBase64) && (
        <div className="flex-shrink-0 border-t theme-border px-4 py-3 theme-surface space-y-2">
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          {audioBase64 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm theme-text-muted">
                <span className="font-mono">{voiceMode === "custom" ? `cloned: ${activeVoiceId}` : activeVoiceId} · {LANGUAGES.find(l => l.value === language)?.label}</span>
                <a href={`data:audio/mpeg;base64,${audioBase64}`}
                  download={`grok-voice-${activeVoiceId}-${Date.now()}.mp3`}
                  className="text-blue-500 hover:underline text-sm">
                  Download MP3
                </a>
              </div>
              <audio controls src={`data:audio/mpeg;base64,${audioBase64}`} className="w-full h-8" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

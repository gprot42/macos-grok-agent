import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { Button } from "@shared/components/ui/button";
import { BUILTIN_VOICES } from "@shared/constants/voices";
import {
  Mic,
  Wand2,
  Info,
  Copy,
  Check,
  X,
  RefreshCw,
  Trash2,
  Square,
  Upload,
  Loader2,
} from "lucide-react";
import { DEFAULT_TTS_MODEL, TTS_MODELS } from "../lib/realtimeTypes";
import {
  CUSTOM_VOICE_GENDERS,
  CUSTOM_VOICE_TONES,
  CUSTOM_VOICE_USE_CASES,
  CUSTOM_VOICES_AUTH_NOTE,
  CUSTOM_VOICES_REGION_NOTE,
  type CustomVoice,
  blobToBase64,
  displayVoiceName,
  loadCachedCustomVoices,
  mergeCustomVoices,
  normalizeCustomVoice,
  normalizeCustomVoiceList,
  pickRecorderMimeType,
  saveCachedCustomVoices,
} from "../lib/customVoices";

interface GrokVoicePanelProps {
  apiKey: string;
  /** Start on built-in voices or cloned/custom mode. */
  initialVoiceMode?: "builtin" | "custom";
  /** Open the clone / library panel on mount (Voice Clone mode). */
  initialShowClonePanel?: boolean;
}

const LANGUAGES = [
  { value: "ar", label: "Arabic" },
  { value: "zh", label: "Chinese" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "nb", label: "Norwegian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "es", label: "Spanish" },
  { value: "sv", label: "Swedish" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "vi", label: "Vietnamese" },
];

const SPEECH_TAGS = [
  { tag: "[laugh]", desc: "Natural laugh" },
  { tag: "[sigh]", desc: "Audible sigh" },
  { tag: "<whisper>…</whisper>", desc: "Whispered segment" },
  { tag: "<emphasis>…</emphasis>", desc: "Emphasis" },
  { tag: "<break time='1s'/>", desc: "Pause N seconds" },
  { tag: "<slow>…</slow>", desc: "Slower delivery" },
  { tag: "<fast>…</fast>", desc: "Faster delivery" },
];

const CONSOLE_VOICE_LIBRARY =
  "https://console.x.ai/team/default/voice/voice-library";

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
      title="Copy"
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}

function formatInvokeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

export function GrokVoicePanel({
  apiKey,
  initialVoiceMode = "builtin",
  initialShowClonePanel = false,
}: GrokVoicePanelProps) {
  const [text, setText] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_TTS_MODEL);
  const [voiceMode, setVoiceMode] = useState<"builtin" | "custom">(initialVoiceMode);
  const [builtinVoice, setBuiltinVoice] = useState("eve");
  const [customVoiceId, setCustomVoiceId] = useState("");
  const [language, setLanguage] = useState("en");
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTags, setShowTags] = useState(false);
  const [showClonePanel, setShowClonePanel] = useState(
    initialShowClonePanel || initialVoiceMode === "custom"
  );

  // Custom voice library (seed from local cache so reloads still show known voices)
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>(() =>
    loadCachedCustomVoices()
  );
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Clone form
  const [cloneName, setCloneName] = useState("");
  const [cloneLanguage, setCloneLanguage] = useState("en");
  const [cloneGender, setCloneGender] = useState("");
  const [cloneTone, setCloneTone] = useState("");
  const [cloneUseCase, setCloneUseCase] = useState("");
  const [cloneDescription, setCloneDescription] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneStatus, setCloneStatus] = useState<string | null>(null);

  // Import voice ID from xAI console (when API list is empty / different team)
  const [importId, setImportId] = useState("");
  const [importName, setImportName] = useState("Daz");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // Recorder
  const [isRecording, setIsRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordSecsRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedModel = TTS_MODELS.find((m) => m.id === modelId) ?? TTS_MODELS[0];
  const activeVoiceId =
    voiceMode === "custom" ? customVoiceId.trim() : builtinVoice;
  const selectedCustomVoice =
    voiceMode === "custom"
      ? customVoices.find((v) => v.voice_id === customVoiceId.trim()) ?? null
      : null;
  const activeVoiceLabel =
    voiceMode === "custom"
      ? selectedCustomVoice
        ? displayVoiceName(selectedCustomVoice)
        : customVoiceId.trim() || "No voice selected"
      : BUILTIN_VOICES.find((v) => v.value === builtinVoice)?.label ?? builtinVoice;
  const canGenerate =
    !isLoading && text.trim().length > 0 && activeVoiceId.length > 0;

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    setLibraryError(null);
    const cached = loadCachedCustomVoices();
    try {
      const res = await invoke<unknown>("list_custom_voices", {
        apiKey,
        limit: 100,
      });
      const fromApi = normalizeCustomVoiceList(res);
      // Merge API + local cache so in-app creates always stick even if list is empty
      setCustomVoices((prev) => {
        const merged = mergeCustomVoices(fromApi, cached, prev);
        saveCachedCustomVoices(merged);
        return merged;
      });
    } catch (e: unknown) {
      setLibraryError(formatInvokeError(e));
      // Keep cache on failure so previously created voices remain selectable
      setCustomVoices((prev) => {
        const fallback = mergeCustomVoices(cached, prev);
        return fallback;
      });
    } finally {
      setLibraryLoading(false);
    }
  }, [apiKey]);

  // Load library when switching to cloned mode
  useEffect(() => {
    if (voiceMode === "custom") {
      void refreshLibrary();
    }
  }, [voiceMode, refreshLibrary]);

  // Resolve name when user pastes an ID that is not in the cached list
  useEffect(() => {
    if (voiceMode !== "custom") return;
    const id = customVoiceId.trim();
    if (!id || customVoices.some((v) => v.voice_id === id)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke<unknown>("get_custom_voice", {
          apiKey,
          voiceId: id,
        });
        const voice = normalizeCustomVoice(res);
        if (!cancelled && voice) {
          setCustomVoices((prev) =>
            prev.some((v) => v.voice_id === voice.voice_id)
              ? prev
              : [...prev, voice]
          );
        }
      } catch {
        /* ignore — ID may be invalid or region-blocked */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceMode, customVoiceId, customVoices, apiKey]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordStreamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsLoading(true);
    setError(null);
    setAudioBase64(null);
    try {
      const b64 = await invoke<string>("generate_speech", {
        text,
        apiKey,
        voiceId: activeVoiceId,
        language,
        modelId,
      });
      setAudioBase64(b64);
    } catch (e: unknown) {
      setError(formatInvokeError(e));
    } finally {
      setIsLoading(false);
    }
  };

  const stopRecording = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    setIsRecording(false);
  }, []);

  const startRecording = async () => {
    setError(null);
    setCloneStatus(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      const { mimeType, extension } = pickRecorderMimeType();
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recordChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recordChunksRef.current, { type });
        const file = new File(
          [blob],
          `clone-sample-${Date.now()}.${extension}`,
          { type }
        );
        setSampleFile(file);
        setCloneStatus(
          `Recorded ${(blob.size / 1024).toFixed(0)} KB · ~${recordSecsRef.current}s — ready to clone`
        );
        stream.getTracks().forEach((t) => t.stop());
        recordStreamRef.current = null;
        mediaRecorderRef.current = null;
      };
      mediaRecorderRef.current = rec;
      recordSecsRef.current = 0;
      setRecordSecs(0);
      setIsRecording(true);
      recordTimerRef.current = setInterval(() => {
        recordSecsRef.current += 1;
        const next = recordSecsRef.current;
        setRecordSecs(next);
        // Hard stop near 120s API max
        if (next >= 118) {
          stopRecording();
        }
      }, 1000);
      rec.start(250);
    } catch (e: unknown) {
      setError(
        `Microphone access failed: ${formatInvokeError(e)}. Grant mic permission in System Settings → Privacy & Security → Microphone.`
      );
    }
  };

  const handleFilePick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setSampleFile(f);
    setCloneStatus(`Selected ${f.name} (${(f.size / 1024).toFixed(0)} KB)`);
    setError(null);
  };

  const handleClone = async () => {
    if (!sampleFile || isCloning) return;
    setIsCloning(true);
    setError(null);
    setCloneStatus("Uploading sample and creating voice…");
    try {
      const audio_base64 = await blobToBase64(sampleFile);
      const raw = await invoke<unknown>("create_custom_voice", {
        apiKey,
        audioBase64: audio_base64,
        filename: sampleFile.name || "reference.webm",
        mimeType: sampleFile.type || "application/octet-stream",
        name: cloneName.trim() || null,
        language: cloneLanguage || "en",
        gender: cloneGender || null,
        tone: cloneTone || null,
        useCase: cloneUseCase || null,
        description: cloneDescription.trim() || null,
      });
      const result =
        normalizeCustomVoice(raw) ??
        ({
          voice_id: "",
          name: cloneName.trim() || null,
        } as CustomVoice);
      // Prefer API name; fall back to what the user typed (e.g. "daz")
      if (!result.name?.trim() && cloneName.trim()) {
        result.name = cloneName.trim();
      }
      const id = result.voice_id;
      if (!id) throw new Error("Create succeeded but no voice_id was returned");
      setCustomVoiceId(id);
      setVoiceMode("custom");
      setCustomVoices((prev) => {
        const merged = mergeCustomVoices([result], prev);
        saveCachedCustomVoices(merged);
        return merged;
      });
      setCloneStatus(
        `✅ Cloned voice ready: ${displayVoiceName(result)} (${id}) — select it above`
      );
      setSampleFile(null);
      setShowClonePanel(true);
      await refreshLibrary();
    } catch (e: unknown) {
      setError(formatInvokeError(e));
      setCloneStatus(null);
    } finally {
      setIsCloning(false);
    }
  };

  /** Add a console voice by ID (+ optional name) so it appears in the library. */
  const handleImportFromConsole = async () => {
    // Accept ID from either the import field or the "paste ID" box next to the dropdown
    const id = (importId.trim() || customVoiceId.trim()).toLowerCase();
    if (!id) {
      setImportStatus(
        "⚠️ First paste the Voice ID (console → Daz row → ⋯ → Copy Voice ID). Display name alone is not enough."
      );
      return;
    }
    // Voice IDs are 8 lowercase alphanumeric chars
    if (!/^[a-z0-9]{6,16}$/i.test(id)) {
      setImportStatus(
        `⚠️ “${id}” does not look like a Voice ID. Copy the short ID from the console ⋯ menu (not the name “Daz”).`
      );
      return;
    }
    setImportLoading(true);
    setImportStatus(null);
    setError(null);
    try {
      // Prefer live metadata from xAI when the token can see this voice
      let voice: CustomVoice | null = null;
      try {
        const res = await invoke<unknown>("get_custom_voice", {
          apiKey,
          voiceId: id,
        });
        voice = normalizeCustomVoice(res);
      } catch {
        /* token may not list this team — still allow manual import */
      }
      const label = importName.trim() || "Daz";
      if (!voice) {
        voice = {
          voice_id: id,
          name: label,
          language: "en",
        };
      } else if (!voice.name?.trim()) {
        voice = { ...voice, name: label };
      } else if (importName.trim()) {
        // User-supplied label wins for display (e.g. "Daz")
        voice = { ...voice, name: importName.trim() };
      }
      setCustomVoices((prev) => {
        const merged = mergeCustomVoices([voice!], prev);
        saveCachedCustomVoices(merged);
        return merged;
      });
      setCustomVoiceId(voice.voice_id);
      setImportId(voice.voice_id);
      setVoiceMode("custom");
      setImportStatus(
        `✅ Added “${displayVoiceName(voice)}” (${voice.voice_id}) — ready to speak`
      );
    } catch (e: unknown) {
      setImportStatus(formatInvokeError(e));
    } finally {
      setImportLoading(false);
    }
  };

  const handleDeleteVoice = async (voiceId: string) => {
    if (deletingId) return;
    setDeletingId(voiceId);
    setError(null);
    try {
      await invoke("delete_custom_voice", { apiKey, voiceId });
      if (customVoiceId === voiceId) setCustomVoiceId("");
      setCustomVoices((prev) => {
        const next = prev.filter((v) => v.voice_id !== voiceId);
        saveCachedCustomVoices(next);
        return next;
      });
    } catch (e: unknown) {
      setError(formatInvokeError(e));
    } finally {
      setDeletingId(null);
    }
  };

  const openConsole = async () => {
    try {
      await shellOpen(CONSOLE_VOICE_LIBRARY);
    } catch {
      window.open(CONSOLE_VOICE_LIBRARY, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Top controls ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b theme-border theme-surface px-4 pt-3 pb-2 space-y-2.5 max-h-[55%] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 shadow-sm flex-shrink-0">
            <Mic className="h-4 w-4 text-white" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold theme-text">Text to Speech</span>
              <span className="text-xs theme-text-muted hidden sm:inline">
                27 built-in · custom clone
              </span>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs theme-text-muted">Using</span>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 truncate">
                {selectedModel.label}
              </span>
              <code className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 truncate">
                {selectedModel.id}
              </code>
            </div>
          </div>
        </div>

        {/* Model */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="tts-model"
            className="text-sm font-medium theme-text whitespace-nowrap flex-shrink-0"
          >
            Model
          </label>
          <select
            id="tts-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="flex-1 min-w-0 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {TTS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.desc} ({m.id})
              </option>
            ))}
          </select>
        </div>

        {/* Voice mode + picker */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm font-medium theme-text whitespace-nowrap flex-shrink-0">
            Voice
          </label>
          <div className="flex rounded-lg border theme-border overflow-hidden text-sm flex-shrink-0">
            <button
              type="button"
              onClick={() => setVoiceMode("builtin")}
              className={`px-3 py-1.5 transition-colors ${
                voiceMode === "builtin"
                  ? "bg-blue-500 text-white"
                  : "theme-surface theme-text-muted hover:theme-text"
              }`}
            >
              Built-in
            </button>
            <button
              type="button"
              onClick={() => {
                setVoiceMode("custom");
                setShowClonePanel(true);
              }}
              className={`px-3 py-1.5 transition-colors flex items-center gap-1.5 ${
                voiceMode === "custom"
                  ? "bg-indigo-500 text-white"
                  : "theme-surface theme-text-muted hover:theme-text"
              }`}
            >
              <Wand2 className="h-3.5 w-3.5" /> Cloned
            </button>
          </div>

          {voiceMode === "builtin" ? (
            <select
              value={builtinVoice}
              onChange={(e) => setBuiltinVoice(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <optgroup label="Original">
                {BUILTIN_VOICES.filter((v) => v.group === "original").map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label} — {v.desc}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Flagship (new)">
                {BUILTIN_VOICES.filter((v) => v.group === "flagship").map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label} — {v.desc}
                  </option>
                ))}
              </optgroup>
            </select>
          ) : (
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <select
                  value={
                    customVoices.some((v) => v.voice_id === customVoiceId)
                      ? customVoiceId
                      : customVoiceId
                        ? "__manual__"
                        : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__manual__") return;
                    setCustomVoiceId(v);
                  }}
                  className="flex-1 min-w-0 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a cloned voice…</option>
                  {customVoices.map((v) => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {displayVoiceName(v)}
                      {v.name?.trim() ? ` — ${v.voice_id}` : ""}
                    </option>
                  ))}
                  {customVoiceId &&
                    !customVoices.some((v) => v.voice_id === customVoiceId) && (
                      <option value="__manual__">
                        Manual: {customVoiceId}
                      </option>
                    )}
                </select>
                <button
                  type="button"
                  onClick={() => setShowClonePanel((v) => !v)}
                  className={`p-1.5 rounded-lg border theme-border transition-colors ${
                    showClonePanel
                      ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-500"
                      : "theme-surface text-indigo-400 hover:text-indigo-600"
                  }`}
                  title="Clone & manage voices"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Always-visible library under the selector */}
              <div className="rounded-lg border border-indigo-200/70 dark:border-indigo-800/70 bg-indigo-50/40 dark:bg-indigo-950/20 px-2.5 py-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-indigo-800 dark:text-indigo-200">
                    Your cloned voices
                    {libraryLoading
                      ? " · loading…"
                      : ` · ${customVoices.length}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshLibrary()}
                    disabled={libraryLoading}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${libraryLoading ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </button>
                </div>

                {/* Team / auth requirement — always shown for cloned mode */}
                <div
                  role="note"
                  className="rounded-md border border-amber-400/70 dark:border-amber-600/60 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-2 text-[11px] text-amber-950 dark:text-amber-100 leading-snug space-y-1"
                >
                  <p className="font-semibold flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Same xAI team required for custom voices
                  </p>
                  <p>{CUSTOM_VOICES_AUTH_NOTE}</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-[10px] text-amber-900/90 dark:text-amber-100/90">
                    <li>
                      Importing a Voice ID only labels it in this app — TTS still
                      needs the <strong>API key of the team that owns the voice</strong>.
                    </li>
                    <li>
                      <strong>404 “Voice not found”</strong> almost always means
                      SuperGrok (or another key) ≠ the console team where you cloned.
                    </li>
                    <li>
                      Fix: <strong>Settings</strong> → API key from that console team
                      → return here → <strong>Refresh</strong> / re-import → generate.
                    </li>
                  </ul>
                </div>

                {libraryError && (
                  <p className="text-[11px] text-amber-800 dark:text-amber-200 leading-snug whitespace-pre-wrap max-h-20 overflow-y-auto">
                    Could not load from xAI (showing local cache if any).{" "}
                    {libraryError}
                  </p>
                )}

                {customVoices.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {customVoices.map((v) => {
                      const selected = customVoiceId === v.voice_id;
                      return (
                        <button
                          key={v.voice_id}
                          type="button"
                          onClick={() => setCustomVoiceId(v.voice_id)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors border ${
                            selected
                              ? "bg-indigo-600 text-white border-indigo-500"
                              : "bg-white/80 dark:bg-black/30 text-indigo-900 dark:text-indigo-100 border-indigo-200 dark:border-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                          }`}
                          title={v.voice_id}
                        >
                          <Wand2 className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[9rem]">
                            {displayVoiceName(v)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Import is always visible — works even when list is empty */}
                <div className="space-y-1.5 rounded-md border border-indigo-300/60 dark:border-indigo-700/60 bg-white/50 dark:bg-black/20 p-2">
                  <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100">
                    Import console voice (e.g. Daz)
                  </p>
                  <p className="text-[10px] text-indigo-800/80 dark:text-indigo-200/80 leading-snug">
                    1. Console → <strong>Daz</strong> row → <strong>⋯</strong> →{" "}
                    <strong>Copy Voice ID</strong> (short code like{" "}
                    <code className="font-mono">nlbqfwie</code>, not the name)
                    <br />
                    2. Paste into <strong>Voice ID</strong> below → click{" "}
                    <strong>Add to library</strong>
                    <br />
                    3. For speech to work: Settings must use an{" "}
                    <strong>API key from that same console team</strong> (not SuperGrok alone)
                  </p>
                  <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="import-voice-id"
                        className="text-[10px] font-medium text-indigo-900 dark:text-indigo-200"
                      >
                        Voice ID <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="import-voice-id"
                        type="text"
                        value={importId}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          setImportId(v);
                          setCustomVoiceId(v);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleImportFromConsole();
                          }
                        }}
                        placeholder="Paste ID here (required)"
                        maxLength={16}
                        autoComplete="off"
                        className="mt-0.5 w-full rounded-md border-2 border-indigo-400 dark:border-indigo-500 theme-surface theme-text px-2.5 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="w-full sm:w-28 shrink-0">
                      <label
                        htmlFor="import-voice-name"
                        className="text-[10px] font-medium text-indigo-900 dark:text-indigo-200"
                      >
                        Display name
                      </label>
                      <input
                        id="import-voice-name"
                        type="text"
                        value={importName}
                        onChange={(e) => setImportName(e.target.value)}
                        placeholder="Daz"
                        className="mt-0.5 w-full rounded-md border theme-border theme-surface theme-text px-2.5 py-2 text-sm"
                      />
                    </div>
                    <Button
                      type="button"
                      size="default"
                      onClick={() => void handleImportFromConsole()}
                      disabled={importLoading}
                      className="w-full sm:w-auto shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4"
                    >
                      {importLoading ? "Adding…" : "Add to library"}
                    </Button>
                  </div>
                  {importStatus && (
                    <p
                      role="status"
                      className={`text-[12px] font-medium leading-snug ${
                        importStatus.startsWith("✅")
                          ? "text-green-700 dark:text-green-300"
                          : "text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      {importStatus}
                    </p>
                  )}
                </div>

                {customVoiceId.trim() && selectedCustomVoice && (
                  <div className="flex items-center gap-2 text-xs pt-0.5">
                    <span className="text-muted-foreground shrink-0">
                      Selected
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-100 px-2.5 py-0.5 font-semibold max-w-full">
                      <Wand2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{activeVoiceLabel}</span>
                      <span className="font-mono font-normal text-[10px] opacity-70 truncate">
                        {selectedCustomVoice.voice_id}
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Language + tags */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium theme-text whitespace-nowrap flex-shrink-0">
            Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="flex-1 rounded-lg border theme-border theme-surface theme-text px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowTags((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm transition-colors flex-shrink-0 ${
              showTags
                ? "bg-blue-100 dark:bg-blue-900/30 border-blue-400 text-blue-600 dark:text-blue-300"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            }`}
          >
            <Info className="h-3.5 w-3.5" /> Tags
          </button>
        </div>

        {showTags && (
          <div className="rounded-lg border theme-border bg-gray-50 dark:bg-[#1e2030] p-3 grid grid-cols-2 gap-x-4 gap-y-1">
            {SPEECH_TAGS.map(({ tag, desc }) => (
              <div key={tag} className="flex items-center gap-2 py-0.5">
                <code className="font-mono bg-white dark:bg-[#2a2f45] px-1.5 py-0.5 rounded text-sm text-blue-600 dark:text-cyan-300 border border-gray-200 dark:border-gray-600 flex items-center gap-1 whitespace-nowrap">
                  {tag} <CopyBtn text={tag} />
                </code>
                <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                  {desc}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Clone panel ──────────────────────────────────────────── */}
        {showClonePanel && voiceMode === "custom" && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/30 p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-1.5">
                  <Wand2 className="h-3.5 w-3.5" /> Clone a voice
                </span>
                <p className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80 mt-0.5 leading-snug">
                  Record or upload 30–120s of clear speech (quiet room, one
                  speaker). API create needs Enterprise + US region; otherwise
                  use console.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowClonePanel(false)}
                className="text-indigo-400 hover:text-indigo-600 shrink-0"
                aria-label="Close clone panel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="rounded-lg border border-amber-300/80 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-100 leading-snug space-y-1.5">
              <p>
                <span className="font-semibold">Region: </span>
                {CUSTOM_VOICES_REGION_NOTE}{" "}
                <button
                  type="button"
                  onClick={() => void openConsole()}
                  className="underline font-medium"
                >
                  Open Voice Library
                </button>
              </p>
              <p>
                <span className="font-semibold">Auth / team: </span>
                {CUSTOM_VOICES_AUTH_NOTE}
              </p>
            </div>

            {/* Sample: record or upload */}
            <div className="flex flex-wrap items-center gap-2">
              {!isRecording ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void startRecording()}
                  disabled={isCloning}
                  className="gap-1.5"
                >
                  <Mic className="h-3.5 w-3.5" />
                  Record sample
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={stopRecording}
                  className="gap-1.5"
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop ({recordSecs}s)
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isCloning || isRecording}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm,.opus,.aac"
                className="hidden"
                onChange={(e) => {
                  handleFilePick(e.target.files);
                  e.target.value = "";
                }}
              />
              {sampleFile && (
                <span className="text-[11px] text-indigo-800 dark:text-indigo-200 font-mono truncate max-w-[14rem]">
                  {sampleFile.name}
                </span>
              )}
            </div>

            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-[11px] font-medium text-indigo-900 dark:text-indigo-200">
                  Name
                </label>
                <input
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="Friendly Narrator"
                  className="mt-0.5 w-full rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-indigo-900 dark:text-indigo-200">
                  Language
                </label>
                <select
                  value={cloneLanguage}
                  onChange={(e) => setCloneLanguage(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 text-sm"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-indigo-900 dark:text-indigo-200">
                  Gender
                </label>
                <select
                  value={cloneGender}
                  onChange={(e) => setCloneGender(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 text-sm"
                >
                  {CUSTOM_VOICE_GENDERS.map((g) => (
                    <option key={g.value || "none"} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-indigo-900 dark:text-indigo-200">
                  Tone
                </label>
                <select
                  value={cloneTone}
                  onChange={(e) => setCloneTone(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 text-sm"
                >
                  {CUSTOM_VOICE_TONES.map((t) => (
                    <option key={t.value || "none"} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-indigo-900 dark:text-indigo-200">
                  Use case
                </label>
                <select
                  value={cloneUseCase}
                  onChange={(e) => setCloneUseCase(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 text-sm"
                >
                  {CUSTOM_VOICE_USE_CASES.map((u) => (
                    <option key={u.value || "none"} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-indigo-900 dark:text-indigo-200">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={cloneDescription}
                  onChange={(e) => setCloneDescription(e.target.value)}
                  placeholder="Warm, conversational tone for narration"
                  className="mt-0.5 w-full rounded-lg border theme-border theme-surface theme-text px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => void handleClone()}
                disabled={!sampleFile || isCloning || isRecording}
                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {isCloning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cloning…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-3.5 w-3.5" />
                    Create cloned voice
                  </>
                )}
              </Button>
              {cloneStatus && (
                <span className="text-[11px] text-indigo-800 dark:text-indigo-200 min-w-0 truncate">
                  {cloneStatus}
                </span>
              )}
            </div>

            {/* Library */}
            <div className="border-t border-indigo-200 dark:border-indigo-800 pt-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                  Your custom voices ({customVoices.length}/30)
                </span>
                <button
                  type="button"
                  onClick={() => void refreshLibrary()}
                  disabled={libraryLoading}
                  className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-300 hover:underline disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${libraryLoading ? "animate-spin" : ""}`}
                  />
                  Refresh
                </button>
              </div>
              {libraryError && (
                <p className="text-[11px] text-red-700 dark:text-red-300 whitespace-pre-wrap leading-snug max-h-24 overflow-y-auto">
                  {libraryError}
                </p>
              )}
              {customVoices.length === 0 && !libraryLoading && !libraryError && (
                <p className="text-[11px] text-indigo-700/70 dark:text-indigo-300/70">
                  No custom voices on this team yet. Clone above or paste an ID
                  from the console.
                </p>
              )}
              <ul className="space-y-1 max-h-36 overflow-y-auto">
                {customVoices.map((v) => (
                  <li
                    key={v.voice_id}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                      customVoiceId === v.voice_id
                        ? "bg-indigo-200/60 dark:bg-indigo-800/40"
                        : "bg-white/60 dark:bg-black/20"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      onClick={() => setCustomVoiceId(v.voice_id)}
                    >
                      <span className="font-medium theme-text truncate block">
                        {displayVoiceName(v)}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {v.voice_id}
                        {v.language ? ` · ${v.language}` : ""}
                        {v.tone ? ` · ${v.tone}` : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="Copy voice ID"
                      onClick={() => void navigator.clipboard.writeText(v.voice_id)}
                      className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-500"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Delete voice"
                      disabled={deletingId === v.voice_id}
                      onClick={() => void handleDeleteVoice(v.voice_id)}
                      className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 disabled:opacity-50"
                    >
                      {deletingId === v.voice_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* ── Text input ───────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-base font-medium theme-text">Text to speak</span>
          <span className="text-sm font-mono text-gray-400 dark:text-gray-400">
            {text.length} chars · ≈ ${((text.length / 1_000_000) * 15).toFixed(6)}
          </span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handleGenerate();
            }
          }}
          placeholder={
            "Enter text to speak…\n\nTip: [laugh], <whisper>soft</whisper>, <emphasis>important</emphasis>"
          }
          className="flex-1 resize-none rounded-xl border theme-border theme-surface theme-text px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 scrollbar-thin"
        />

        <Button
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
          className="w-full flex-shrink-0"
        >
          {isLoading
            ? "Generating…"
            : voiceMode === "custom" && activeVoiceLabel
              ? `Generate Speech as “${activeVoiceLabel}”`
              : "Generate Speech"}
        </Button>
      </div>

      {/* ── Audio output ─────────────────────────────────────────────── */}
      {(error || audioBase64) && (
        <div className="flex-shrink-0 border-t theme-border px-4 py-3 theme-surface space-y-2">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap max-h-40 overflow-y-auto"
            >
              {error}
            </div>
          )}
          {audioBase64 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-sm theme-text-muted">
                <span className="truncate">
                  <span className="font-semibold text-indigo-700 dark:text-indigo-300">
                    {voiceMode === "custom"
                      ? `“${activeVoiceLabel}”`
                      : activeVoiceLabel}
                  </span>
                  <span className="font-mono text-xs opacity-70">
                    {" "}
                    · {activeVoiceId} · {selectedModel.id} ·{" "}
                    {LANGUAGES.find((l) => l.value === language)?.label}
                  </span>
                </span>
                <a
                  href={`data:audio/mpeg;base64,${audioBase64}`}
                  download={`grok-tts-${activeVoiceId}-${Date.now()}.mp3`}
                  className="text-blue-500 hover:underline text-sm shrink-0"
                >
                  Download MP3
                </a>
              </div>
              <audio
                controls
                src={`data:audio/mpeg;base64,${audioBase64}`}
                className="w-full h-8"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

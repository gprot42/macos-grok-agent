import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Badge } from "@shared/components/ui/badge";
import {
  buildSegments,
  formatDuration,
  speakerLabel,
  speakerTranscript,
  toSrt,
  type Segment,
  type SttWord,
} from "../lib/transcript";
import { Upload, Mic, Copy, Check, Download, X, Loader2, Trash2, Square, FileAudio, Captions } from "lucide-react";

/** Grok Voice Transcribe models (`POST /v1/stt`). */
const STT_MODELS = [
  { id: "grok-voice-transcribe-2.0", label: "Transcribe 2.0", hint: "Latest — best accuracy, diarization and formatting" },
  { id: "grok-voice-transcribe-1.0", label: "Transcribe 1.0", hint: "Original model" },
] as const;

type SttModelId = (typeof STT_MODELS)[number]["id"];

/** Language hint for formatting. "auto" omits the field and lets the API detect it. */
const LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "sv", label: "Swedish" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
];

/** Containers the API auto-detects (audio, plus audio tracks inside video files). */
const SUPPORTED_EXTS = ["wav", "mp3", "ogg", "opus", "flac", "aac", "m4a", "mp4", "mkv", "mov", "webm"];
/** Dropped files and mic recordings cross the IPC bridge as base64 — keep those modest. */
const INLINE_MAX_BYTES = 100 * 1024 * 1024;

function getRecorderMimeType(): string {
  const preferred = [
    "audio/mp4",
    "audio/aac",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const mt of preferred) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) {
      return mt;
    }
  }
  return "audio/mp4";
}

interface SttResponse {
  text?: string;
  language?: string;
  duration?: number;
  words?: SttWord[];
  model?: string;
  filename?: string;
}

interface TranscriptResult {
  id: string;
  filename: string;
  model: string;
  language: string;
  duration: number | null;
  text: string;
  segments: Segment[];
  diarized: boolean;
  timestamp: number;
}

type ResultView = "text" | "segments";

interface SpeechToTextPanelProps {
  apiKey: string;
  activeProject?: string | null;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function formatInvokeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as Record<string, unknown>).message === "string") {
    return (e as Record<string, string>).message;
  }
  return String(e);
}

type AudioSource =
  | { kind: "path"; filePath: string; filename: string }
  | { kind: "inline"; base64: string; mimeType: string; filename: string };

export function SpeechToTextPanel({ apiKey, activeProject = null }: SpeechToTextPanelProps) {
  const [model, setModel] = useState<SttModelId>("grok-voice-transcribe-2.0");
  const [language, setLanguage] = useState("auto");
  const [formatText, setFormatText] = useState(true);
  const [diarize, setDiarize] = useState(false);
  const [fillerWords, setFillerWords] = useState(false);
  const [keyterms, setKeyterms] = useState("");
  const [results, setResults] = useState<TranscriptResult[]>([]);
  const [views, setViews] = useState<Record<string, ResultView>>({});
  const [runningTasks, setRunningTasks] = useState<{ id: string; filename: string; model: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [inputMode, setInputMode] = useState<"upload" | "mic">("upload");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingSecondsRef = useRef(0);
  const recorderMimeRef = useRef(getRecorderMimeType());

  const isLoading = runningTasks.length > 0;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const transcribe = useCallback(async (source: AudioSource) => {
    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRunningTasks((prev) => [...prev, { id: taskId, filename: source.filename, model }]);
    setError(null);

    try {
      // Backend re-resolves SuperGrok OAuth / API key from Settings at request time.
      const resp = await invoke<SttResponse>("transcribe_audio", {
        apiKey,
        filePath: source.kind === "path" ? source.filePath : null,
        audioBase64: source.kind === "inline" ? source.base64 : null,
        filename: source.filename,
        mimeType: source.kind === "inline" ? source.mimeType : null,
        modelId: model,
        language: language !== "auto" ? language : null,
        format: formatText,
        diarize,
        fillerWords,
        multichannel: false,
        keyterms: keyterms.split(",").map((t) => t.trim()).filter(Boolean),
      });

      const words = Array.isArray(resp.words) ? resp.words : [];
      const segments = buildSegments(words);
      const diarized = words.some((w) => w.speaker !== undefined && w.speaker !== null);
      const text = (resp.text ?? "").trim() || segments.map((s) => s.text).join(" ");

      setResults((prev) => [{
        id: taskId,
        filename: source.filename,
        model: resp.model ?? model,
        language: resp.language || (language !== "auto" ? language : "auto"),
        duration: typeof resp.duration === "number" ? resp.duration : null,
        text,
        segments,
        diarized,
        timestamp: Date.now(),
      }, ...prev]);
      if (diarized) setViews((prev) => ({ ...prev, [taskId]: "segments" }));
    } catch (e) {
      setError(formatInvokeError(e));
    } finally {
      setRunningTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
  }, [apiKey, model, language, formatText, diarize, fillerWords, keyterms]);

  /** Native picker → file path; Rust reads the file, so files up to 500 MB work. */
  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Audio / Video", extensions: SUPPORTED_EXTS }],
      });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      for (const filePath of paths) {
        void transcribe({ kind: "path", filePath, filename: filePath.split("/").pop() || "audio" });
      }
    } catch (e) {
      setError(formatInvokeError(e));
    }
  }, [transcribe]);

  /** Dropped File objects have no path in the webview — send inline as base64. */
  const handleDroppedFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (!SUPPORTED_EXTS.includes(ext)) {
      setError(`Supported formats: ${SUPPORTED_EXTS.join(", ").toUpperCase()}`);
      return;
    }
    if (file.size > INLINE_MAX_BYTES) {
      setError("Dropped files are limited to 100 MB — use Browse for larger files (up to 500 MB).");
      return;
    }
    const base64 = await blobToBase64(file);
    void transcribe({ kind: "inline", base64, mimeType: file.type || "", filename: file.name });
  }, [transcribe]);

  const startRecording = useCallback(async () => {
    setError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
      });
      streamRef.current = stream;

      const mimeType = recorderMimeRef.current;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const dur = recordingSecondsRef.current;
        setRecordingDuration(0);
        if (blob.size === 0) {
          setError("No audio recorded.");
          return;
        }
        if (blob.size > INLINE_MAX_BYTES) {
          setError("Recording exceeds 100 MB. Try a shorter clip.");
          return;
        }

        const baseMime = mimeType.split(";")[0];
        const ext = baseMime.includes("webm") ? "webm" : baseMime.includes("ogg") ? "ogg" : "m4a";
        const base64 = await blobToBase64(blob);
        void transcribe({
          kind: "inline",
          base64,
          mimeType: baseMime,
          filename: `recording-${formatDuration(dur).replace(/:/g, "m")}s.${ext}`,
        });
      };

      recorder.start(500);
      setRecording(true);
      setRecordingDuration(0);
      recordingSecondsRef.current = 0;
      timerRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingDuration(recordingSecondsRef.current);
      }, 1000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setError("Microphone access denied. Allow microphone permission and try again.");
      } else {
        setError(`Microphone error: ${msg}`);
      }
    }
  }, [transcribe]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    for (const file of Array.from(e.dataTransfer.files)) void handleDroppedFile(file);
  };

  /** Plain-text export: speaker turns when diarized, otherwise the API transcript. */
  const exportText = (r: TranscriptResult) => (r.diarized ? speakerTranscript(r.segments) : r.text);

  const handleCopy = async (r: TranscriptResult) => {
    try {
      await writeText(exportText(r));
      setCopiedId(r.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  };

  const handleSave = async (r: TranscriptResult, kind: "txt" | "srt") => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const base = r.filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const outFilename = `transcript-${base}-${timestamp}.${kind}`;
      const content = kind === "srt" ? toSrt(r.segments) : exportText(r);

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", { projectPath, subfolder: "outputs", filename: outFilename, content });
      } else {
        await invoke("save_output", { content, filename: outFilename });
      }

      setSavedId(`${r.id}-${kind}`);
      setTimeout(() => setSavedId(null), 2000);
    } catch (e) {
      setError(`Save failed: ${formatInvokeError(e)}`);
    }
  };

  const removeResult = (id: string) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleBtn = (active: boolean) =>
    `px-2.5 py-1 text-xs rounded-md transition-colors ${
      active
        ? "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-semibold ring-1 ring-amber-400 dark:ring-amber-600"
        : "theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
    }`;

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {runningTasks.map((task) => (
          <div key={task.id} className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <div className="min-w-0">
                <div className="font-medium truncate">Transcribing {task.filename}…</div>
                <div className="text-sm opacity-75 font-mono">{task.model}</div>
              </div>
            </div>
          </div>
        ))}

        {results.length === 0 && !isLoading && !recording && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-6">
            <FileAudio className="h-16 w-16 opacity-60" />
            <div className="text-center max-w-xl">
              <div className="text-2xl font-semibold mb-1">Grok Voice Transcribe</div>
              <div className="text-sm font-mono mb-4">{model}</div>
              <div className="text-base leading-relaxed">
                Upload an audio or video file, or record from your microphone, and get the
                transcript with speaker labels, word-level timestamps and SRT subtitles.
              </div>
              <div className="text-xs mt-3 opacity-75">
                WAV · MP3 · OGG · Opus · FLAC · AAC · M4A · MP4 · MKV — up to 500 MB
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {results.map((r) => {
            const view: ResultView = views[r.id] ?? "text";
            const hasSegments = r.segments.length > 0;
            return (
              <div key={r.id} className="theme-surface border theme-border rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b theme-border bg-gray-50 dark:bg-gray-800/50 flex-wrap">
                  <FileAudio className="h-4 w-4 theme-text-muted" />
                  <span className="text-sm font-medium theme-text flex-1 truncate min-w-[8rem]">
                    {r.filename}
                  </span>
                  {r.duration != null && (
                    <Badge variant="secondary" className="text-xs font-mono">{formatDuration(r.duration)}</Badge>
                  )}
                  <Badge variant="secondary" className="text-xs">{r.language}</Badge>
                  {r.diarized && <Badge variant="secondary" className="text-xs">speakers</Badge>}
                  <span className="text-xs theme-text-muted font-mono">{r.model.replace("grok-voice-", "")}</span>
                  <span className="text-xs theme-text-muted">
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </span>
                </div>

                <div className="p-4 max-h-[600px] overflow-y-auto">
                  {view === "segments" && hasSegments ? (
                    <div className="space-y-1.5">
                      {r.segments.map((seg, i) => (
                        <div key={i} className="flex gap-3 text-sm leading-relaxed">
                          <span className="font-mono text-xs theme-text-muted shrink-0 pt-0.5 tabular-nums">
                            {formatDuration(seg.start)}
                          </span>
                          <span className="theme-text">
                            {r.diarized && (
                              <span className="font-semibold text-amber-700 dark:text-amber-300">
                                {speakerLabel(seg.speaker)}:{" "}
                              </span>
                            )}
                            {seg.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed theme-text">
                      {r.text || "(No speech detected)"}
                    </pre>
                  )}
                </div>

                <div className="flex items-center gap-2 px-4 py-2 border-t theme-border bg-gray-50 dark:bg-gray-800/50 flex-wrap">
                  <button
                    onClick={() => void handleCopy(r)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                  >
                    {copiedId === r.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === r.id ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => void handleSave(r, "txt")}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                    title={activeProject ? `Save to project: ${activeProject}` : "Save transcript as .txt"}
                  >
                    {savedId === `${r.id}-txt` ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Download className="h-3.5 w-3.5" />}
                    {savedId === `${r.id}-txt` ? "Saved!" : "Save .txt"}
                  </button>
                  {hasSegments && (
                    <button
                      onClick={() => void handleSave(r, "srt")}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                      title="Save subtitles built from word-level timestamps"
                    >
                      {savedId === `${r.id}-srt` ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Captions className="h-3.5 w-3.5" />}
                      {savedId === `${r.id}-srt` ? "Saved!" : "Save .srt"}
                    </button>
                  )}
                  {hasSegments && (
                    <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 ml-1">
                      {(["text", "segments"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setViews((prev) => ({ ...prev, [r.id]: v }))}
                          className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                            view === v ? "bg-background shadow-sm theme-text font-medium" : "theme-text-muted hover:theme-text"
                          }`}
                        >
                          {v === "text" ? "Text" : "Timestamps"}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => removeResult(r.id)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-3">
        {error && (
          <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-start justify-between gap-2">
            <span className="whitespace-pre-wrap break-words min-w-0">{error}</span>
            <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Model + options */}
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs theme-text-muted font-medium">Model:</span>
            {STT_MODELS.map((m) => (
              <button key={m.id} type="button" onClick={() => setModel(m.id)} title={`${m.id} — ${m.hint}`} className={toggleBtn(model === m.id)}>
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs theme-text-muted font-medium">Language:</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border theme-border theme-surface theme-text focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setDiarize((v) => !v)} title="Identify who is speaking (speaker labels per word)" className={toggleBtn(diarize)}>
              Speakers
            </button>
            <button type="button" onClick={() => setFormatText((v) => !v)} title="Inverse text normalisation — numbers, currency and dates written as digits. Works best with a language selected." className={toggleBtn(formatText)}>
              Format
            </button>
            <button type="button" onClick={() => setFillerWords((v) => !v)} title={'Keep filler words like "uh" and "um"'} className={toggleBtn(fillerWords)}>
              Fillers
            </button>
          </div>

          <div className="flex-1" />
          {results.length > 0 && (
            <button
              onClick={() => { setResults([]); setViews({}); setError(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs theme-text-muted font-medium shrink-0">Key terms:</span>
          <input
            type="text"
            value={keyterms}
            onChange={(e) => setKeyterms(e.target.value)}
            placeholder="Optional — names, products, jargon (comma-separated, up to 100)"
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-lg border theme-border theme-surface theme-text focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 shrink-0">
            <button
              onClick={() => setInputMode("upload")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                inputMode === "upload" ? "bg-background shadow-sm theme-text font-medium" : "theme-text-muted hover:theme-text"
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
            <button
              onClick={() => setInputMode("mic")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                inputMode === "mic" ? "bg-background shadow-sm theme-text font-medium" : "theme-text-muted hover:theme-text"
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              Mic
            </button>
          </div>
        </div>

        {inputMode === "mic" ? (
          <div className="flex items-center gap-3 py-2">
            {recording ? (
              <>
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors shadow-sm"
                >
                  <Square className="h-4 w-4 fill-current" />
                  Stop
                </button>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                  <span className="text-sm font-mono font-medium theme-text">
                    {formatDuration(recordingDuration)}
                  </span>
                </div>
                <span className="text-xs theme-text-muted">Recording… stop when done to transcribe</span>
              </>
            ) : (
              <>
                <button
                  onClick={() => void startRecording()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium transition-colors shadow-sm"
                >
                  <Mic className="h-4 w-4" />
                  Start Recording
                </button>
                <span className="text-xs theme-text-muted">
                  Record from the mic, then transcribe with {STT_MODELS.find((m) => m.id === model)?.label}
                </span>
              </>
            )}
          </div>
        ) : (
          <div
            className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
              dragOver
                ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                : "theme-border hover:border-gray-400 dark:hover:border-gray-600"
            }`}
            onClick={() => void handleBrowse()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="flex items-center justify-center gap-3 py-4 px-4">
              <Upload className="h-5 w-5 theme-text-muted" />
              <span className="text-sm theme-text-muted">
                Drop audio or video files here, or{" "}
                <span className="text-amber-600 dark:text-amber-400 font-medium underline underline-offset-2">browse</span>
              </span>
              <span className="text-xs theme-text-muted opacity-60">Up to 500 MB · multiple files OK</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

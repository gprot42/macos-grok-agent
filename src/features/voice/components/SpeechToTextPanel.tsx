import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Badge } from "@shared/components/ui/badge";
import { Upload, Mic, Copy, Check, Download, X, Loader2, Trash2, Square } from "lucide-react";

const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "ja-JP", label: "Japanese" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "ko-KR", label: "Korean" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it-IT", label: "Italian" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ar-SA", label: "Arabic" },
  { code: "ru-RU", label: "Russian" },
  { code: "th-TH", label: "Thai" },
  { code: "vi-VN", label: "Vietnamese" },
];

const SUPPORTED_AUDIO_EXTS = ["wav", "mp3", "flac", "ogg", "webm", "m4a", "aac", "wma", "opus"];

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

interface TranscriptResult {
  id: string;
  filename: string;
  language: string;
  transcript: string;
  timestamp: number;
}

interface SpeechToTextPanelProps {
  apiKey: string;
  projectId: string;
  activeProject: string | null;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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

export function SpeechToTextPanel({ apiKey, projectId, activeProject }: SpeechToTextPanelProps) {
  const [language, setLanguage] = useState("en-US");
  const [results, setResults] = useState<TranscriptResult[]>([]);
  const [runningTasks, setRunningTasks] = useState<{ id: string; filename: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [inputMode, setInputMode] = useState<"upload" | "mic">("mic");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderMimeRef = useRef(getRecorderMimeType());

  const isLoading = runningTasks.length > 0;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const transcribeAudio = useCallback(async (base64: string, mimeType: string, label: string) => {
    const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRunningTasks((prev) => [...prev, { id: taskId, filename: label }]);

    try {
      const transcript = await invoke<string>("speech_to_text", {
        audioData: base64,
        mimeType,
        languageCode: language,
        apiKey,
        projectId,
      });

      const langLabel = LANGUAGES.find((l) => l.code === language)?.label || language;

      setResults((prev) => [{
        id: taskId,
        filename: label,
        language: langLabel,
        transcript,
        timestamp: Date.now(),
      }, ...prev]);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunningTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
  }, [apiKey, projectId, language]);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!apiKey) {
      setError("API key required. Set your AI Studio key in Settings.");
      return;
    }

    const ext = file.name.toLowerCase().split(".").pop() || "";
    if (!SUPPORTED_AUDIO_EXTS.includes(ext)) {
      setError(`Supported formats: ${SUPPORTED_AUDIO_EXTS.join(", ").toUpperCase()}`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be under 10MB for inline transcription.");
      return;
    }

    setError(null);

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }

    const mimeType = file.type || "audio/wav";
    transcribeAudio(btoa(binary), mimeType, file.name);
  }, [apiKey, transcribeAudio]);

  const startRecording = useCallback(async () => {
    if (!apiKey) {
      setError("API key required. Set your AI Studio key in Settings.");
      return;
    }

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
        if (blob.size === 0) {
          setError("No audio recorded.");
          setRecordingDuration(0);
          return;
        }
        if (blob.size > 10 * 1024 * 1024) {
          setError("Recording exceeds 10MB limit. Try a shorter clip.");
          setRecordingDuration(0);
          return;
        }

        const base64 = await blobToBase64(blob);
        const dur = recordingDuration;
        setRecordingDuration(0);

        const baseMime = mimeType.split(";")[0];
        transcribeAudio(base64, baseMime, `Recording (${formatDuration(dur)})`);
      };

      recorder.start(500);
      setRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setError("Microphone access denied. Allow microphone permission and try again.");
      } else {
        setError(`Microphone error: ${msg}`);
      }
    }
  }, [apiKey, transcribeAudio, recordingDuration]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCopy = async (content: string, id: string) => {
    try {
      await writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      console.error("Copy failed:", e);
    }
  };

  const handleSave = async (content: string, id: string, filename: string) => {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const outFilename = `transcript-${filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_")}-${timestamp}.txt`;

      if (activeProject) {
        const projectPath = await invoke<string>("get_project_path", { projectName: activeProject });
        await invoke("save_to_project", { projectPath, subfolder: "outputs", filename: outFilename, content });
      } else {
        await invoke("save_output", { content, filename: outFilename });
      }

      setSavedId(id);
      setTimeout(() => setSavedId(null), 2000);
    } catch (e) {
      console.error("Save failed:", e);
    }
  };

  const removeResult = (id: string) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {runningTasks.map((task) => (
          <div key={task.id} className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
            <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <div>
                <div className="font-medium">Transcribing {task.filename}...</div>
                <div className="text-sm opacity-75">Using Gemini 2.5 Flash</div>
              </div>
            </div>
          </div>
        ))}

        {results.length === 0 && !isLoading && !recording && (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted gap-8">
            <div className="text-8xl">🎙️</div>
            <div className="text-center max-w-xl">
              <div className="text-2xl font-semibold mb-2">Speech to Text</div>
              <div className="text-lg mb-6">
                Transcribe audio using Gemini 2.5 Flash
              </div>
              <div className="grid grid-cols-2 gap-4 text-left max-w-md mx-auto">
                <div
                  className="p-4 rounded-xl border theme-border theme-surface hover:border-amber-300 dark:hover:border-amber-700 transition-colors cursor-pointer"
                  onClick={() => setInputMode("mic")}
                >
                  <div className="flex items-center gap-2 mb-2 font-medium theme-text">
                    <Mic className="h-4 w-4" />
                    Microphone
                  </div>
                  <div className="text-sm theme-text-muted leading-relaxed">
                    Record from your mic and transcribe
                  </div>
                </div>
                <div
                  className="p-4 rounded-xl border theme-border theme-surface hover:border-amber-300 dark:hover:border-amber-700 transition-colors cursor-pointer"
                  onClick={() => setInputMode("upload")}
                >
                  <div className="flex items-center gap-2 mb-2 font-medium theme-text">
                    <Upload className="h-4 w-4" />
                    Upload File
                  </div>
                  <div className="text-sm theme-text-muted leading-relaxed">
                    WAV, MP3, FLAC, OGG, WebM, M4A, and more
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {results.map((r) => (
            <div key={r.id} className="theme-surface border theme-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b theme-border bg-gray-50 dark:bg-gray-800/50">
                <Mic className="h-4 w-4 theme-text-muted" />
                <span className="text-sm font-medium theme-text flex-1 truncate">
                  {r.filename}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {r.language}
                </Badge>
                <span className="text-xs theme-text-muted">
                  {new Date(r.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <div className="p-4 max-h-[600px] overflow-y-auto">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed theme-text">
                  {r.transcript}
                </pre>
              </div>

              <div className="flex items-center gap-2 px-4 py-2 border-t theme-border bg-gray-50 dark:bg-gray-800/50">
                <button
                  onClick={() => handleCopy(r.transcript, r.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                >
                  {copiedId === r.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedId === r.id ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={() => handleSave(r.transcript, r.id, r.filename)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-hover theme-text-muted hover:theme-text transition-colors"
                >
                  {savedId === r.id ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Download className="h-3.5 w-3.5" />}
                  {savedId === r.id ? "Saved!" : "Save"}
                </button>
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
          ))}
        </div>
      </div>

      <div className="border-t theme-border p-3 theme-surface space-y-3">
        {error && (
          <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs theme-text-muted font-medium">Language:</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg border theme-border theme-surface theme-text focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5 ml-2">
            <button
              onClick={() => setInputMode("mic")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                inputMode === "mic"
                  ? "bg-background shadow-sm theme-text font-medium"
                  : "theme-text-muted hover:theme-text"
              }`}
            >
              <Mic className="h-3.5 w-3.5" />
              Mic
            </button>
            <button
              onClick={() => setInputMode("upload")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                inputMode === "upload"
                  ? "bg-background shadow-sm theme-text font-medium"
                  : "theme-text-muted hover:theme-text"
              }`}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
          </div>

          <div className="flex-1" />
          {(results.length > 0 || runningTasks.length > 0) && (
            <button
              onClick={() => { setResults([]); setError(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear All
            </button>
          )}
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
                <span className="text-xs theme-text-muted">Recording... stop when done to transcribe</span>
              </>
            ) : (
              <>
                <button
                  onClick={startRecording}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shadow-sm"
                >
                  <Mic className="h-4 w-4" />
                  Start Recording
                </button>
                <span className="text-xs theme-text-muted">
                  Record from mic, then transcribe with Gemini 2.5 Flash
                </span>
              </>
            )}
          </div>
        ) : (
          <div
            className={`relative border-2 border-dashed rounded-xl transition-colors ${
              dragOver
                ? "border-amber-400 bg-amber-50 dark:bg-amber-900/20"
                : "theme-border hover:border-gray-400 dark:hover:border-gray-600"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3,.flac,.ogg,.webm,.m4a,.aac,.wma,.opus,audio/*"
              onChange={handleInputChange}
              className="hidden"
            />
            <div className="flex items-center justify-center gap-3 py-4 px-4">
              <Upload className="h-5 w-5 theme-text-muted" />
              <span className="text-sm theme-text-muted">
                Drop an audio file here, or{" "}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-amber-600 hover:text-amber-700 dark:text-amber-400 font-medium underline underline-offset-2"
                  disabled={isLoading}
                >
                  browse
                </button>
              </span>
              <span className="text-xs theme-text-muted opacity-60">Max 10MB</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

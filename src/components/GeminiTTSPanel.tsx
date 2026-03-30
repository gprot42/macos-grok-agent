import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Play, Square, Download, Volume2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface GeminiTTSPanelProps {
  apiKey: string;
}

const MODELS = [
  { id: "gemini-2.5-flash-preview-tts", label: "Flash TTS", desc: "Fast, cost-efficient" },
  { id: "gemini-2.5-pro-preview-tts", label: "Pro TTS", desc: "Highest quality" },
] as const;

const VOICES: { name: string; style: string }[] = [
  { name: "Zephyr", style: "Bright" },
  { name: "Puck", style: "Upbeat" },
  { name: "Charon", style: "Informative" },
  { name: "Kore", style: "Firm" },
  { name: "Fenrir", style: "Excitable" },
  { name: "Leda", style: "Youthful" },
  { name: "Orus", style: "Firm" },
  { name: "Aoede", style: "Breezy" },
  { name: "Callirrhoe", style: "Easy-going" },
  { name: "Autonoe", style: "Bright" },
  { name: "Enceladus", style: "Breathy" },
  { name: "Iapetus", style: "Clear" },
  { name: "Umbriel", style: "Easy-going" },
  { name: "Algieba", style: "Informative" },
  { name: "Despina", style: "Smooth" },
  { name: "Erinome", style: "Clear" },
  { name: "Algenib", style: "Gravelly" },
  { name: "Rasalgethi", style: "Informative" },
  { name: "Laomedeia", style: "Upbeat" },
  { name: "Achernar", style: "Soft" },
  { name: "Alnilam", style: "Firm" },
  { name: "Schedar", style: "Even" },
  { name: "Gacrux", style: "Mature" },
  { name: "Pulcherrima", style: "Forward" },
  { name: "Achird", style: "Friendly" },
  { name: "Zubenelgenubi", style: "Casual" },
  { name: "Vindemiatrix", style: "Gentle" },
  { name: "Sadachbia", style: "Lively" },
  { name: "Sadaltager", style: "Knowledgeable" },
  { name: "Sulafat", style: "Warm" },
];

const EXAMPLES = [
  {
    label: "Cheerful greeting",
    text: "Have a wonderful day! The sun is shining, the birds are singing, and everything is going to be just great!",
    multiSpeaker: false,
  },
  {
    label: "News report",
    text: "Breaking news tonight. Scientists have confirmed the discovery of a new exoplanet in the habitable zone of a nearby star system, just twelve light years from Earth.",
    multiSpeaker: false,
  },
  {
    label: "Storytelling",
    text: "The door creaked open. A cold wind swept through the hallway, carrying whispers of something ancient and forgotten. She stepped inside, her heart pounding, knowing there was no turning back.",
    multiSpeaker: false,
  },
  {
    label: "Multi-speaker dialogue",
    text: "Alex: Hey Sam, did you hear about the new Gemini TTS models?\nSam: Yeah! The voice quality is incredible. It sounds so natural.\nAlex: I know, right? And you can control the tone and pacing just with text prompts.\nSam: That's going to change everything for content creators.",
    multiSpeaker: true,
    speakers: [
      { speaker: "Alex", voice: "Puck" },
      { speaker: "Sam", voice: "Kore" },
    ],
  },
  {
    label: "Podcast intro",
    text: "Host: Welcome back to Tech Decoded, the podcast where we break down the latest in AI and technology. I'm your host.\nGuest: And I'm thrilled to be here today to talk about the future of voice synthesis.\nHost: Let's dive right in. What makes this generation of TTS so different?",
    multiSpeaker: true,
    speakers: [
      { speaker: "Host", voice: "Charon" },
      { speaker: "Guest", voice: "Aoede" },
    ],
  },
];

export function GeminiTTSPanel({ apiKey }: GeminiTTSPanelProps) {
  const [model, setModel] = useState(MODELS[0].id as string);
  const [voice, setVoice] = useState("Kore");
  const [text, setText] = useState("");
  const [multiSpeaker, setMultiSpeaker] = useState(false);
  const [speakers, setSpeakers] = useState([
    { speaker: "Speaker 1", voice: "Puck" },
    { speaker: "Speaker 2", voice: "Kore" },
  ]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const generate = useCallback(async () => {
    if (!text.trim() || !apiKey) return;
    setGenerating(true);
    setError(null);
    setAudioUrl(null);

    try {
      let speechConfig: Record<string, unknown>;

      if (multiSpeaker) {
        speechConfig = {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakers.map((s) => ({
              speaker: s.speaker,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: s.voice },
              },
            })),
          },
        };
      } else {
        speechConfig = {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        };
      }

      const data = await invoke<Record<string, unknown>>("tts_generate", {
        apiKey,
        model,
        text: text.trim(),
        speechConfig: speechConfig,
      });

      const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
      const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, unknown>> | undefined;
      const audioPart = parts?.[0]?.inlineData as { data?: string; mimeType?: string } | undefined;

      if (!audioPart?.data) {
        const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
        const firstCandidate = candidates?.[0] as Record<string, unknown> | undefined;
        const blockReason = firstCandidate?.finishReason as string | undefined;
        throw new Error(
          blockReason
            ? `No audio generated. Reason: ${blockReason}`
            : "No audio data in API response. The model may not have generated output."
        );
      }

      // Convert base64 PCM to WAV blob
      const binary = atob(audioPart.data);
      const pcmBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        pcmBytes[i] = binary.charCodeAt(i);
      }

      const wavBlob = pcmToWav(pcmBytes, 24000, 16, 1);
      const url = URL.createObjectURL(wavBlob);

      // Clean up previous URL
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError("Network error — check your internet connection and API key.");
      } else {
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }, [text, apiKey, model, voice, multiSpeaker, speakers, audioUrl]);

  const playAudio = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const downloadAudio = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `tts-${Date.now()}.wav`;
    a.click();
  };

  const loadExample = (ex: (typeof EXAMPLES)[number]) => {
    setText(ex.text);
    setMultiSpeaker(ex.multiSpeaker);
    if (ex.multiSpeaker && ex.speakers) {
      setSpeakers(ex.speakers);
    }
  };

  const addSpeaker = () => {
    if (speakers.length >= 5) return;
    setSpeakers([...speakers, { speaker: `Speaker ${speakers.length + 1}`, voice: "Puck" }]);
  };

  const removeSpeaker = (idx: number) => {
    if (speakers.length <= 2) return;
    setSpeakers(speakers.filter((_, i) => i !== idx));
  };

  const updateSpeaker = (idx: number, field: "speaker" | "voice", value: string) => {
    setSpeakers(speakers.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-4xl mx-auto w-full p-6 space-y-6">
        {/* Model & Voice Selection */}
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium theme-text">Model</label>
              <div className="flex gap-2">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setModel(m.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      model === m.id
                        ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 font-medium"
                        : "theme-border theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    {m.label}
                    <span className="ml-1.5 opacity-60">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium theme-text">Mode:</label>
            <div className="flex gap-2">
              {[
                { value: false, label: "Single Speaker" },
                { value: true, label: "Multi-Speaker" },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  onClick={() => setMultiSpeaker(opt.value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    multiSpeaker === opt.value
                      ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 font-medium"
                      : "theme-border theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Single-speaker voice selector */}
          {!multiSpeaker && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium theme-text">Voice</label>
              <div className="flex flex-wrap gap-1.5">
                {VOICES.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => setVoice(v.name)}
                    className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                      voice === v.name
                        ? "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 font-medium"
                        : "theme-border theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                    title={v.style}
                  >
                    {v.name}
                    <span className="ml-1 opacity-50 text-[10px]">{v.style}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Multi-speaker config */}
          {multiSpeaker && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium theme-text">Speakers</label>
                <Button variant="outline" size="sm" onClick={addSpeaker} disabled={speakers.length >= 5} className="h-7 text-xs">
                  + Add Speaker
                </Button>
              </div>
              {speakers.map((s, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={s.speaker}
                    onChange={(e) => updateSpeaker(idx, "speaker", e.target.value)}
                    className="w-32 px-2 py-1 text-xs rounded-md border theme-border bg-transparent theme-text"
                    placeholder="Name"
                  />
                  <select
                    value={s.voice}
                    onChange={(e) => updateSpeaker(idx, "voice", e.target.value)}
                    className="flex-1 px-2 py-1 text-xs rounded-md border theme-border bg-transparent theme-text"
                  >
                    {VOICES.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.style})
                      </option>
                    ))}
                  </select>
                  {speakers.length > 2 && (
                    <Button variant="ghost" size="sm" onClick={() => removeSpeaker(idx)} className="h-7 w-7 p-0 text-red-500">
                      x
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Examples */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium theme-text">Examples</label>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => loadExample(ex)}
                className="px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                {ex.multiSpeaker && <span className="mr-1">👥</span>}
                {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Text input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium theme-text">
            Text to speak
            {multiSpeaker && (
              <span className="ml-2 opacity-60 font-normal">
                Use "Name: dialogue" format for each speaker
              </span>
            )}
          </label>
          <Textarea
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
            placeholder={
              multiSpeaker
                ? "Alex: Hello, how are you?\nSam: I'm doing great, thanks!"
                : "Enter the exact text to be spoken aloud (not instructions)..."
            }
            className="min-h-[120px] text-sm resize-y"
            rows={5}
          />
          <p className="text-xs theme-text-muted">
            Tip: Enter the exact words to speak, not instructions. For example, write "The weather is beautiful today" instead of "Say something about the weather".
          </p>
        </div>

        {/* Generate button */}
        <div className="flex items-center gap-3">
          <Button
            onClick={generate}
            disabled={!text.trim() || !apiKey || generating}
            className="gap-2"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {generating ? "Generating..." : "Generate Speech"}
          </Button>

          {audioUrl && (
            <>
              <Button variant="outline" size="sm" onClick={playAudio} className="gap-1.5">
                {isPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {isPlaying ? "Stop" : "Play"}
              </Button>
              <Button variant="outline" size="sm" onClick={downloadAudio} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </>
          )}
        </div>

        {/* Error display */}
        {error && (
          <div className="text-red-500 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Audio element */}
        {audioUrl && (
          <div className="theme-surface border theme-border rounded-lg p-4">
            <audio
              ref={audioRef}
              src={audioUrl}
              onEnded={() => setIsPlaying(false)}
              controls
              className="w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function pcmToWav(pcmData: Uint8Array, sampleRate: number, bitsPerSample: number, channels: number): Blob {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const output = new Uint8Array(buffer);
  output.set(pcmData, 44);

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

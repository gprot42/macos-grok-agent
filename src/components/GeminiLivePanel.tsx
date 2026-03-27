import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, MicOff, PhoneOff, Phone } from "lucide-react";

interface GeminiLivePanelProps {
  apiKey: string;
}

interface LiveMessage {
  role: "user" | "model";
  text: string;
}

const MODEL_ID = "gemini-3.1-flash-live-preview";
const MODEL_DISPLAY = "Gemini 3.1 Flash Live";
const WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

// AudioWorklet processor code as inline string
const WORKLET_CODE = `
class PCMStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(24000 * 60); // 60s ring buffer
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'audio') {
        const samples = e.data.samples;
        for (let i = 0; i < samples.length; i++) {
          this.buffer[this.writePos] = samples[i];
          this.writePos = (this.writePos + 1) % this.buffer.length;
        }
        this.available = Math.min(this.available + samples.length, this.buffer.length);
      } else if (e.data.type === 'clear') {
        this.writePos = 0;
        this.readPos = 0;
        this.available = 0;
      }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0][0];
    const toRead = Math.min(output.length, this.available);
    for (let i = 0; i < toRead; i++) {
      output[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.buffer.length;
    }
    for (let i = toRead; i < output.length; i++) {
      output[i] = 0;
    }
    this.available -= toRead;
    this.port.postMessage({ playing: toRead > 0 });
    return true;
  }
}
registerProcessor('pcm-stream-processor', PCMStreamProcessor);
`;

export function GeminiLivePanel({ apiKey }: GeminiLivePanelProps) {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [modelSpeaking, setModelSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingModelTextRef = useRef("");
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startPlaybackPipeline = useCallback(async () => {
    if (playbackCtxRef.current) return;

    const ctx = new AudioContext({ sampleRate: 24000 });
    playbackCtxRef.current = ctx;

    // Register worklet from inline code via Blob URL
    const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const node = new AudioWorkletNode(ctx, "pcm-stream-processor");
    workletNodeRef.current = node;

    // Throttled speaking state — only update React state every 200ms
    node.port.onmessage = (e) => {
      const isPlaying = e.data.playing;
      if (isPlaying) {
        if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
        setModelSpeaking(true);
        speakingTimerRef.current = setTimeout(() => setModelSpeaking(false), 300);
      }
    };

    node.connect(ctx.destination);
  }, []);

  const stopPlaybackPipeline = useCallback(() => {
    workletNodeRef.current?.port.postMessage({ type: "clear" });
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
    setModelSpeaking(false);
  }, []);

  const enqueueAudio = useCallback((pcmBuffer: ArrayBuffer) => {
    const float32 = pcm16ToFloat32(pcmBuffer);
    workletNodeRef.current?.port.postMessage(
      { type: "audio", samples: float32 },
      [float32.buffer] // transfer ownership for zero-copy
    );

    if (playbackCtxRef.current?.state === "suspended") {
      playbackCtxRef.current.resume();
    }
  }, []);

  const handleWsMessage = useCallback(
    (event: MessageEvent) => {
      const parseMessage = (raw: string) => {
        try {
          const data = JSON.parse(raw);

          if (data.setupComplete !== undefined) {
            setConnected(true);
            setConnecting(false);
            return;
          }

          if (data.serverContent) {
            const parts = data.serverContent.modelTurn?.parts || [];

            for (const part of parts) {
              if (part.text && !part.thought) {
                pendingModelTextRef.current += part.text;
              }
              if (part.inlineData?.data) {
                const binary = atob(part.inlineData.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }
                enqueueAudio(bytes.buffer);
              }
            }

            if (data.serverContent.outputTranscription?.text) {
              pendingModelTextRef.current += data.serverContent.outputTranscription.text;
            }

            if (data.serverContent.inputTranscription?.text) {
              const userText = data.serverContent.inputTranscription.text.trim();
              if (userText) {
                setMessages((prev) => [...prev, { role: "user", text: userText }]);
              }
            }

            if (data.serverContent.turnComplete) {
              if (pendingModelTextRef.current) {
                setMessages((prev) => [
                  ...prev,
                  { role: "model", text: pendingModelTextRef.current.trim() },
                ]);
                pendingModelTextRef.current = "";
              }
            }
          }
        } catch (err) {
          console.error("[GeminiLive] Parse error:", err);
        }
      };

      if (event.data instanceof Blob) {
        event.data.text().then(parseMessage);
      } else {
        parseMessage(event.data);
      }
    },
    [enqueueAudio]
  );

  // Auto-start mic when connected
  useEffect(() => {
    if (connected && !micActive) {
      toggleMic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const connect = useCallback(async () => {
    if (!apiKey) return;
    setConnecting(true);
    setConnectionError(null);

    await startPlaybackPipeline();

    const ws = new WebSocket(`${WS_URL}?key=${apiKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${MODEL_ID}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Puck" },
                },
              },
            },
            outputAudioTranscription: {},
            inputAudioTranscription: {},
          },
        })
      );
    };

    ws.onmessage = handleWsMessage;

    ws.onclose = (e) => {
      setConnected(false);
      setConnecting(false);
      setMicActive(false);
      if (e.code !== 1000 && e.code !== 1005) {
        setConnectionError(`Connection closed: ${e.code} ${e.reason || "(no reason)"}`);
      }
      stopMic();
      stopPlaybackPipeline();
    };

    ws.onerror = () => {
      setConnectionError("WebSocket connection failed");
      setConnected(false);
      setConnecting(false);
      stopPlaybackPipeline();
    };
  }, [apiKey, handleWsMessage, startPlaybackPipeline, stopPlaybackPipeline]);

  const disconnect = useCallback(() => {
    stopMic();
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    setMicActive(false);
    stopPlaybackPipeline();
  }, [stopPlaybackPipeline]);

  const stopMic = () => {
    micProcessorRef.current?.disconnect();
    micProcessorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micCtxRef.current?.close();
    micCtxRef.current = null;
  };

  const toggleMic = useCallback(async () => {
    if (micActive) {
      stopMic();
      setMicActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;

      // Use native sample rate then resample to 16kHz
      const ctx = new AudioContext();
      micCtxRef.current = ctx;
      const nativeSR = ctx.sampleRate;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      micProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Resample from native rate to 16kHz
        const ratio = nativeSR / 16000;
        const outputLen = Math.floor(inputData.length / ratio);
        const resampled = new Float32Array(outputLen);
        for (let i = 0; i < outputLen; i++) {
          resampled[i] = inputData[Math.floor(i * ratio)];
        }

        const pcm = float32ToPcm16(resampled);
        const b64 = arrayBufferToBase64(pcm);

        wsRef.current.send(
          JSON.stringify({
            realtimeInput: {
              audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
            },
          })
        );
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setMicActive(true);
    } catch (err) {
      console.error("Mic access failed:", err);
      setConnectionError("Microphone access denied");
    }
  }, [micActive]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin min-h-0">
        {!connected && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-tokyo-muted gap-6">
            <div className="text-8xl">🎙️</div>
            <div className="text-center">
              <div className="text-2xl font-semibold">Gemini Live</div>
              <div className="text-lg mt-1">Real-time voice conversation</div>
              <div className="text-sm mt-2 theme-text-muted">
                Model: <span className="font-mono text-xs">{MODEL_DISPLAY}</span>
              </div>
              <div className="text-sm mt-4 max-w-md text-center leading-relaxed text-gray-500">
                Low-latency audio-to-audio model for real-time dialogue. Click Start Session, then enable your mic to begin talking.
              </div>
            </div>
            <Button
              onClick={connect}
              disabled={!apiKey || connecting}
              className="gap-2 mt-2"
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Phone className="h-4 w-4" />
              )}
              {connecting ? "Connecting..." : "Start Session"}
            </Button>
            {connectionError && (
              <div className="text-red-500 text-sm mt-3 max-w-md text-center">{connectionError}</div>
            )}
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm max-w-[80%] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-indigo-600 text-white rounded-br-md"
                      : "theme-surface border theme-border rounded-bl-md theme-text"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {modelSpeaking && (
              <div className="flex justify-start">
                <div className="px-4 py-2.5 rounded-2xl text-sm theme-surface border theme-border rounded-bl-md theme-text-muted italic flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                  Speaking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {connected && (
        <div className="border-t theme-border p-3 theme-surface">
          <div className="flex items-center gap-3">
            <Button
              variant={micActive ? "destructive" : "default"}
              size="sm"
              onClick={toggleMic}
              className="gap-1.5"
            >
              {micActive ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              {micActive ? "Mute" : "Unmute"}
            </Button>
            <div className="flex-1" />
            {micActive && (
              <span className="text-xs theme-text-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Listening...
              </span>
            )}
            {modelSpeaking && !micActive && (
              <span className="text-xs theme-text-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                Gemini is speaking...
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={disconnect}
              className="gap-1.5 text-red-500 hover:text-red-600"
            >
              <PhoneOff className="h-4 w-4" />
              End
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Audio helpers ---

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const length = buffer.byteLength / 2;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

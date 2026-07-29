/**
 * Microphone capture + PCM16 playback for the Grok Voice Agent.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  float32ToPCM16Base64,
  base64PCM16ToFloat32,
  nearestSupportedSampleRate,
} from "../lib/audio";

const CHUNK_DURATION_MS = 100;

export interface UseAudioStreamReturn {
  isCapturing: boolean;
  audioLevel: number;
  sampleRate: number;
  /** Start mic capture. Returns the sample rate that will be used for the session. */
  startCapture: (onAudioData: (base64Audio: string) => void) => Promise<number>;
  stopCapture: () => void;
  stopPlayback: () => void;
  playAudio: (base64Audio: string) => void;
}

export function useAudioStream(): UseAudioStreamReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [sampleRate, setSampleRate] = useState(24000);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const currentPlaybackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const sessionSampleRateRef = useRef(24000);

  const getAudioContext = useCallback((preferredRate?: number) => {
    if (!audioContextRef.current) {
      const opts = preferredRate ? { sampleRate: preferredRate } : undefined;
      try {
        audioContextRef.current = new AudioContext(opts);
      } catch {
        // Some browsers reject explicit sampleRate — fall back to native
        audioContextRef.current = new AudioContext();
      }
      const native = audioContextRef.current.sampleRate;
      const rate = nearestSupportedSampleRate(native);
      sessionSampleRateRef.current = rate;
      setSampleRate(rate);
    }
    return audioContextRef.current;
  }, []);

  const playNextChunk = useCallback((audioContext: AudioContext) => {
    if (playbackQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      currentPlaybackSourceRef.current = null;
      return;
    }

    const chunk = playbackQueueRef.current.shift()!;
    const rate = sessionSampleRateRef.current || audioContext.sampleRate;
    const audioBuffer = audioContext.createBuffer(1, chunk.length, rate);
    audioBuffer.getChannelData(0).set(chunk);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    currentPlaybackSourceRef.current = source;

    source.onended = () => {
      if (currentPlaybackSourceRef.current === source) {
        currentPlaybackSourceRef.current = null;
      }
      playNextChunk(audioContext);
    };

    source.start();
  }, []);

  const startCapture = useCallback(
    async (onAudioData: (base64Audio: string) => void): Promise<number> => {
      // Prefer 24 kHz — API default and lowest bandwidth for high quality
      const audioContext = getAudioContext(24000);
      const rate = nearestSupportedSampleRate(audioContext.sampleRate);
      sessionSampleRateRef.current = rate;
      setSampleRate(rate);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

      let audioBuffer: Float32Array[] = [];
      let totalSamples = 0;
      const chunkSizeSamples = Math.floor((rate * CHUNK_DURATION_MS) / 1000);

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        setAudioLevel(Math.sqrt(sum / inputData.length));

        // Resample if browser context rate ≠ session rate (rare but possible)
        let samples = new Float32Array(inputData);
        if (audioContext.sampleRate !== rate) {
          samples = downsample(inputData, audioContext.sampleRate, rate);
        }

        audioBuffer.push(samples);
        totalSamples += samples.length;

        while (totalSamples >= chunkSizeSamples) {
          const chunk = new Float32Array(chunkSizeSamples);
          let offset = 0;

          while (offset < chunkSizeSamples && audioBuffer.length > 0) {
            const buf = audioBuffer[0];
            const needed = chunkSizeSamples - offset;
            if (buf.length <= needed) {
              chunk.set(buf, offset);
              offset += buf.length;
              totalSamples -= buf.length;
              audioBuffer.shift();
            } else {
              chunk.set(buf.subarray(0, needed), offset);
              audioBuffer[0] = buf.subarray(needed);
              offset += needed;
              totalSamples -= needed;
            }
          }

          onAudioData(float32ToPCM16Base64(chunk));
        }
      };

      processorNodeRef.current = processor;
      source.connect(processor);
      // Keep processor alive without feeding speakers (avoids mic feedback)
      const mute = audioContext.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(audioContext.destination);

      setIsCapturing(true);
      return rate;
    },
    [getAudioContext]
  );

  const stopCapture = useCallback(() => {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setIsCapturing(false);
    setAudioLevel(0);
  }, []);

  const stopPlayback = useCallback(() => {
    if (currentPlaybackSourceRef.current) {
      try {
        currentPlaybackSourceRef.current.stop();
        currentPlaybackSourceRef.current.disconnect();
      } catch {
        // already stopped
      }
      currentPlaybackSourceRef.current = null;
    }
    playbackQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  const playAudio = useCallback(
    (base64Audio: string) => {
      try {
        const audioContext = getAudioContext();
        if (audioContext.state === "suspended") {
          void audioContext.resume();
        }
        const float32Data = base64PCM16ToFloat32(base64Audio);
        playbackQueueRef.current.push(float32Data);
        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          playNextChunk(audioContext);
        }
      } catch (err) {
        console.error("[voice] playAudio error:", err);
      }
    },
    [getAudioContext, playNextChunk]
  );

  useEffect(() => {
    return () => {
      stopCapture();
      stopPlayback();
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stopCapture, stopPlayback]);

  return {
    isCapturing,
    audioLevel,
    sampleRate,
    startCapture,
    stopCapture,
    stopPlayback,
    playAudio,
  };
}

/** Simple linear-interpolation downsampler. */
function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return new Float32Array(input);
  const ratio = fromRate / toRate;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = src - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

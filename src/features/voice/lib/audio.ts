/**
 * PCM16 ↔ Float32 helpers for the Grok Speech-to-Speech WebSocket API.
 */

/** Convert Float32 samples (−1…1) to base64-encoded little-endian PCM16. */
export function float32ToPCM16Base64(float32Array: Float32Array): string {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return arrayBufferToBase64(pcm16.buffer);
}

/** Convert base64 little-endian PCM16 to Float32 samples (−1…1). */
export function base64PCM16ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Ensure even length for Int16 view
  const evenLen = bytes.length - (bytes.length % 2);
  const pcm16 = new Int16Array(bytes.buffer, bytes.byteOffset, evenLen / 2);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunk to avoid call-stack limits on large buffers
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Sample rates accepted by the xAI Speech-to-Speech API. */
export const SUPPORTED_SAMPLE_RATES = [
  8000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const;

/** Pick the closest supported rate to the browser's native sample rate. */
export function nearestSupportedSampleRate(native: number): number {
  let best: number = SUPPORTED_SAMPLE_RATES[0];
  let bestDiff = Math.abs(native - best);
  for (const rate of SUPPORTED_SAMPLE_RATES) {
    const diff = Math.abs(native - rate);
    if (diff < bestDiff) {
      best = rate;
      bestDiff = diff;
    }
  }
  return best;
}

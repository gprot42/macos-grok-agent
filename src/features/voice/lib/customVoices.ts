/** Types and helpers for xAI Custom Voices (voice cloning). */

export interface CustomVoice {
  voice_id: string;
  name?: string | null;
  description?: string | null;
  gender?: string | null;
  accent?: string | null;
  age?: string | null;
  language?: string | null;
  use_case?: string | null;
  tone?: string | null;
  created_at?: string | null;
}

export interface CustomVoiceListResponse {
  voices: CustomVoice[];
  pagination_token?: string | null;
}

export const CUSTOM_VOICE_GENDERS = [
  { value: "", label: "—" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "neutral", label: "Neutral" },
] as const;

export const CUSTOM_VOICE_TONES = [
  { value: "", label: "—" },
  { value: "warm", label: "Warm" },
  { value: "casual", label: "Casual" },
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "authoritative", label: "Authoritative" },
  { value: "expressive", label: "Expressive" },
  { value: "calm", label: "Calm" },
] as const;

export const CUSTOM_VOICE_USE_CASES = [
  { value: "", label: "—" },
  { value: "conversational", label: "Conversational" },
  { value: "narration", label: "Narration" },
  { value: "characters", label: "Characters" },
  { value: "educational", label: "Educational" },
  { value: "advertisement", label: "Advertisement" },
  { value: "social_media", label: "Social media" },
  { value: "entertainment", label: "Entertainment" },
] as const;

/** Official region gate from xAI Custom Voices docs. */
export const CUSTOM_VOICES_REGION_NOTE =
  "Custom Voices is currently only available in the United States (excluding Illinois). Europe and other regions are not supported yet.";

/**
 * Auth / team scoping — custom voices only work with credentials for the
 * xAI team that owns them (console clone team ≠ SuperGrok OAuth is common).
 */
export const CUSTOM_VOICES_AUTH_NOTE =
  "Custom voices are scoped to the xAI team that created them. SuperGrok OAuth often cannot list or speak console-cloned voices (TTS 404: voice not found). Use Settings → API key from the same console team (e.g. where you cloned Daz), then Refresh. Built-in voices still work with SuperGrok.";

export function displayVoiceName(v: CustomVoice): string {
  const name = v.name?.trim();
  if (name) return name;
  return v.voice_id;
}

/** Normalize list/create API payloads (snake_case or camelCase). */
export function normalizeCustomVoice(raw: unknown): CustomVoice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const voice_id = String(o.voice_id ?? o.voiceId ?? "").trim();
  if (!voice_id) return null;
  const str = (k: string, camel?: string) => {
    const v = o[k] ?? (camel ? o[camel] : undefined);
    return typeof v === "string" ? v : v == null ? null : String(v);
  };
  return {
    voice_id,
    name: str("name"),
    description: str("description"),
    gender: str("gender"),
    accent: str("accent"),
    age: str("age"),
    language: str("language"),
    use_case: str("use_case", "useCase"),
    tone: str("tone"),
    created_at: str("created_at", "createdAt"),
  };
}

export function normalizeCustomVoiceList(raw: unknown): CustomVoice[] {
  if (Array.isArray(raw)) {
    return raw
      .map(normalizeCustomVoice)
      .filter((v): v is CustomVoice => v != null);
  }
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  // Common shapes: { voices }, { data }, { data: { voices } }, { items }, { custom_voices }
  const nested =
    o.voices ??
    o.items ??
    o.custom_voices ??
    o.customVoices ??
    (o.data && typeof o.data === "object" && !Array.isArray(o.data)
      ? (o.data as Record<string, unknown>).voices ??
        (o.data as Record<string, unknown>).items
      : o.data);
  const arr = Array.isArray(nested) ? nested : [];
  return arr
    .map(normalizeCustomVoice)
    .filter((v): v is CustomVoice => v != null);
}

const CACHE_KEY = "grok-agent.custom-voices.v1";

/** Persist known custom voices so they survive reloads / empty API lists. */
export function loadCachedCustomVoices(): CustomVoice[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    return normalizeCustomVoiceList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveCachedCustomVoices(voices: CustomVoice[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(voices.slice(0, 50)));
  } catch {
    /* quota / private mode */
  }
}

/** Merge by voice_id; prefer entries that have a display name. */
export function mergeCustomVoices(...lists: CustomVoice[][]): CustomVoice[] {
  const map = new Map<string, CustomVoice>();
  for (const list of lists) {
    for (const v of list) {
      if (!v.voice_id) continue;
      const prev = map.get(v.voice_id);
      if (!prev) {
        map.set(v.voice_id, v);
        continue;
      }
      const preferNew =
        (!!v.name?.trim() && !prev.name?.trim()) ||
        (!!v.name?.trim() && !!prev.name?.trim() && v.name !== prev.name);
      map.set(v.voice_id, preferNew ? { ...prev, ...v } : { ...v, ...prev });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    displayVoiceName(a).localeCompare(displayVoiceName(b))
  );
}

/** Read a File or Blob as raw base64 (no data: prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read audio file"));
    reader.readAsDataURL(blob);
  });
}

export function pickRecorderMimeType(): { mimeType: string; extension: string } {
  const candidates = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  if (typeof MediaRecorder === "undefined") {
    return { mimeType: "audio/webm", extension: "webm" };
  }
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", extension: "webm" };
}

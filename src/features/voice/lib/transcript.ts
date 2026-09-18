/** Pure helpers for Grok Voice Transcribe results: segmenting, speaker turns, SRT export. */

export interface SttWord {
  text: string;
  start: number;
  end: number;
  speaker?: number | string;
}

export interface Segment {
  start: number;
  end: number;
  speaker?: number | string;
  text: string;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rem = ms % 1000;
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(rem, 3)}`;
}

export function speakerLabel(speaker: number | string | undefined): string {
  if (speaker === undefined || speaker === null) return "";
  return typeof speaker === "number" ? `Speaker ${speaker + 1}` : `Speaker ${speaker}`;
}

/**
 * Group word-level timestamps into readable segments: break on speaker change,
 * sentence-ending punctuation, a pause over 1s, or ~14 words (subtitle-sized).
 */
export function buildSegments(words: SttWord[]): Segment[] {
  const segments: Segment[] = [];
  let current: SttWord[] = [];
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      speaker: current[0].speaker,
      text: current.map((w) => w.text).join(" ").replace(/\s+([,.!?;:])/g, "$1").trim(),
    });
    current = [];
  };
  for (const w of words) {
    const last = current[current.length - 1];
    if (last && (w.speaker !== last.speaker || w.start - last.end > 1)) flush();
    current.push(w);
    if (/[.!?…]["')\]]?$/.test(w.text) || current.length >= 14) flush();
  }
  flush();
  return segments;
}

/** Merge consecutive same-speaker segments into speaker turns for the plain-text export. */
export function speakerTranscript(segments: Segment[]): string {
  const turns: { speaker: string; text: string }[] = [];
  for (const seg of segments) {
    const label = speakerLabel(seg.speaker);
    const last = turns[turns.length - 1];
    if (last && last.speaker === label) last.text += ` ${seg.text}`;
    else turns.push({ speaker: label, text: seg.text });
  }
  return turns.map((t) => (t.speaker ? `${t.speaker}: ${t.text}` : t.text)).join("\n\n");
}

export function toSrt(segments: Segment[]): string {
  return segments
    .map((seg, i) => {
      const label = speakerLabel(seg.speaker);
      return `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${label ? `${label}: ` : ""}${seg.text}\n`;
    })
    .join("\n");
}

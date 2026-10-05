/**
 * Frame pinning for Grok Imagine Video 1.5: first frame, last frame, loop,
 * mid-clip keyframes and reference images.
 *
 * API rules (docs.x.ai, reference-to-video → First & Last frame / Keyframes):
 * - `image` pins the first frame; `last_frame` pins the last one.
 * - `keyframes`: at most 4 `{image, timestamp_s}` entries, each strictly inside
 *   the clip (0 < t < duration), snapped to a 1/3-second grid; two keyframes
 *   that land in the same slot are rejected.
 * - All of the above may be combined with `reference_images`.
 * - `last_frame` and `keyframes` are `grok-imagine-video-1.5` only.
 */

export type FrameRole = "auto" | "first" | "keyframe" | "last" | "loop" | "reference";

/** Roles a user can pick, in the order grok.com lists them. */
export const FRAME_ROLE_OPTIONS: { value: FrameRole; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Only image → first frame; otherwise a reference" },
  { value: "first", label: "First frame", hint: "Image starts the video" },
  { value: "keyframe", label: "Keyframe", hint: "Image appears at a chosen moment" },
  { value: "last", label: "Last frame", hint: "Image ends the video" },
  { value: "loop", label: "Loop", hint: "Image starts and ends the video" },
  { value: "reference", label: "Reference", hint: "Image guides the video (identity / style)" },
];

export const MAX_KEYFRAMES = 4;
/** Keyframe anchors snap to thirds of a second. */
const SLOTS_PER_SECOND = 3;

export interface PlannableImage {
  role: FrameRole;
  /** Seconds into the clip — keyframes only. */
  timestampS?: number;
}

export interface FramePlan<T> {
  first: T | null;
  last: T | null;
  keyframes: { image: T; timestampS: number }[];
  references: T[];
  /** Effective role of each input image, index-aligned (auto resolved). */
  resolvedRoles: Exclude<FrameRole, "auto">[];
  /** True when `last_frame` or `keyframes` are used (Video 1.5 only, single clip). */
  usesPins: boolean;
  /** True when the request needs Video 1.5 (pins, or a pinned first frame plus references). */
  requiresVideo15: boolean;
  /** Human-readable problems; the request must not be sent while non-empty. */
  errors: string[];
}

export function snapToGrid(seconds: number): number {
  return Math.round(seconds * SLOTS_PER_SECOND) / SLOTS_PER_SECOND;
}

export function formatTimestamp(seconds: number): string {
  return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
}

/** Smallest and largest valid keyframe time for a clip of `durationS` seconds. */
export function keyframeBounds(durationS: number): { min: number; max: number } {
  const step = 1 / SLOTS_PER_SECOND;
  return { min: step, max: Math.max(step, snapToGrid(durationS - step)) };
}

/**
 * A free keyframe time near the middle of the clip, avoiding slots already
 * taken by `taken` (seconds).
 */
export function suggestKeyframeTime(durationS: number, taken: number[]): number {
  const { min, max } = keyframeBounds(durationS);
  const used = new Set(taken.map((t) => Math.round(t * SLOTS_PER_SECOND)));
  const mid = snapToGrid(durationS / 2);
  for (let offset = 0; offset <= durationS * SLOTS_PER_SECOND; offset++) {
    for (const sign of [1, -1]) {
      const t = snapToGrid(mid + (sign * offset) / SLOTS_PER_SECOND);
      if (t >= min && t <= max && !used.has(Math.round(t * SLOTS_PER_SECOND))) return t;
    }
  }
  return mid;
}

export function planFrames<T extends PlannableImage>(
  images: T[],
  durationS: number,
  maxClipS = 15,
): FramePlan<T> {
  const errors: string[] = [];
  let first: T | null = null;
  let last: T | null = null;
  const keyframes: { image: T; timestampS: number }[] = [];
  const references: T[] = [];
  const resolvedRoles: Exclude<FrameRole, "auto">[] = [];

  const explicitPin = images.some((i) => i.role === "first" || i.role === "last" || i.role === "loop" || i.role === "keyframe");

  images.forEach((img, index) => {
    const n = index + 1;
    // "Auto" keeps the original behaviour: a single image is the first frame,
    // otherwise images are references.
    const role: Exclude<FrameRole, "auto"> =
      img.role !== "auto" ? img.role : images.length === 1 && !explicitPin ? "first" : "reference";
    resolvedRoles.push(role);

    if (role === "first" || role === "loop") {
      if (first) errors.push(`Image ${n}: only one image can start the video.`);
      else first = img;
    }
    if (role === "last" || role === "loop") {
      if (last) errors.push(`Image ${n}: only one image can end the video.`);
      else last = img;
    }
    if (role === "keyframe") {
      const t = snapToGrid(img.timestampS ?? durationS / 2);
      if (!(t > 0 && t < Math.min(durationS, maxClipS))) {
        errors.push(
          `Image ${n}: keyframe at ${formatTimestamp(t)} must be inside the clip (between 0s and ${Math.min(durationS, maxClipS)}s).`,
        );
      }
      keyframes.push({ image: img, timestampS: t });
    }
    if (role === "reference") references.push(img);
  });

  if (keyframes.length > MAX_KEYFRAMES) {
    errors.push(`At most ${MAX_KEYFRAMES} keyframes per video (you have ${keyframes.length}).`);
  }
  const slots = new Map<number, number>();
  for (const k of keyframes) {
    const slot = Math.round(k.timestampS * SLOTS_PER_SECOND);
    slots.set(slot, (slots.get(slot) ?? 0) + 1);
  }
  for (const [slot, count] of slots) {
    if (count > 1) {
      errors.push(
        `Two keyframes land on ${formatTimestamp(slot / SLOTS_PER_SECOND)} — keep them at least 1/3s apart.`,
      );
    }
  }
  keyframes.sort((a, b) => a.timestampS - b.timestampS);

  const usesPins = last !== null || keyframes.length > 0;
  if (usesPins && durationS > maxClipS) {
    errors.push(
      `Last frame and keyframes pin a single clip — pick ${maxClipS}s or less (longer videos are built by extending, which can't honour an end frame).`,
    );
  }

  return {
    first,
    last,
    keyframes,
    references,
    resolvedRoles,
    usesPins,
    requiresVideo15: usesPins || (first !== null && references.length > 0),
    errors,
  };
}

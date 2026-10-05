import { describe, expect, it } from "vitest";
import { keyframeBounds, planFrames, snapToGrid, suggestKeyframeTime, type FrameRole } from "../frames";

const img = (role: FrameRole, timestampS?: number) => ({ role, timestampS });

describe("planFrames", () => {
  it("keeps the old behaviour for Auto: one image is the first frame", () => {
    const p = planFrames([img("auto")], 10);
    expect(p.resolvedRoles).toEqual(["first"]);
    expect(p.first).not.toBeNull();
    expect(p.usesPins).toBe(false);
    expect(p.requiresVideo15).toBe(false);
    expect(p.errors).toEqual([]);
  });

  it("keeps the old behaviour for Auto: several images are references", () => {
    const p = planFrames([img("auto"), img("auto")], 10);
    expect(p.resolvedRoles).toEqual(["reference", "reference"]);
    expect(p.references).toHaveLength(2);
    expect(p.first).toBeNull();
  });

  it("builds first → keyframe → last and sorts keyframes", () => {
    const p = planFrames(
      [img("first"), img("keyframe", 9), img("keyframe", 3), img("last")],
      15,
    );
    expect(p.errors).toEqual([]);
    expect(p.first).not.toBeNull();
    expect(p.last).not.toBeNull();
    expect(p.keyframes.map((k) => k.timestampS)).toEqual([3, 9]);
    expect(p.usesPins).toBe(true);
    expect(p.requiresVideo15).toBe(true);
  });

  it("Loop pins the same image as first and last", () => {
    const loop = img("loop");
    const p = planFrames([loop], 6);
    expect(p.first).toBe(loop);
    expect(p.last).toBe(loop);
    expect(p.errors).toEqual([]);
  });

  it("snaps keyframes to the 1/3 s grid", () => {
    expect(snapToGrid(7.3)).toBeCloseTo(7.333, 3);
    const p = planFrames([img("keyframe", 7.3)], 15);
    expect(p.keyframes[0].timestampS).toBeCloseTo(22 / 3, 6);
  });

  it("rejects keyframes outside the clip, too many keyframes and shared slots", () => {
    expect(planFrames([img("keyframe", 10)], 10).errors[0]).toMatch(/inside the clip/);
    expect(planFrames([img("keyframe", 0)], 10).errors[0]).toMatch(/inside the clip/);
    const five = [1, 2, 3, 4, 5].map((t) => img("keyframe", t));
    expect(planFrames(five, 10).errors.join(" ")).toMatch(/At most 4 keyframes/);
    expect(planFrames([img("keyframe", 2.0), img("keyframe", 2.1)], 10).errors.join(" ")).toMatch(
      /1\/3s apart/,
    );
  });

  it("rejects two start or two end images, and Loop alongside a first frame", () => {
    expect(planFrames([img("first"), img("first")], 10).errors[0]).toMatch(/start the video/);
    expect(planFrames([img("last"), img("last")], 10).errors[0]).toMatch(/end the video/);
    expect(planFrames([img("loop"), img("first")], 10).errors[0]).toMatch(/start the video/);
  });

  it("refuses pins on videos longer than one clip", () => {
    const p = planFrames([img("first"), img("last")], 30);
    expect(p.errors.join(" ")).toMatch(/single clip/);
    // A first frame alone still works with extension chaining.
    expect(planFrames([img("first")], 30).errors).toEqual([]);
  });

  it("needs Video 1.5 for a pinned first frame plus references", () => {
    const p = planFrames([img("first"), img("reference")], 10);
    expect(p.usesPins).toBe(false);
    expect(p.requiresVideo15).toBe(true);
  });
});

describe("keyframe helpers", () => {
  it("bounds keep keyframes strictly inside the clip", () => {
    const b = keyframeBounds(15);
    expect(b.min).toBeCloseTo(1 / 3, 6);
    expect(b.max).toBeCloseTo(44 / 3, 6);
  });

  it("suggests a free slot near the middle", () => {
    expect(suggestKeyframeTime(10, [])).toBe(5);
    const next = suggestKeyframeTime(10, [5]);
    expect(Math.abs(next - 5)).toBeCloseTo(1 / 3, 6);
  });
});

import { describe, it, expect } from "vitest";
import { cn } from "../utils";

describe("cn (classname merge util)", () => {
  it("returns a single class unchanged", () => {
    expect(cn("foo")).toBe("foo");
  });

  it("merges multiple classes", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("ignores falsy values", () => {
    expect(cn("foo", false && "bar", null, undefined, "baz")).toBe("foo baz");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ "font-bold": true, "text-sm": false })).toBe("font-bold");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });

  it("handles an array of classes", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });
});

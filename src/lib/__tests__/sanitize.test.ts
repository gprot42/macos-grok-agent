import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeText } from "../sanitize";

describe("sanitizeHtml", () => {
  it("passes through safe HTML unchanged", () => {
    const safe = "<p>Hello <strong>world</strong></p>";
    const result = sanitizeHtml(safe);
    expect(result).toContain("Hello");
    expect(result).toContain("<strong>world</strong>");
  });

  it("strips script tags (XSS prevention)", () => {
    const xss = '<script>alert("xss")</script><p>Safe</p>';
    const result = sanitizeHtml(xss);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Safe");
  });

  it("strips onerror attributes", () => {
    const xss = '<img src="x" onerror="alert(1)">';
    const result = sanitizeHtml(xss);
    expect(result).not.toContain("onerror");
  });

  it("strips javascript: href values", () => {
    const xss = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(xss);
    expect(result).not.toContain("javascript:");
  });

  it("allows code blocks through", () => {
    const code = "<pre><code>const x = 1;</code></pre>";
    expect(sanitizeHtml(code)).toContain("<code>");
  });
});

describe("sanitizeText", () => {
  it("strips all HTML tags", () => {
    const html = "<p>Hello <b>world</b></p>";
    const result = sanitizeText(html);
    expect(result).not.toContain("<");
    expect(result).toContain("Hello");
    expect(result).toContain("world");
  });

  it("strips script tags completely", () => {
    const xss = '<script>evil()</script>Plain text';
    const result = sanitizeText(xss);
    expect(result).not.toContain("evil");
    expect(result).toContain("Plain text");
  });
});

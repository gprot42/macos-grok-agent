import DOMPurify from "dompurify";

/**
 * Sanitize an HTML string to prevent XSS.
 * Use this whenever rendering AI-generated or user-supplied content via
 * `dangerouslySetInnerHTML`.
 *
 * @example
 * <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(aiMarkdownRendered) }} />
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "p", "br", "b", "i", "em", "strong", "code", "pre",
      "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6",
      "a", "hr", "table", "thead", "tbody", "tr", "th", "td",
      "span", "div", "img",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "class", "id"],
    // Force external links to open in a new tab safely
    FORCE_BODY: false,
    // Strip data: URIs in href attributes
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitize to plain text — strips all HTML tags.
 * Use for contexts where no markup should be rendered.
 */
export function sanitizeText(dirty: string): string {
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/**
 * Hook all newly-created anchor tags to open in a new tab with `noopener`.
 * Call once at app startup (in main.tsx).
 */
export function hookDOMPurifyLinks(): void {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

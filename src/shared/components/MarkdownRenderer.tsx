import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const components: Components = {
  // Tables
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="theme-surface">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y theme-border">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="border-b theme-border">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold theme-border border theme-text whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 theme-border border theme-text">
      {children}
    </td>
  ),
  // Headings
  h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 theme-text">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-2 theme-text">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1.5 theme-text">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 theme-text">{children}</h4>,
  // Paragraphs
  p: ({ children }) => <p className="mb-2 last:mb-0 theme-text leading-relaxed">{children}</p>,
  // Lists
  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-2 space-y-0.5 theme-text">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-2 space-y-0.5 theme-text">{children}</ol>,
  li: ({ children }) => <li className="theme-text">{children}</li>,
  // Inline code
  code: ({ children, className }) => {
    // Block code (inside pre) gets className like "language-js"
    const isBlock = !!className;
    if (isBlock) {
      return (
        <code className="text-xs font-mono theme-text">
          {children}
        </code>
      );
    }
    return (
      <code className="px-1 py-0.5 rounded text-xs font-mono theme-surface theme-text">
        {children}
      </code>
    );
  },
  // Code blocks
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded-lg overflow-x-auto theme-surface text-xs font-mono leading-relaxed whitespace-pre theme-text">
      {children}
    </pre>
  ),
  // Bold / italic
  strong: ({ children }) => <strong className="font-semibold theme-text">{children}</strong>,
  em: ({ children }) => <em className="italic theme-text">{children}</em>,
  // Links
  a: ({ href, children }) => (
    <button
      onClick={() =>
        href &&
        import("@tauri-apps/plugin-shell")
          .then(({ open }) => open(href))
          .catch(console.error)
      }
      className="text-blue-500 hover:underline break-all cursor-pointer"
      style={{ color: "var(--accent)" }}
      title={href}
    >
      {children}
    </button>
  ),
  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 theme-border pl-3 my-2 italic theme-text-muted">
      {children}
    </blockquote>
  ),
  // Horizontal rule
  hr: () => <hr className="my-3 theme-border" />,
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

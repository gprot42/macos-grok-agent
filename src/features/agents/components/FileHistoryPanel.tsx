import { useState } from "react";
import { X, Clock, ChevronDown, ChevronRight, FileText } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileVersion {
  content: string;
  timestamp: number;
  iteration: number;
  operation: "write" | "edit";
}

export type FileHistory = Map<string, FileVersion[]>;

interface FileHistoryPanelProps {
  history: FileHistory;
  onClose: () => void;
}

// ── Simple line-diff ──────────────────────────────────────────────────────────

type DiffLine = { type: "same" | "add" | "remove"; text: string };

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Trace back
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "same", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "remove", text: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

// Collapse long runs of unchanged lines (keep 3 context lines around changes)
function collapseContext(lines: DiffLine[], context = 3): Array<DiffLine | { type: "ellipsis"; count: number }> {
  const result: Array<DiffLine | { type: "ellipsis"; count: number }> = [];
  let sameRun: DiffLine[] = [];

  const flush = () => {
    if (sameRun.length > context * 2 + 1) {
      result.push(...sameRun.slice(0, context));
      result.push({ type: "ellipsis", count: sameRun.length - context * 2 });
      result.push(...sameRun.slice(sameRun.length - context));
    } else {
      result.push(...sameRun);
    }
    sameRun = [];
  };

  for (const line of lines) {
    if (line.type === "same") {
      sameRun.push(line);
    } else {
      flush();
      result.push(line);
    }
  }
  flush();
  return result;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rawDiff = computeLineDiff(oldText, newText);
  const diff = collapseContext(rawDiff);

  const adds = rawDiff.filter((l) => l.type === "add").length;
  const removes = rawDiff.filter((l) => l.type === "remove").length;

  return (
    <div className="rounded-lg overflow-hidden border theme-border text-xs font-mono">
      <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 flex gap-3 text-xs">
        <span className="text-green-600 dark:text-green-400">+{adds}</span>
        <span className="text-red-500 dark:text-red-400">−{removes}</span>
      </div>
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        {diff.map((line, i) => {
          if ("count" in line) {
            return (
              <div key={i} className="px-3 py-0.5 text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/30 select-none">
                ···  {line.count} unchanged lines  ···
              </div>
            );
          }
          const bg =
            line.type === "add"
              ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300"
              : line.type === "remove"
              ? "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300"
              : "theme-text";
          const prefix = line.type === "add" ? "+" : line.type === "remove" ? "−" : " ";
          return (
            <div key={i} className={`flex px-2 py-px whitespace-pre ${bg}`}>
              <span className="select-none w-4 shrink-0 opacity-60">{prefix}</span>
              <span className="flex-1">{line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FileEntry({ filePath, versions }: { filePath: string; versions: FileVersion[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number>(versions.length - 1);

  const filename = filePath.split("/").pop() ?? filePath;
  const selected = versions[selectedIdx];
  const prev = selectedIdx > 0 ? versions[selectedIdx - 1] : null;

  return (
    <div className="border theme-border rounded-lg overflow-hidden mb-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 theme-text-muted" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 theme-text-muted" />}
        <FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />
        <span className="text-sm font-medium theme-text truncate flex-1" title={filePath}>{filename}</span>
        <span className="text-xs theme-text-muted">{versions.length} version{versions.length !== 1 ? "s" : ""}</span>
      </button>

      {expanded && (
        <div className="border-t theme-border p-3 space-y-3">
          {/* Version selector */}
          <div className="flex gap-1 flex-wrap">
            {versions.map((v, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedIdx(idx)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  idx === selectedIdx
                    ? "bg-blue-500 text-white border-blue-500"
                    : "theme-surface theme-border theme-text-muted hover:border-blue-400"
                }`}
                title={new Date(v.timestamp).toLocaleString()}
              >
                v{idx + 1}
                <span className="ml-1 opacity-70">iter {v.iteration + 1}</span>
              </button>
            ))}
          </div>

          {/* Metadata */}
          <div className="text-xs theme-text-muted flex gap-3">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(selected.timestamp).toLocaleTimeString()}
            </span>
            <span className={selected.operation === "write" ? "text-blue-500" : "text-amber-500"}>
              {selected.operation === "write" ? "write_file" : "edit_file"}
            </span>
            <span>{selected.content.split("\n").length} lines</span>
          </div>

          {/* Diff or full content */}
          {prev ? (
            <>
              <div className="text-xs font-medium theme-text-muted">
                Changes from v{selectedIdx} → v{selectedIdx + 1}
              </div>
              <DiffView oldText={prev.content} newText={selected.content} />
            </>
          ) : (
            <>
              <div className="text-xs font-medium theme-text-muted">Initial version (full content)</div>
              <pre className="rounded-lg border theme-border bg-gray-50 dark:bg-gray-900/30 p-2 text-xs font-mono overflow-auto max-h-64 theme-text whitespace-pre-wrap">
                {selected.content}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function FileHistoryPanel({ history, onClose }: FileHistoryPanelProps) {
  const entries = Array.from(history.entries()).sort(([, a], [, b]) => {
    const latestA = a[a.length - 1]?.timestamp ?? 0;
    const latestB = b[b.length - 1]?.timestamp ?? 0;
    return latestB - latestA;
  });

  return (
    <div className="flex flex-col h-full border-l theme-border">
      <div className="flex items-center justify-between px-4 py-3 border-b theme-border theme-surface">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-indigo-500" />
          <span className="font-semibold text-sm theme-text">File History</span>
          {entries.length > 0 && (
            <span className="text-xs theme-text-muted">({entries.length} file{entries.length !== 1 ? "s" : ""})</span>
          )}
        </div>
        <button onClick={onClose} className="theme-text-muted hover:theme-text transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full theme-text-muted text-center gap-2 py-8">
            <FileText className="h-10 w-10 opacity-20" />
            <p className="text-sm">No file changes yet.</p>
            <p className="text-xs opacity-70">Files written or edited by the agent will appear here with diff history.</p>
          </div>
        ) : (
          entries.map(([filePath, versions]) => (
            <FileEntry key={filePath} filePath={filePath} versions={versions} />
          ))
        )}
      </div>
    </div>
  );
}

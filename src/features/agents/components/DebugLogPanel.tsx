import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { X, Trash2 } from "lucide-react";

interface LogEntry {
  id: number;
  time: string;
  msg: string;
  iteration?: number;
}

let _seq = 0;

interface DebugLogPanelProps {
  onClose: () => void;
}

export function DebugLogPanel({ onClose }: DebugLogPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const MAX = 300;

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<{ msg: string; iteration?: number }>("coding-agent-debug", (e) => {
      const entry: LogEntry = {
        id: _seq++,
        time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        msg: e.payload.msg,
        iteration: e.payload.iteration,
      };
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > MAX ? next.slice(next.length - MAX) : next;
      });
    }).then((u) => (unlistenFn = u));

    return () => { unlistenFn?.(); };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  return (
    <div className="flex flex-col h-full border-l theme-border bg-gray-50 dark:bg-[#1a1b26] text-sm font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b theme-border bg-white dark:bg-[#24283b] flex-shrink-0">
        <span className="font-bold text-sm text-gray-800 dark:text-[#c0caf5]">
          Debug Log
          <span className="ml-2 text-gray-400 dark:text-[#9aa5ce] font-normal text-xs">
            ({entries.length})
          </span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEntries([])}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#414868]/40 text-gray-500 dark:text-[#9aa5ce] hover:dark:text-[#c0caf5]"
            title="Clear logs"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#414868]/40 text-gray-500 dark:text-[#9aa5ce] hover:dark:text-[#c0caf5]"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin">
        {entries.length === 0 && (
          <p className="text-gray-400 dark:text-[#9aa5ce] py-4 text-center text-sm">
            No debug logs yet — run an agent task to see output here.
          </p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="flex gap-2 leading-relaxed">
            <span className="text-gray-400 dark:text-[#414868] flex-shrink-0 select-none text-xs pt-0.5">
              {e.time}
            </span>
            {e.iteration !== undefined && (
              <span className="text-amber-600 dark:text-[#e0af68] font-bold flex-shrink-0">
                [{e.iteration}]
              </span>
            )}
            <span className="text-gray-800 dark:text-[#c0caf5] break-all">{e.msg}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

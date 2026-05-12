import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Plug, X, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { McpServerConfig, McpServerStatus } from "@shared/types";

interface McpPanelProps {
  onClose?: () => void;
}

export function McpPanel({ onClose }: McpPanelProps = {}) {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [savedConfigs, setSavedConfigs] = useState<McpServerConfig[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const [live, configs] = await Promise.all([
        invoke<McpServerStatus[]>("mcp_list_servers"),
        invoke<McpServerConfig[]>("mcp_load_configs"),
      ]);
      setServers(live);
      setSavedConfigs(configs);
    } catch (e) {
      setError(String(e));
    }
  };

  const connect = async (config: McpServerConfig) => {
    setConnecting(config.name);
    setError(null);
    try {
      await invoke("mcp_connect", { config });
      await loadState();
    } catch (e) {
      setError(`Failed to connect '${config.name}': ${e}`);
    } finally {
      setConnecting(null);
    }
  };

  const disconnect = async (name: string) => {
    try {
      await invoke("mcp_disconnect", { name });
      await loadState();
    } catch (e) {
      setError(String(e));
    }
  };

  const addConfig = async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    const cfg: McpServerConfig = {
      name: newName.trim(),
      command: newCommand.trim(),
      args: newArgs.split(" ").map((a) => a.trim()).filter(Boolean),
    };
    const next = [...savedConfigs.filter((c) => c.name !== cfg.name), cfg];
    await invoke("mcp_save_configs", { configs: next });
    setSavedConfigs(next);
    setNewName("");
    setNewCommand("");
    setNewArgs("");
    setShowAdd(false);
    // Auto-connect
    await connect(cfg);
  };

  const removeConfig = async (name: string) => {
    await disconnect(name).catch(() => {});
    const next = savedConfigs.filter((c) => c.name !== name);
    await invoke("mcp_save_configs", { configs: next });
    setSavedConfigs(next);
    await loadState();
  };

  const isConnected = (name: string) => servers.some((s) => s.config.name === name);
  const serverFor = (name: string) => servers.find((s) => s.config.name === name);
  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  // Merge saved configs (may not be connected yet) with live servers
  const allConfigs = [
    ...savedConfigs,
    ...servers
      .filter((s) => !savedConfigs.some((c) => c.name === s.config.name))
      .map((s) => s.config),
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-[#1a1b26] text-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b theme-border bg-white dark:bg-[#24283b] flex-shrink-0">
        <span className="font-bold text-sm text-gray-800 dark:text-[#c0caf5]">MCP Servers</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Server
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-[#414868]/40 text-gray-500 dark:text-[#9aa5ce] hover:dark:text-[#c0caf5] transition-colors"
              title="Close MCP panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Add server form */}
      {showAdd && (
        <div className="px-4 py-3 border-b theme-border bg-blue-50 dark:bg-blue-900/10 space-y-2">
          <p className="text-sm font-semibold text-blue-700 dark:text-[#7aa2f7]">New MCP Server</p>
          <input
            placeholder="Name (e.g. filesystem)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full text-sm px-2 py-1.5 rounded border border-gray-300 dark:border-[#414868] bg-white dark:bg-[#24283b] text-gray-900 dark:text-[#c0caf5] placeholder:text-gray-400 dark:placeholder:text-[#9aa5ce] outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-[#7aa2f7]"
          />
          <input
            placeholder="Command (e.g. npx)"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            className="w-full text-sm px-2 py-1.5 rounded border border-gray-300 dark:border-[#414868] bg-white dark:bg-[#24283b] text-gray-900 dark:text-[#c0caf5] placeholder:text-gray-400 dark:placeholder:text-[#9aa5ce] outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-[#7aa2f7]"
          />
          <input
            placeholder="Args space-separated (e.g. @modelcontextprotocol/server-filesystem /path)"
            value={newArgs}
            onChange={(e) => setNewArgs(e.target.value)}
            className="w-full text-sm px-2 py-1.5 rounded border border-gray-300 dark:border-[#414868] bg-white dark:bg-[#24283b] text-gray-900 dark:text-[#c0caf5] placeholder:text-gray-400 dark:placeholder:text-[#9aa5ce] outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-[#7aa2f7]"
          />
          <div className="flex gap-2">
            <button
              onClick={addConfig}
              disabled={!newName.trim() || !newCommand.trim()}
              className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              Add & Connect
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-xs px-3 py-1.5 rounded border theme-border theme-text hover:bg-gray-100 dark:hover:bg-tokyo-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 px-3 py-2 text-xs rounded bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Server list */}
      <div className="flex-1 overflow-y-auto divide-y theme-border">
        {allConfigs.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-3xl mb-3">🔌</p>
            <p className="font-semibold mb-1 text-gray-800 dark:text-[#c0caf5] text-sm">No MCP servers configured</p>
            <p className="text-gray-500 dark:text-[#9aa5ce] text-sm">Add a server to give the agent access to tools like filesystem, git, web search, and more.</p>
            <p className="mt-3 text-indigo-600 dark:text-[#7aa2f7] text-xs font-mono">
              npx @modelcontextprotocol/server-filesystem /Users/you
            </p>
          </div>
        )}

        {allConfigs.map((cfg) => {
          const connected = isConnected(cfg.name);
          const status = serverFor(cfg.name);
          const isExpanded = expanded.has(cfg.name);
          const isConnecting = connecting === cfg.name;

          return (
            <div key={cfg.name} className="px-4 py-3">
              <div className="flex items-center gap-2">
                {/* Expand toggle */}
                <button
                  onClick={() => connected && toggleExpand(cfg.name)}
                  className="flex-shrink-0 theme-text-muted"
                  disabled={!connected}
                >
                  {connected && status?.tools.length ? (
                    isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <span className="inline-block w-3.5" />
                  )}
                </button>

                {/* Status dot */}
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    connected ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                />

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-800 dark:text-[#c0caf5] truncate">{cfg.name}</div>
                  <div className="text-xs text-gray-500 dark:text-[#9aa5ce] font-mono truncate">
                    {cfg.command} {cfg.args.join(" ")}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!connected ? (
                    <button
                      onClick={() => connect(cfg)}
                      disabled={isConnecting}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50"
                    >
                      {isConnecting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plug className="h-3 w-3" />
                      )}
                      Connect
                    </button>
                  ) : (
                    <button
                      onClick={() => disconnect(cfg.name)}
                      className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-tokyo-border theme-text-muted hover:bg-gray-100 dark:hover:bg-tokyo-hover"
                    >
                      Disconnect
                    </button>
                  )}
                  <button
                    onClick={() => removeConfig(cfg.name)}
                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 dark:text-tokyo-muted hover:text-red-500"
                    title="Remove server"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Tool list when connected and expanded */}
              {connected && isExpanded && status && status.tools.length > 0 && (
                <div className="mt-2 ml-6 space-y-1.5">
                  {status.tools.map((tool) => (
                    <div key={tool.name} className="flex gap-2">
                      <span className="text-green-700 dark:text-[#9ece6a] font-mono font-bold text-sm flex-shrink-0">
                        {tool.name}
                      </span>
                      <span className="text-gray-500 dark:text-[#9aa5ce] text-sm truncate">{tool.description ?? ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

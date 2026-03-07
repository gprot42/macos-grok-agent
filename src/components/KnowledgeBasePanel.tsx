import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database, Upload, Trash2, Search, Plus, FileText,
  Loader2, AlertCircle, ChevronDown, ChevronRight,
  Send, RefreshCw,
} from "lucide-react";

interface Store {
  name: string;
  displayName: string;
  createTime?: string;
}

interface StoreFile {
  name: string;
  displayName: string;
  state?: string;
}

interface KnowledgeBasePanelProps {
  apiKey: string;
}

export function KnowledgeBasePanel({ apiKey }: KnowledgeBasePanelProps) {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [files, setFiles] = useState<StoreFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newStoreName, setNewStoreName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const loadStores = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Record<string, unknown>>("rag_list_stores", { apiKey });
      const list = (result.fileSearchStores as Store[]) || [];
      setStores(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  const loadFiles = useCallback(async (store: Store) => {
    if (!apiKey) return;
    try {
      const result = await invoke<Record<string, unknown>>("rag_list_files", {
        apiKey,
        storeName: store.name,
      });
      setFiles((result.fileSearchStoreFiles as StoreFile[]) || []);
    } catch {
      setFiles([]);
    }
  }, [apiKey]);

  const handleCreateStore = async () => {
    if (!newStoreName.trim() || !apiKey) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("rag_create_store", { apiKey, displayName: newStoreName.trim() });
      setNewStoreName("");
      await loadStores();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStore = async (store: Store) => {
    if (!confirm(`Delete store "${store.displayName}"? All files in it will be removed.`)) return;
    setError(null);
    try {
      await invoke("rag_delete_store", { apiKey, storeName: store.name });
      if (selectedStore?.name === store.name) {
        setSelectedStore(null);
        setFiles([]);
      }
      await loadStores();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedStore) return;
    setUploading(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      await invoke("rag_upload_file", {
        apiKey,
        storeName: selectedStore.name,
        fileData: base64,
        mimeType: file.type || "application/octet-stream",
        displayName: file.name,
      });
      await loadFiles(selectedStore);
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleQuery = async () => {
    if (!query.trim() || !selectedStore) return;
    setQuerying(true);
    setError(null);
    setQueryResult(null);
    try {
      const result = await invoke<{ text: string }>("rag_query", {
        apiKey,
        storeNames: [selectedStore.name],
        query: query.trim(),
        model: "",
      });
      setQueryResult(result.text);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) {
      setError(String(e));
    } finally {
      setQuerying(false);
    }
  };

  const toggleStore = async (store: Store) => {
    if (expandedStore === store.name) {
      setExpandedStore(null);
      setSelectedStore(null);
      setFiles([]);
    } else {
      setExpandedStore(store.name);
      setSelectedStore(store);
      await loadFiles(store);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-xs underline">dismiss</button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={newStoreName}
            onChange={(e) => setNewStoreName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateStore()}
            placeholder="New knowledge base name..."
            className="flex-1 px-3 py-2 rounded-lg border theme-border theme-surface theme-text text-sm"
          />
          <button
            onClick={handleCreateStore}
            disabled={!newStoreName.trim() || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create
          </button>
          <button
            onClick={loadStores}
            disabled={loading}
            className="p-2 rounded-lg border theme-border theme-surface hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Refresh stores"
          >
            <RefreshCw className={`h-4 w-4 theme-text-muted ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading && stores.length === 0 ? (
          <div className="flex items-center justify-center py-12 theme-text-muted">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading knowledge bases...
          </div>
        ) : stores.length === 0 ? (
          <div className="text-center py-12 theme-text-muted">
            <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No knowledge bases yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stores.map((store) => (
              <div key={store.name} className="border theme-border rounded-lg overflow-hidden">
                <div
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                    expandedStore === store.name
                      ? "theme-surface-elevated"
                      : "theme-surface hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  }`}
                  onClick={() => toggleStore(store)}
                >
                  {expandedStore === store.name ? (
                    <ChevronDown className="h-4 w-4 theme-text-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 theme-text-muted" />
                  )}
                  <Database className="h-4 w-4 text-blue-500" />
                  <span className="flex-1 font-medium theme-text text-sm">{store.displayName}</span>
                  <span className="text-xs theme-text-muted font-mono">{store.name}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteStore(store); }}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-colors"
                    title="Delete store"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {expandedStore === store.name && (
                  <div className="border-t theme-border px-4 py-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleUploadFile}
                        className="hidden"
                        accept=".pdf,.txt,.md,.csv,.json,.xml,.html,.py,.js,.ts,.java,.c,.cpp,.go,.rs"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-border text-sm theme-text hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                      >
                        {uploading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        {uploading ? "Uploading..." : "Upload File"}
                      </button>
                      <span className="text-xs theme-text-muted">
                        PDF, text, code, CSV, JSON, XML, HTML
                      </span>
                    </div>

                    {files.length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-xs font-medium theme-text-muted uppercase tracking-wider mb-2">
                          Files ({files.length})
                        </div>
                        {files.map((f) => (
                          <div key={f.name} className="flex items-center gap-2 px-3 py-1.5 rounded theme-surface text-sm">
                            <FileText className="h-3.5 w-3.5 theme-text-muted" />
                            <span className="flex-1 theme-text">{f.displayName || f.name}</span>
                            {f.state && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                f.state === "ACTIVE" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              }`}>
                                {f.state}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm theme-text-muted text-center py-3">
                        No files uploaded yet
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {queryResult && (
          <div ref={resultRef} className="border theme-border rounded-lg p-4 theme-surface">
            <div className="text-xs font-medium theme-text-muted uppercase tracking-wider mb-2">
              <Search className="h-3.5 w-3.5 inline mr-1" />
              Result
            </div>
            <div className="theme-text text-sm whitespace-pre-wrap">{queryResult}</div>
          </div>
        )}
      </div>

      {selectedStore && (
        <div className="border-t theme-border p-4 theme-surface">
          <div className="flex items-center gap-2">
            <div className="text-xs theme-text-muted flex items-center gap-1">
              <Database className="h-3 w-3" />
              {selectedStore.displayName}
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleQuery()}
              placeholder="Ask a question about your documents..."
              className="flex-1 px-3 py-2 rounded-lg border theme-border theme-surface theme-text text-sm"
              disabled={querying}
            />
            <button
              onClick={handleQuery}
              disabled={querying || !query.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {querying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

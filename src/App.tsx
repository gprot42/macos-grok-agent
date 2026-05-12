import { useState, useEffect, useRef } from "react";
import {
  Header,
  ModelSelector,
  ChatPanel,
  ImageGenerator,
  SettingsPanel,
  ProjectsPanel,
  CodingAgentPanel,
  GrokVoicePanel,
  GrokVideoPanel,
} from "./components";
import { useSettings, useChat, useSubAgent } from "./hooks";
import { MODELS } from "@shared/constants/models";
import { EndpointType, ThemeMode, ChatSession } from "@shared/types";
import { ErrorBoundary } from "@shared/components/ErrorBoundary";
import { ToastContainer, useToast } from "@shared/components/Toast";
import { useAppStore } from "./store/appStore";

function ApiKeyPrompt({
  onSave,
  onSkip,
}: {
  onSave: (key: string) => void;
  onSkip: () => void;
}) {
  const [key, setKey] = useState("");

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-tokyo-surface rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <div className="text-center space-y-1">
          <div className="text-3xl">🔑</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-tokyo-text">
            Enter your xAI API Key
          </h2>
          <p className="text-sm text-gray-500 dark:text-tokyo-muted">
            An API key is required to use Grok Agent. Get yours at{" "}
            <button
              onClick={() =>
                import("@tauri-apps/plugin-shell").then(({ open }) =>
                  open("https://console.x.ai")
                )
              }
              className="text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              console.x.ai
            </button>
            . Your key is encrypted and stored locally.
          </p>
        </div>

        <input
          type="password"
          placeholder="xai-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && key.trim()) onSave(key.trim());
          }}
          autoFocus
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-tokyo-border bg-white dark:bg-tokyo-bg text-gray-900 dark:text-tokyo-text text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <div className="flex gap-2">
          <button
            onClick={() => { if (key.trim()) onSave(key.trim()); }}
            disabled={!key.trim()}
            className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save & Continue
          </button>
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-tokyo-border text-gray-600 dark:text-tokyo-muted text-sm hover:bg-gray-50 dark:hover:bg-tokyo-hover transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { settings, updateSettings, loading } = useSettings();
  const {
    messages,
    sessions,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    error,
    generatedImages,
    imageCosts,
    lastTokenUsage,
    lastRawJson,
    totalTokens,
    sendMessage,
    generateImage,
    clearMessages,
    createSession,
    deleteSession,
    renameSession,
    stopGeneration,
    deleteImage,
    clearImages: _clearImages,
    exportSession,
    importSession,
  } = useChat();

  const { toasts, dismiss, toast } = useToast();
  const { reviews, isReviewing, runReview } = useSubAgent();

  // ── Zustand store (replaces 12 useState calls) ───────────────────────────────
  const {
    activeTab, setActiveTab,
    showSettings, setShowSettings,
    showProjects, setShowProjects,
    showAbout, setShowAbout,
    showApiKeyPrompt, setShowApiKeyPrompt,
    selectedModel,
    selectedImageModel,
    selectedEndpoint,
    use1MContext,
    useMemory,
    useGrounding,
    useSearch,
    thinkingLevel,
    customUrl,
    activeProject, setActiveProject,
  } = useAppStore();

  // Show API key prompt once settings have loaded and no key is configured
  useEffect(() => {
    if (!loading && !settings.xaiKey && !settings.openrouterKey && !settings.apiKey) {
      setShowApiKeyPrompt(true);
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface chat errors as toasts
  useEffect(() => {
    if (error) toast(error, "error", 6000);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger sub-agent review when a response finishes loading
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant?.content) {
        runReview(typeof lastAssistant.content === "string" ? lastAssistant.content : JSON.stringify(lastAssistant.content));
      }
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply custom colors as CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (settings.customColors?.accentColor) root.style.setProperty("--accent", settings.customColors.accentColor);
    else root.style.removeProperty("--accent");
    if (settings.customColors?.userMessageBg) root.style.setProperty("--user-message-bg", settings.customColors.userMessageBg);
    else root.style.removeProperty("--user-message-bg");
    if (settings.customColors?.assistantMessageBg) root.style.setProperty("--assistant-message-bg", settings.customColors.assistantMessageBg);
    else root.style.removeProperty("--assistant-message-bg");
  }, [settings.customColors]);

  // Sync saved activeProject from settings into store
  useEffect(() => {
    if (settings.activeProject) setActiveProject(settings.activeProject);
  }, [settings.activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "t") {
        e.preventDefault();
        createSession();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        if (sessions.length > 1) {
          deleteSession(activeSessionId);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const modelSelect = document.querySelector('select, button[role="combobox"]') as HTMLElement;
        if (modelSelect) modelSelect.focus();
      }
      // Shortcut for export (Item 3)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        exportSession().then(() => toast("Session exported", "success")).catch(() => toast("Export failed", "error"));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [createSession, deleteSession, activeSessionId, sessions.length, exportSession]);

  const handleThemeChange = (theme: ThemeMode) => {
    updateSettings({ theme });
  };

  const getApiKeyForEndpoint = (endpoint: EndpointType): string => {
    switch (endpoint) {
      case "openrouter":
        return settings.openrouterKey || settings.apiKey;
      case "xai":
        return settings.xaiKey || settings.apiKey;
      case "kilocode":
        return settings.kilocodeKey || settings.apiKey;
      case "custom":
        return settings.customPassword || settings.apiKey;
      default:
        return settings.apiKey;
    }
  };

  const handleSelectProject = (name: string | null) => {
    setActiveProject(name);
    updateSettings({ activeProject: name || undefined });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center theme-bg">
        <div className="theme-text-muted">Loading...</div>
      </div>
    );
  }

  // Guard: persisted model ID may no longer exist after a model was removed/renamed
  const currentModel = MODELS[selectedModel] ?? Object.values(MODELS).find(
    (m) => m.endpointSupport.includes(selectedEndpoint) &&
           !m.supportsImageGeneration && !m.supportsVideoGeneration && !m.supportsTextToSpeech
  );

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col theme-bg overflow-hidden">
        <Header
          theme={settings.theme}
          onThemeChange={handleThemeChange}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onShowSettings={() => setShowSettings(true)}
          onShowProjects={() => setShowProjects(true)}
          onShowAbout={() => setShowAbout(true)}
          activeProject={activeProject}
          subAgentStatus={isReviewing ? "Reviewing..." : reviews.length > 0 ? "Optimized" : "Idle"}
        />

        <div className="theme-surface border-b theme-border px-6 py-3">
          {activeTab === "chat" ? (
            <>
              <ModelSelector />
            </>
          ) : activeTab === "image" ? (
            <div className="flex items-center gap-4">
              <span className="text-2xl">🎨</span>
              <div>
                <div className="text-lg font-medium theme-text">Grok Imagine</div>
                <div className="text-sm theme-text italic">
                  {MODELS[selectedImageModel]?.description}
                </div>
              </div>
            </div>
          ) : activeTab === "video" ? (
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎬</span>
              <div>
                <div className="text-lg font-medium theme-text">Grok Video</div>
                <div className="text-sm theme-text">Generate videos from text prompts</div>
              </div>
            </div>
          ) : activeTab === "voice" ? (
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎤</span>
              <div>
                <div className="text-lg font-medium theme-text">Grok Voice</div>
                <div className="text-sm theme-text">Generate natural speech from text</div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-2xl">🖥️</span>
              <div>
                <div className="text-lg font-medium theme-text">Grok Coding Agent</div>
                <div className="text-sm theme-text">Build & ship code with Grok — reads your repo, writes files, runs commands, self-corrects with sub-agent review</div>
              </div>
            </div>
          )}
        </div>

        <main className="flex-1 overflow-hidden flex flex-col">
          {/* Chat — always mounted to preserve session history */}
          <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${activeTab === "chat" ? "" : "hidden"}`}>
            <SessionTabs
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={setActiveSessionId}
              onCreateSession={createSession}
              onDeleteSession={deleteSession}
              onRenameSession={renameSession}
              onExport={exportSession}
              onImport={importSession}
            />
            <ChatPanel
              messages={messages}
              isLoading={isLoading}
              error={error}
              model={currentModel}
              endpoint={selectedEndpoint}
              apiKey={getApiKeyForEndpoint(selectedEndpoint)}
              projectId={settings.projectId}
              use1MContext={use1MContext}
              useMemory={useMemory}
              useGrounding={useGrounding}
              useSearch={useSearch}
              thinkingLevel={thinkingLevel}
              includeThoughts={true}
              activeProject={activeProject}
              lastTokenUsage={lastTokenUsage}
              totalTokens={totalTokens}
              lastRawJson={lastRawJson}
              customUrl={customUrl}
              customLogin={settings.customLogin}
              customPassword={settings.customPassword}
              showCosts={settings.showCosts ?? true}
              onSendMessage={sendMessage}
              onClearMessages={clearMessages}
              onStopGeneration={stopGeneration}
            />
          </div>

          {/* Image — always mounted to preserve generated images */}
          <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${activeTab === "image" ? "" : "hidden"}`}>
            <ImageGenerator
              apiKey={settings.xaiKey || settings.apiKey}
              onGenerateImage={generateImage}
              generatedImages={generatedImages}
              imageCosts={imageCosts}
              isLoading={isLoading}
              error={error}
              activeProject={activeProject}
              onDeleteImage={deleteImage}
              onClearImages={_clearImages}
              imageModelId={MODELS[selectedImageModel]?.modelId}
              imageModelName={MODELS[selectedImageModel]?.displayName}
              imagePerImageCost={MODELS[selectedImageModel]?.pricing?.perImage}
              altModelId={undefined}
              altModelName={undefined}
            />
          </div>

          {/* Video — always mounted to preserve generation state */}
          <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${activeTab === "video" ? "" : "hidden"}`}>
            <GrokVideoPanel apiKey={settings.xaiKey || settings.apiKey} />
          </div>

          {/* Voice — always mounted to preserve audio state */}
          <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${activeTab === "voice" ? "" : "hidden"}`}>
            <GrokVoicePanel apiKey={settings.xaiKey || settings.apiKey} />
          </div>

          {/* Code — always mounted to preserve agent conversation and working dir */}
          <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${activeTab === "code" ? "" : "hidden"}`}>
            <CodingAgentPanel
               apiKey={getApiKeyForEndpoint(selectedEndpoint)}
               projectId={settings.projectId}
               selectedModel={currentModel}
               selectedEndpoint={selectedEndpoint}
               activeProject={activeProject}
               agentTimeout={settings.agentTimeout}
               showCosts={settings.showCosts ?? true}
               blockFileDeletion={settings.blockFileDeletion ?? true}
             />
          </div>
        </main>

        {showSettings && (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}

        {showProjects && (
          <ProjectsPanel
            activeProject={activeProject}
            onSelectProject={handleSelectProject}
            onClose={() => setShowProjects(false)}
          />
        )}

        {showAbout && (
          <AboutPanel onClose={() => setShowAbout(false)} />
        )}

        {showApiKeyPrompt && (
          <ApiKeyPrompt
            onSave={(key) => {
              updateSettings({ xaiKey: key });
              setShowApiKeyPrompt(false);
            }}
            onSkip={() => setShowApiKeyPrompt(false)}
          />
        )}

        {/* Global error toast (Improvement #2) */}
        <ToastContainer toasts={toasts} onDismiss={dismiss} />
      </div>
    </ErrorBoundary>
  );
}

// ... (SessionTabs, AboutPanel, AboutLink remain the same but with added export button in tabs)
function SessionTabs({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onExport,
  onImport,
}: {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onExport?: (id?: string) => void;
  onImport?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleRightClick = (e: React.MouseEvent, session: ChatSession) => {
    e.preventDefault();
    setEditingId(session.id);
    setEditName(session.name);
  };

  const handleRenameSubmit = (id: string) => {
    if (editName.trim()) {
      onRenameSession(id, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex items-center gap-1 px-4 py-2 theme-surface border-b theme-border overflow-x-auto">
      {sessions.map((session) => (
        <div
          key={session.id}
          className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${activeSessionId === session.id
            ? "theme-accent-bg text-white"
            : "theme-hover theme-text"
            }`}
          onClick={() => onSelectSession(session.id)}
          onContextMenu={(e) => handleRightClick(e, session)}
        >
          {editingId === session.id ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => handleRenameSubmit(session.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSubmit(session.id);
                if (e.key === "Escape") setEditingId(null);
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="w-24 px-1 py-0 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white border rounded outline-none"
            />
          ) : (
            <span className="truncate max-w-[100px]">{session.name}</span>
          )}
          {sessions.length > 1 && editingId !== session.id && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteSession(session.id);
              }}
              className={`opacity-0 group-hover:opacity-100 transition-opacity ${activeSessionId === session.id ? "text-white/70 hover:text-white" : "theme-text-muted"
                }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {activeSessionId === session.id && onExport && (
            <button
              onClick={(e) => { e.stopPropagation(); onExport(session.id); }}
              className="opacity-60 hover:opacity-100 text-xs px-1.5 py-0.5 rounded hover:bg-white/20"
              title="Export session (Ctrl+E)"
            >
              ↓
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onCreateSession}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm theme-text-muted theme-hover transition-colors"
        title="New session (Ctrl+T)"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New
      </button>
      <button
        onClick={onImport}
        className="ml-auto text-xs px-3 py-1 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 flex items-center gap-1"
        title="Import session from JSON or Markdown"
      >
        ↑ Import
      </button>
    </div>
  );
}

function AboutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button
      onClick={() => import("@tauri-apps/plugin-shell").then(({ open }) => open(href))}
      className="text-indigo-500 dark:text-indigo-400 hover:underline"
    >
      {children}
    </button>
  );
}

function AboutPanel({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("...");
  
  useEffect(() => {
    import("@tauri-apps/api/app").then(({ getVersion }) => {
      getVersion().then(setVersion);
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-tokyo-surface rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-tokyo-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-tokyo-text">
            About Grok Agent
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-tokyo-muted dark:hover:text-tokyo-text"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-2">🧠</div>
            <h3 className="text-xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
              Grok Agent
            </h3>
            <p className="text-sm text-gray-500 dark:text-tokyo-muted mt-1">Version {version}</p>
            <p className="text-xs text-gray-400 dark:text-tokyo-muted">Built {__BUILD_DATE__}</p>
          </div>

           <div className="space-y-4">
             <div>
               <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">AI Models</h4>
                <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                   <li>• Grok 4.3 — xAI flagship, 2M context, built-in reasoning</li>
                   <li>• Grok 4.20 Reasoning / Multi-Agent / Fast — xAI (Beta)</li>
                   <li>• Grok 4.1 — xAI with deep thinking &amp; X search</li>
                   <li>• Grok Imagine / Video / Voice — image, video &amp; TTS generation</li>
                 </ul>
             </div>

             <div>
               <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Endpoints</h4>
                <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  <li>• xAI - Grok models with real-time X data</li>
                  <li>• Custom - Connect to any OpenAI-compatible API</li>
                </ul>
             </div>

             <div>
               <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Recent Improvements</h4>
               <ul className="text-sm text-emerald-600 dark:text-emerald-400 space-y-1">
                 <li>• ✅ Persistent sessions with auto-save to disk (never lose work)</li>
                 <li>• ✅ Global ErrorBoundary + retry UI + better error messages</li>
                 <li>• ✅ Session export to Markdown/JSON (Ctrl+E) and import</li>
                 <li>• Keyboard support for export</li>
                 <li>• Auto-retry on last message</li>
               </ul>
             </div>

             <div>
               <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Features</h4>
               <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                 <li>• Multiple prompt sessions with tabs (Ctrl+T new, Ctrl+W close)</li>
                 <li>• File attachments (text, images, PDFs)</li>
                 <li>• Token tracking with cost estimation</li>
                 <li>• Project management - organize outputs into folders</li>
                 <li>• Copy/Save messages with one click</li>
                 <li>• Raw JSON response viewer</li>
                 <li>• Three themes: Light, Tokyo Night, Dark</li>
                 <li>• Customizable fonts and sizes</li>
               </ul>
             </div>

             <div>
               <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Model Options</h4>
               <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                 <li>• 1M Context - Extended context window for large documents</li>
                 <li>• Memory - Claude models remember across conversations</li>
                 <li>• Deep Thinking - Extended reasoning for complex problems</li>
                 <li>• Image Generation - Create images with Grok Imagine</li>
               </ul>
             </div>

             <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
               <h4 className="font-semibold text-purple-800 dark:text-purple-200 mb-2">Deep Think</h4>
               <p className="text-sm text-purple-700 dark:text-purple-300">Extended reasoning capability available on Grok, Claude Opus, and DeepSeek R1 models. Enables chain-of-thought thinking for complex problem-solving.</p>
             </div>

            <div>
              <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Keyboard Shortcuts</h4>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                <li>• Ctrl/Cmd + Enter - Send message</li>
                <li>• Ctrl/Cmd + T - New prompt session</li>
                <li>• Ctrl/Cmd + W - Close current session</li>
                <li>• Ctrl/Cmd + K - Quick focus model selector</li>
                <li>• Ctrl/Cmd + E - Export current session</li>
              </ul>
            </div>

            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3">
              <h4 className="font-semibold text-indigo-800 dark:text-indigo-200 mb-2">Token Approximation</h4>
              <ul className="text-sm text-indigo-700 dark:text-indigo-300 space-y-1">
                <li>• 1 token ≈ 4 characters (English)</li>
                <li>• 1 token ≈ 0.75 words</li>
                <li>• 100 tokens ≈ 75 words</li>
                <li>• 1,000 tokens ≈ 750 words (1-2 pages)</li>
                <li>• 1M tokens ≈ 750,000 words (several books)</li>
              </ul>
            </div>

            {/* Costs section remains unchanged */}
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 space-y-4">
              <h4 className="font-semibold text-emerald-800 dark:text-emerald-200 text-base">💰 How Costs Work with Grok</h4>

              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                You pay xAI directly — there is no markup here. Costs are charged per token for chat,
                per image for image generation, and per minute/character for video and voice.
                Pricing is shown in US dollars per million tokens ($/M) unless noted otherwise.
              </p>

              <div>
                <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-1">Chat models (per million tokens)</h5>
                 <ul className="text-sm text-emerald-700 dark:text-emerald-300 space-y-0.5">
                   <li>• <strong>Grok 4.3</strong> — $1.25 in / $2.50 out</li>
                   <li>• <strong>Grok 4.20 Reasoning / Multi-Agent / Fast</strong> — $2.00 in / $6.00 out</li>
                   <li>• <strong>Grok 4.1</strong> — see <AboutLink href="https://x.ai/api">x.ai/api</AboutLink> for current pricing</li>
                 </ul>
              </div>

              <div>
                <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-1">Image generation (per image)</h5>
                <ul className="text-sm text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  <li>• <strong>grok-imagine-image</strong> — flat fee per image (see pricing page)</li>
                  <li>• Input images (editing) are also charged per image</li>
                </ul>
              </div>

              <div>
                <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-1">Video generation</h5>
                <ul className="text-sm text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  <li>• <strong>grok-imagine-video</strong> — $4.20 per minute of video (audio included)</li>
                  <li>• A 5 s clip ≈ $0.35 · 10 s ≈ $0.70 · 15 s (max) ≈ $1.05</li>
                </ul>
              </div>

              <div>
                <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-1">Voice / TTS</h5>
                <ul className="text-sm text-emerald-700 dark:text-emerald-300 space-y-0.5">
                  <li>• <strong>grok-tts</strong> — $4.20 per hour of audio generated (~$0.07 / min)</li>
                </ul>
              </div>

              <div className="pt-1 border-t border-emerald-200 dark:border-emerald-700 space-y-1">
                <h5 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Useful links</h5>
                <ul className="text-sm space-y-0.5">
                  <li>• <AboutLink href="https://docs.x.ai/docs/models">docs.x.ai/docs/models</AboutLink> — full model list &amp; pricing</li>
                  <li>• <AboutLink href="https://console.x.ai">console.x.ai</AboutLink> — manage API keys &amp; usage</li>
                  <li>• <AboutLink href="https://x.ai/api/imagine">x.ai/api/imagine</AboutLink> — Grok Imagine API overview</li>
                  <li>• <AboutLink href="https://docs.x.ai/docs/guides/video-generation">docs.x.ai — Video Generation</AboutLink></li>
                  <li>• <AboutLink href="https://docs.x.ai/docs/guides/image-generation">docs.x.ai — Image Generation</AboutLink></li>
                </ul>
              </div>

              <p className="text-xs text-emerald-600 dark:text-emerald-400 italic">
                Prices are indicative and may change. Always verify current rates at console.x.ai before production use.
              </p>
            </div>
          </div>

          <div className="text-center text-xs text-gray-400 dark:text-tokyo-muted pt-4 border-t border-gray-200 dark:border-tokyo-border">
            Built with Tauri, React, Rust, and Bun. Sessions now persist automatically. API keys are encrypted locally.
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

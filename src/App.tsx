import { useState, useEffect } from "react";
import {
  Header,
  ModelSelector,
  ChatPanel,
  ImageGenerator,
  SettingsPanel,
  ProjectsPanel,
  DeepResearchPanel,
  ResearchSessionTabs,
} from "./components";
import { useSettings, useChat } from "./hooks";
import { useResearchSessions } from "./hooks/useResearchSessions";
import { MODELS } from "./models";
import { EndpointType, ThemeMode, ChatSession } from "./types";

function App() {
  const { settings, updateSettings, saveApiKey, loading } = useSettings();
  const {
    messages,
    sessions,
    activeSessionId,
    setActiveSessionId,
    isLoading,
    error,
    generatedImages,
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
  } = useChat();

  const researchSessions = useResearchSessions();

  const [activeTab, setActiveTab] = useState<"chat" | "image" | "research">("chat");
  const [showSettings, setShowSettings] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [selectedModel, setSelectedModel] = useState("claude-opus-4-6");
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointType>("vertex_ai");
  const [use1MContext, setUse1MContext] = useState(false);
  const [useMemory, setUseMemory] = useState(false);
  const [useGrounding, setUseGrounding] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState("high");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");

  useEffect(() => {
    const model = MODELS[selectedModel];
    if (model && !model.endpointSupport.includes(selectedEndpoint)) {
      const firstAvailable = Object.values(MODELS).find((m) =>
        m.endpointSupport.includes(selectedEndpoint)
      );
      if (firstAvailable) {
        setSelectedModel(firstAvailable.id);
      }
    }
  }, [selectedEndpoint, selectedModel]);

  useEffect(() => {
    const model = MODELS[selectedModel];
    if (model?.defaultGrounding) {
      setUseGrounding(true);
    }
  }, [selectedModel]);

  // Apply custom colors as CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (settings.customColors?.accentColor) {
      root.style.setProperty('--accent', settings.customColors.accentColor);
    } else {
      root.style.removeProperty('--accent');
    }
    if (settings.customColors?.userMessageBg) {
      root.style.setProperty('--user-message-bg', settings.customColors.userMessageBg);
    } else {
      root.style.removeProperty('--user-message-bg');
    }
    if (settings.customColors?.assistantMessageBg) {
      root.style.setProperty('--assistant-message-bg', settings.customColors.assistantMessageBg);
    } else {
      root.style.removeProperty('--assistant-message-bg');
    }
  }, [settings.customColors]);

  useEffect(() => {
    if (settings.activeProject) {
      setActiveProject(settings.activeProject);
    }
  }, [settings.activeProject]);

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
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [createSession, deleteSession, activeSessionId, sessions.length]);

  const handleThemeChange = (theme: ThemeMode) => {
    updateSettings({ theme });
  };

  const getApiKeyForEndpoint = (endpoint: EndpointType): string => {
    switch (endpoint) {
      case "ai_studio":
        return settings.aiStudioKey || settings.apiKey;
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

  const handleEndpointChange = (endpoint: EndpointType) => {
    setSelectedEndpoint(endpoint);
    if (endpoint === "ai_studio") {
      setUseGrounding(false);
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

  const currentModel = MODELS[selectedModel];

  return (
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
      />

      <div className="theme-surface border-b theme-border px-6 py-3">
        {activeTab === "chat" ? (
          <ModelSelector
            selectedModel={selectedModel}
            selectedEndpoint={selectedEndpoint}
            use1MContext={use1MContext}
            useMemory={useMemory}
            useGrounding={useGrounding}
            thinkingLevel={thinkingLevel}
            customUrl={customUrl}
            customLogin={settings.customLogin || ""}
            customPassword={settings.customPassword || ""}
            onModelChange={setSelectedModel}
            onEndpointChange={handleEndpointChange}
            onUse1MContextChange={setUse1MContext}
            onUseMemoryChange={setUseMemory}
            onUseGroundingChange={setUseGrounding}
            onThinkingLevelChange={setThinkingLevel}
            onCustomUrlChange={setCustomUrl}
            onCustomLoginChange={(login) => updateSettings({ customLogin: login })}
            onCustomPasswordChange={(password) => updateSettings({ customPassword: password })}
          />
        ) : activeTab === "image" ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl">🍌</span>
            <div>
              <div className="font-medium theme-text">Nano Banana Pro</div>
              <div className="text-xs theme-text-muted">Gemini 3 Pro Image - AI image generation and editing</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔬</span>
            <div>
              <div className="text-lg font-medium theme-text">Gemini Deep Research</div>
              <div className="text-sm theme-text-muted">Multi-step web research agent with source synthesis</div>
            </div>
          </div>
        )}
      </div>

      <main className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "chat" ? (
          <>
            <SessionTabs
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={setActiveSessionId}
              onCreateSession={createSession}
              onDeleteSession={deleteSession}
              onRenameSession={renameSession}
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
              thinkingLevel={thinkingLevel}
              includeThoughts={true}
              activeProject={activeProject}
              lastTokenUsage={lastTokenUsage}
              totalTokens={totalTokens}
              lastRawJson={lastRawJson}
              customUrl={customUrl}
              customLogin={settings.customLogin}
              customPassword={settings.customPassword}
              onSendMessage={sendMessage}
              onClearMessages={clearMessages}
              onStopGeneration={stopGeneration}
            />
          </>
        ) : activeTab === "image" ? (
          <ImageGenerator
            apiKey={settings.aiStudioKey || settings.apiKey}
            onGenerateImage={generateImage}
            generatedImages={generatedImages}
            isLoading={isLoading}
            error={error}
            activeProject={activeProject}
            onDeleteImage={deleteImage}
          />
        ) : (
          <>
            <ResearchSessionTabs
              sessions={researchSessions.sessions}
              activeSessionId={researchSessions.activeSessionId}
              onSelectSession={researchSessions.setActiveSessionId}
              onCreateSession={researchSessions.createSession}
              onDeleteSession={researchSessions.deleteSession}
              onRenameSession={researchSessions.renameSession}
            />
            <DeepResearchPanel
              apiKey={settings.aiStudioKey || settings.apiKey}
              activeProject={activeProject}
              research={researchSessions}
            />
          </>
        )}
      </main>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdateSettings={updateSettings}
          onSaveApiKey={saveApiKey}
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
    </div>
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
            About Cortex Agent
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
              Cortex Agent
            </h3>
            <p className="text-sm text-gray-500 dark:text-tokyo-muted mt-1">Version {version}</p>
            <p className="text-xs text-gray-400 dark:text-tokyo-muted">Built {__BUILD_DATE__}</p>
          </div>

          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">AI Models</h4>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                <li>• Claude 4 Opus, Sonnet, Haiku - Anthropic's latest models</li>
                <li>• Gemini 2.5/3 Pro/Flash - Google's multimodal AI</li>
                <li>• Gemini 3 Pro Deep Think - Extended reasoning (AI Studio)</li>
                <li>• Grok 4.1/3/3 Fast/3 Mini - xAI's real-time models</li>
                <li>• GPT-4o, Llama 405B, DeepSeek R1 - via OpenRouter</li>
                <li>• Nano Banana Pro - Image generation and editing</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Endpoints</h4>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                <li>• Vertex AI - Google Cloud enterprise endpoint</li>
                <li>• AI Studio - Google's free API endpoint</li>
                <li>• OpenRouter - Access 100+ models with one API key</li>
                <li>• xAI - Grok models with real-time X data</li>
                <li>• Kilo Code - Coding-optimized model access</li>
                <li>• Custom - Connect to any OpenAI-compatible API</li>
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
                <li>• Grounding - Web search for up-to-date information</li>
                <li>• Deep Thinking - Extended reasoning for complex problems</li>
              </ul>
            </div>

            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
              <h4 className="font-semibold text-purple-800 dark:text-purple-200 mb-2">Deep Think vs Deep Research</h4>
              <ul className="text-sm text-purple-700 dark:text-purple-300 space-y-2">
                <li><strong>🧠 Deep Think</strong> - A model capability that enables extended internal reasoning before responding. Available on Gemini 3 Pro Deep Think, DeepSeek R1, and Grok models. Uses chain-of-thought to solve complex problems. Select from Prompt tab with AI Studio endpoint.</li>
                <li><strong>🔬 Deep Research</strong> - A specialized research agent (separate tab) that performs multi-step web searches, synthesizes sources, and produces comprehensive reports. Uses Gemini 2.5 Pro with autonomous browsing. Supports file attachments for context.</li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 dark:text-tokyo-text mb-2">Keyboard Shortcuts</h4>
              <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                <li>• Ctrl/Cmd + Enter - Send message</li>
                <li>• Ctrl/Cmd + T - New prompt session</li>
                <li>• Ctrl/Cmd + W - Close current session</li>
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
          </div>

          <div className="text-center text-xs text-gray-400 dark:text-tokyo-muted pt-4 border-t border-gray-200 dark:border-tokyo-border">
            Built with Tauri, React, Rust, and Bun. API keys are encrypted locally.
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionTabs({
  sessions,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
}: {
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
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
        </div>
      ))}
      <button
        onClick={onCreateSession}
        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm theme-text-muted theme-hover transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        New
      </button>
    </div>
  );
}

export default App;

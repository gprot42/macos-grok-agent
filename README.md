# Cortex Agent

A modern desktop AI assistant for interacting with Large Language Models via **xAI Grok**, **OpenRouter**, and **Kilo Code**, built with Tauri 2, React 18, and Rust.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Tauri 2.0 (Rust) with secure IPC |
| State | Zustand (with persistence) |
| Testing | Vitest + Testing Library, Playwright (E2E) |
| Package Manager | Bun (recommended) |
| AI Integrations | xAI Grok, OpenRouter, Kilo Code |

## Features

### AI Models

- **Grok 4.x** — xAI's flagship models with 2M context, X search, and built-in reasoning
- **Grok Imagine** — Image generation and editing
- **Grok Voice** — High-quality text-to-speech synthesis
- **Grok Video** — Text-to-video generation
- **Claude 4 Opus / Sonnet / Haiku** — Anthropic's latest models (via OpenRouter or Kilo Code)
- **GPT-4o** — OpenAI's advanced model (via OpenRouter)
- **Llama 3.3 405B** — Meta's open model (via OpenRouter)
- **DeepSeek R1** — Reasoning model (via OpenRouter)
- **Custom Endpoints** — Any OpenAI-compatible API

### Capabilities

- **Multiple Endpoints**: xAI, OpenRouter, Kilo Code, Custom
- **X Search**: Real-time search on X.com (Grok models)
- **Image / Voice / Video Generation**: Grok Imagine, Voice, Video
- **File Attachments**: Text, images, PDFs with analysis
- **Token Tracking**: Real-time usage with cost estimation
- **Project Management**: Organize outputs into folders and sessions
- **Themes**: Light, Tokyo Night, Dark with customizable fonts and colors
- **Keyboard Shortcuts**: Full support documented below

### Vibe Coding Agent

- **Autonomous Coding**: Reads, writes, edits files and runs commands
- **Multi-Model Support**: Claude, Grok, and more via OpenRouter
- **Git Integration**: Push code to GitHub, init repos, commit and push
- **Working Directory Picker**: Select any output folder
- **MCP / Skills Registry**: Expandable tool registry via MCP and agent skills
- **Deep Research**: Multi-step research with sub-question decomposition

### Security & Privacy

- **Encrypted Storage**: API keys stored with AES-256-GCM at `~/.cortex-agent/`.  
  Encryption key is derived from the machine hardware UUID — device-bound, non-transferable.
- **Least-Privilege Capabilities**: Tauri capabilities control file, network, and shell access.
- **CSP**: Content Security Policy applied at the WebView level.
- **Local-First**: No data leaves your machine except for explicit AI API calls.

## Architecture

```
src/
├── App.tsx                    # Root component, tab routing
├── main.tsx                   # Entry point, DOMPurify init
├── features/                  # Feature-sliced domain modules
│   ├── agents/                # Coding agent (CodingAgentPanel, MCP, Skills)
│   ├── chat/                  # Chat UI + useChat hook
│   ├── image/                 # Image generation
│   ├── projects/              # Project manager
│   ├── settings/              # App settings + useSettings hook
│   ├── video/                 # Video generation
│   └── voice/                 # Voice / TTS
├── shared/
│   ├── components/            # Reusable UI primitives (Button, Input, Header…)
│   ├── constants/models.ts    # Model registry (canonical)
│   └── types/index.ts         # All shared TypeScript types (canonical)
├── hooks/                     # Cross-feature hooks (re-exports)
├── store/appStore.ts          # Zustand store with persistence
├── lib/
│   ├── utils.ts               # `cn()` Tailwind class merge
│   └── sanitize.ts            # DOMPurify HTML sanitization helpers
└── test/setup.ts              # Vitest global setup + Tauri mocks

src-tauri/
├── src/
│   ├── main.rs                # Tauri entry
│   ├── api.rs                 # HTTP/streaming AI API commands
│   ├── agent_chain.rs         # Multi-step agent chains
│   ├── mcp.rs                 # MCP server management
│   ├── skills.rs              # Agent skills registry
│   ├── storage.rs             # Encrypted key storage
│   └── codegen.rs             # Code generation utilities
└── capabilities/
    ├── default.json           # Core UI permissions (least-privilege)
    └── agent-tools.json       # Extended agent fs+shell permissions
```

## Quick Start

```bash
# Run development server
./start.sh

# Or manually:
bun install
bun run tauri:dev

# Build DMG (macOS)
./build-dmg.sh
```

## Development Commands

```bash
# Development
bun run dev              # Start Vite dev server only
bun run tauri:dev        # Full Tauri dev (Rust + frontend)

# Quality
bun run lint             # ESLint check
bun run lint:fix         # ESLint auto-fix
bun run format           # Prettier format all files
bun run format:check     # Check formatting without writing
bun run typecheck        # TypeScript type-check (no emit)

# Testing
bun run test             # Unit tests (vitest)
bun run test:watch       # Unit tests in watch mode
bun run test:coverage    # Unit tests with coverage report
bun run test:e2e         # Playwright E2E tests (requires dev server)

# Build
bun run build            # Production build
bun run build:analyze    # Production build + bundle visualizer (opens in browser)
bun run tauri:build      # Full Tauri DMG build
```

## Requirements

- Node.js 18+ (or Bun 1.x — recommended)
- Rust 1.75+
- Xcode Command Line Tools (macOS)
- xAI API key (for Grok models)
- Optional: OpenRouter key, Kilo Code key

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + Enter | Send message |
| Ctrl/Cmd + T | New prompt session |
| Ctrl/Cmd + W | Close current session |
| Ctrl/Cmd + Shift + I | Toggle Developer Tools |

## Contributing

1. **Structure**: Follow the feature-sliced architecture — new features go in `src/features/<name>/`.
2. **Types**: Add shared types to `src/shared/types/index.ts`. Do not add duplicate type files.
3. **Tests**: Write unit tests for new hooks, utilities, and pure logic.  
   Run `bun run test:coverage` to check coverage thresholds (≥40%).
4. **Lint + Format**: Run `bun run lint:fix && bun run format` before committing.
5. **Security**: If rendering AI-generated HTML, use `sanitizeHtml()` from `src/lib/sanitize.ts`.
6. **Docs**: Update `PLAN.md` progress section after completing a phase.

## Roadmap (from PLAN.md)

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 0 | Consolidate docs, audit deps | ✅ Done |
| Phase 1 | ESLint/Prettier, Vitest, security, barrels, sanitization | ✅ Done |
| Phase 2 | Refactor: Zod validation, modular store, observability | Planned |
| Phase 3 | Perf: virtual scroll, lazy load, streaming UI, AI polish | Planned |
| Phase 4 | CI/CD: GitHub Actions, auto releases, 70%+ coverage | Planned |
| Phase 5 | Plugin system, local models, multi-agent | Long-term |

For full details, read **[PLAN.md](./PLAN.md)**.

## License & Credits

Built for Grok and friends. Secure, local, powerful AI on your desktop.

---

**Version 0.0.16** — See [PLAN.md](./PLAN.md) for improvement roadmap

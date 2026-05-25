# Grok Agent

A desktop AI assistant for interacting with multiple Large Language Models via **xAI Grok**, **OpenRouter**, **Anthropic**, **OpenAI**, and **Kilo Code**. Built with Tauri 2, React 18, and Rust for macOS.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Radix UI |
| Backend | Tauri 2.0 (Rust) with secure IPC |
| State | Zustand 5 (with persistence), TanStack Query 5 |
| Validation | Zod 4 |
| Testing | Vitest + Testing Library, Playwright (E2E) |
| Package Manager | Bun (recommended) |
| AI Integrations | xAI Grok, OpenRouter, Anthropic, OpenAI, Kilo Code |

## Features

### AI Models

- **Grok 4.x** — xAI flagship models with 2M context, X search, and built-in reasoning
- **Grok Imagine** — Image generation and editing
- **Grok Voice** — High-quality text-to-speech synthesis
- **Grok Video** — Text-to-video generation
- **Claude 4 Opus / Sonnet / Haiku** — Anthropic's latest models (via OpenRouter or Kilo Code)
- **GPT-4o** — OpenAI's advanced model (via OpenRouter)
- **Llama 3.3 405B** — Meta's open model (via OpenRouter)
- **DeepSeek R1** — Reasoning model (via OpenRouter)
- **Custom Endpoints** — Any OpenAI-compatible API

### Capabilities

- **Multiple Endpoints**: xAI, OpenRouter, Kilo Code, Anthropic, OpenAI, Custom
- **X Search**: Real-time search on X.com via Grok models
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
- **Multi-Agent Pipeline**: Primary executor + reviewer + verifier collaboration

### Pre-defined Agent Skills

- **Code Analysis & Review** — Scans code for bugs, security issues, and performance problems
- **Test Generation** — Auto-generates Vitest/Playwright unit and integration tests
- **Documentation Generation** — Creates JSDoc, README sections, and API docs from TypeScript
- **Refactoring Suggestions** — Proposes readability and modularity improvements
- **Dependency & Security Audit** — Analyses `package.json` and `Cargo.toml` for vulnerabilities

### Security & Privacy

- **Encrypted Storage**: API keys stored with AES-256-GCM at `~/.cortex-agent/`. Encryption key derived from machine hardware UUID — device-bound, non-transferable.
- **Least-Privilege Capabilities**: Tauri capabilities control file, network, and shell access.
- **CSP**: Content Security Policy enforced at the WebView level.
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
│   ├── utils.ts               # cn() Tailwind class merge
│   └── sanitize.ts            # DOMPurify HTML sanitization helpers
└── test/setup.ts              # Vitest global setup + Tauri mocks

src-tauri/
├── src/
│   ├── main.rs                # Tauri entry point
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

### Prerequisites

- macOS 10.15 (Catalina) or later
- [Bun](https://bun.sh) 1.x (recommended) or Node.js 18+
- Rust 1.75+
- Xcode Command Line Tools

### Run

```bash
# Install dependencies and start dev server
./start.sh

# Or manually:
bun install
bun run tauri:dev
```

### Build

```bash
# Build macOS DMG
./build-dmg.sh

# Or via Tauri CLI
bun run tauri:build
```

## Development Commands

```bash
# Development
bun run dev              # Vite dev server only
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
bun run test:coverage    # Coverage report (threshold ≥40%)
bun run test:e2e         # Playwright E2E tests (requires dev server)
bun run test:e2e:ui      # Playwright with interactive UI

# Build
bun run build            # Production frontend build
bun run build:analyze    # Production build + bundle visualizer
bun run tauri:build      # Full Tauri macOS bundle (DMG + APP)
```

## API Keys

Configure keys in the Settings panel. Required and optional keys:

| Provider | Required | Notes |
|----------|----------|-------|
| xAI | Yes (for Grok models) | Get key at [x.ai](https://x.ai) |
| OpenRouter | Optional | Access Claude, GPT-4o, Llama, DeepSeek |
| Anthropic | Optional | Direct Claude API access |
| OpenAI | Optional | Direct GPT-4o access |
| Kilo Code | Optional | Kilo Code AI access |

Keys are stored encrypted on disk and never transmitted except to their respective API endpoints.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd + Enter | Send message |
| Cmd + T | New prompt session |
| Cmd + W | Close current session |
| Cmd + Shift + I | Toggle Developer Tools |

## Contributing

1. **Structure**: Follow the feature-sliced architecture — new features go in `src/features/<name>/`.
2. **Types**: Add shared types to `src/shared/types/index.ts`. Do not create duplicate type files.
3. **Tests**: Write unit tests for new hooks, utilities, and pure logic. Run `bun run test:coverage` to check coverage thresholds (≥40%).
4. **Lint + Format**: Run `bun run lint:fix && bun run format` before committing.
5. **Security**: If rendering AI-generated HTML, use `sanitizeHtml()` from `src/lib/sanitize.ts`.

## License

Secure, local, powerful AI on your desktop.

---

Version 0.0.1

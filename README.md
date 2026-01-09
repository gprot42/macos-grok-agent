# MEX - Model Explorer v0.0.1

A modern desktop application for interacting with Large Language Models on **Google Cloud Vertex AI** and **AI Studio**, built with Tauri, React, and TypeScript.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Tauri 2.0 (Rust)
- **Package Manager**: pnpm (Bun-compatible)

## Features

- **Multi-Model Support**: Claude (4.5 Haiku, Sonnet, Opus) and Gemini (2.5, 3 Pro/Flash)
- **Dual Endpoints**: Switch between Vertex AI and AI Studio
- **Nano Banana Pro**: AI image generation and editing - load images to manipulate with prompts
- **File Upload**: Attach text files, images, and PDFs with prompts
- **1M Context Window**: Available for Claude 4.5 Sonnet
- **Memory Tool**: Optional memory support for Claude 4.5 Sonnet
- **Deep Thinking**: Gemini 3 Pro Deep Think with thinking levels
- **Theme System**: Light, Tokyo Night, and Dark themes
- **Secure Storage**: Encrypted API key storage tied to machine ID

## Quick Start

```bash
# Install dependencies
pnpm install

# Run development server
pnpm tauri:dev

# Build for production
pnpm tauri:build
```

## Requirements

- Node.js 18+
- Rust 1.70+
- pnpm (or npm/yarn)
- Google Cloud credentials (for Vertex AI)
- API key (for AI Studio)

## API Key Storage

Your API key is encrypted using AES-256-GCM and stored securely at `~/.mex-model-explorer/api_key.enc`. The encryption key is derived from your machine's hardware UUID, making the stored key non-transferable between computers.

## Keyboard Shortcuts

- **Ctrl+Enter**: Send message
- **Ctrl+T**: New tab (planned)
- **Ctrl+W**: Close tab (planned)

## Disclaimer

This is not an official Google product. All pricing shown is fictional and for demonstration only.

---

**Version 0.0.1** - Tauri Edition

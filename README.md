# MEX - Model EXplorer 🚀

A powerful desktop application for interacting with Large Language Models on **Google Cloud Vertex AI** and **AI Studio**.

## Features

- **Multi-Model Support**: Claude (4.5 Haiku, 4.5 Sonnet, 4.1, 4.5 Opus) and Gemini (2.5 Pro, 2.5 Flash, 3 Pro Preview)
- **Dual Endpoints**: Switch between Vertex AI and AI Studio
- **📎 File Upload**: Attach text files, images, and PDFs with your prompts (up to 10MB)
- **1M Context Window**: Available for Claude 4.5 Sonnet
- **🧠 Memory Tool**: Optional memory support for Claude 4.5 Sonnet
- **🎨 Theme System**: Choose from Light, Tokyo Night, or Dark themes
- **💬 Chat Mode**: Multi-turn conversation history within each tab
- **Real-time Metrics**: Character and token counting with pricing estimates
- **Query Tabs**: Multiple tabs with optional synchronization
- **Response Export**: Save responses as text or JSON

## Quick Start

```bash
# Setup
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt

# Run
python src/vertex_desktop/main.py

# Build packages
./create-package.sh
```

## Requirements

- Python 3.8+
- Google Cloud credentials (for Vertex AI)
- API key (for AI Studio)
- Dependencies: PyQt6, google-auth, requests, cryptography

## API Key Storage

For **AI Studio** users: Your API key is automatically encrypted and saved to `~/.mex-model-explorer/api_key.enc` when you enter it. The key is:
- Encrypted using Fernet symmetric encryption
- Tied to your machine's hardware UUID (cannot be transferred between computers)
- Automatically loaded on application startup
- Removed when you clear the API key field

**Security Note**: While this provides reasonable protection against casual file inspection, treat your API keys as sensitive credentials.

## Keyboard Shortcuts

- **Ctrl+Enter**: Execute query
- **Ctrl+T**: New tab
- **Ctrl+W**: Close tab

## Notes

⚠️ **Disclaimer**: Pricing shown is fictional and for demonstration only. This is not an official Google product.

---

**Version 1.5.1** - Theme & UI Edition

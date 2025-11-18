#!/usr/bin/env python3

import sys
import os
import logging
import json
import requests
import time
from pathlib import Path
from datetime import datetime
from PyQt6.QtWidgets import (QApplication, QMainWindow, QVBoxLayout, QHBoxLayout,
                             QWidget, QPushButton, QTextEdit, QComboBox, QLabel,
                             QCheckBox, QMessageBox, QTabWidget, QFrame,
                             QGraphicsDropShadowEffect, QSplitter, QProgressBar,
                             QSpinBox, QToolTip, QFileDialog, QDialog, QLineEdit,
                             QDialogButtonBox, QTextBrowser, QGroupBox)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QTimer, QPropertyAnimation, QEasingCurve, pyqtProperty, QElapsedTimer
from PyQt6.QtGui import QFont, QTextCursor, QPalette, QColor, QIcon, QPixmap, QPainter, QLinearGradient
from google.auth import default
from google.auth.transport.requests import Request

# --- CONFIGURATION ---
PROJECT_ID = None  # Will be set on startup
LOCATION = os.environ.get("LOCATION", "global")
VERTEX_AI_ENDPOINT = "https://aiplatform.googleapis.com"
DEFAULT_FONT_SIZE = 14

# --- LOGGING SETUP ---
log_dir = Path.home() / ".mex-model-explorer"
log_dir.mkdir(exist_ok=True)
log_file = log_dir / "app.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()
    ]
)

# --- MODEL CONFIGURATION WITH PRICING AND 1M CONTEXT WINDOW ---
AVAILABLE_MODELS = {
    "claude-haiku-4-5": {
        "publisher": "anthropic",
        "model_id": "claude-haiku-4-5@20251001:streamRawPredict",
        "display_name": "Claude 4.5 Haiku",
        "max_input_tokens": 200000,
        "max_output_tokens": 8192,
        "icon": "⚡",
        "color": "#10B981",
        "description": "Fast and efficient with 200k input / 8k output tokens",
        "pricing": {
            "input": 0.001,
            "output": 0.005
        },
        "supports_1m_context": False,
        "supports_memory": False
    },
    "claude-3-7-sonnet": {
        "publisher": "anthropic",
        "model_id": "claude-3-7-sonnet@20250219:streamRawPredict",
        "display_name": "Claude 3.7 Sonnet",
        "max_input_tokens": 200000,
        "max_output_tokens": 64000,
        "icon": "🔷",
        "color": "#FF6B6B",
        "description": "Fast, balanced performance with 200k input / 64k output tokens",
        "pricing": {
            "input": 0.003,
            "output": 0.015
        },
        "supports_1m_context": False,
        "supports_memory": False
    },
    "claude-sonnet-4-5": {
        "publisher": "anthropic",
        "model_id": "claude-sonnet-4-5@20250929:streamRawPredict",
        "display_name": "Claude 4.5 Sonnet",
        "max_input_tokens": 200000,  # Default, can be extended to 1M
        "max_output_tokens": 64000,
        "max_input_tokens_extended": 1000000,  # 1M context window
        "icon": "🚀",
        "color": "#9333EA",
        "description": "Latest Sonnet model with enhanced capabilities (supports 1M context + memory)",
        "pricing": {
            "input": 0.003,
            "output": 0.015,
            "input_premium": 0.006,  # 2x for >200K tokens
            "output_premium": 0.0225  # 1.5x for >200K tokens
        },
        "supports_1m_context": True,
        "supports_memory": True  # Memory tool support
    },
    "claude-opus-4-1": {
        "publisher": "anthropic",
        "model_id": "claude-opus-4-1@20250805:streamRawPredict",
        "display_name": "Claude 4.1 Opus",
        "max_input_tokens": 200000,
        "max_output_tokens": 32000,
        "icon": "👑",
        "color": "#C92A2A",
        "description": "Most capable model with 200k input / 32k output tokens",
        "pricing": {
            "input": 0.015,
            "output": 0.075
        },
        "supports_1m_context": False,
        "supports_memory": False
    },
    "gemini-2-5-pro": {
        "publisher": "google",
        "model_id": "gemini-2.5-pro@default:streamGenerateContent",
        "display_name": "Gemini 2.5 Pro",
        "max_input_tokens": 1048576,
        "max_output_tokens": 65536,
        "icon": "🎯",
        "color": "#4DABF7",
        "description": "Advanced multimodal with 1M+ input / 65k output tokens",
        "pricing": {
            "input": 0.0025,
            "output": 0.01
        },
        "supports_1m_context": False,
        "supports_memory": False
    },
    "gemini-2-5-flash": {
        "publisher": "google",
        "model_id": "gemini-2.5-flash@default:streamGenerateContent",
        "display_name": "Gemini 2.5 Flash",
        "max_input_tokens": 1048576,
        "max_output_tokens": 65535,
        "icon": "⚡",
        "color": "#69DB7C",
        "description": "Fastest response with 1M+ input / 65k output tokens",
        "pricing": {
            "input": 0.00025,
            "output": 0.001
        },
        "supports_1m_context": False,
        "supports_memory": False
    },
    "gemini-3-pro": {
        "publisher": "google",
        "model_id": "gemini-3.0-pro-001@default:streamGenerateContent",
        "display_name": "Gemini 3 Pro",
        "max_input_tokens": 2097152,
        "max_output_tokens": 65536,
        "icon": "🌟",
        "color": "#4285F4",
        "description": "Next-gen multimodal model with 2M+ input / 65k output tokens",
        "pricing": {
            "input": 0.0025,
            "output": 0.01
        },
        "supports_1m_context": True,
        "supports_memory": False
    }
}

# --- THEME MANAGER ---
class ThemeManager:
    """Manages application themes (light/dark mode)"""
    def __init__(self):
        self.is_dark_mode = False
        self.light_colors = {
            "primary": "#6366F1",
            "primary_hover": "#5558E3",
            "secondary": "#10B981",
            "secondary_hover": "#059669",
            "danger": "#EF4444",
            "warning": "#F59E0B",
            "background": "#F9FAFB",
            "surface": "#FFFFFF",
            "border": "#E5E7EB",
            "text_primary": "#111827",
            "text_secondary": "#6B7280",
            "success_bg": "#D1FAE5",
            "error_bg": "#FEE2E2",
            "info_bg": "#DBEAFE",
            "disclaimer_bg": "#FEF3C7"
        }

        self.dark_colors = {
            "primary": "#818CF8",
            "primary_hover": "#A5B4FC",
            "secondary": "#34D399",
            "secondary_hover": "#6EE7B7",
            "danger": "#F87171",
            "warning": "#FCD34D",
            "background": "#111827",
            "surface": "#1F2937",
            "border": "#374151",
            "text_primary": "#F9FAFB",
            "text_secondary": "#D1D5DB",
            "success_bg": "#064E3B",
            "error_bg": "#7F1D1D",
            "info_bg": "#1E3A8A",
            "disclaimer_bg": "#78350F"
        }

        self.current_colors = self.light_colors.copy()

    def toggle_theme(self):
        """Toggle between light and dark mode"""
        self.is_dark_mode = not self.is_dark_mode
        self.current_colors = self.dark_colors.copy() if self.is_dark_mode else self.light_colors.copy()
        return self.current_colors

    def get_colors(self):
        """Get current color scheme"""
        return self.current_colors

# Global theme manager instance
theme_manager = ThemeManager()
COLORS = theme_manager.get_colors()

# Dynamic font management
class FontManager:
    """Manages application fonts with dynamic sizing"""
    def __init__(self, base_size=DEFAULT_FONT_SIZE):
        self.base_size = base_size
        self.update_fonts()

    def update_fonts(self):
        """Update all font definitions with new base size"""
        self.fonts = {
            "heading": QFont("SF Pro Display", self.base_size + 7, QFont.Weight.Bold),
            "subheading": QFont("SF Pro Display", self.base_size - 1, QFont.Weight.Medium),
            "body": QFont("SF Pro Text", self.base_size),
            "mono": QFont("SF Mono", self.base_size - 1),
            "button": QFont("SF Pro Text", self.base_size, QFont.Weight.Medium)
        }

    def set_base_size(self, size):
        """Set new base font size and update all fonts"""
        self.base_size = size
        self.update_fonts()

    def get_font(self, font_type):
        """Get a specific font type"""
        return self.fonts.get(font_type, self.fonts["body"])

# Global font manager instance
font_manager = FontManager()

class AboutDialog(QDialog):
    """About dialog with application information"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("About MEX - Model EXplorer")
        self.setModal(True)
        self.setMinimumWidth(500)
        self.setMinimumHeight(400)

        layout = QVBoxLayout()

        # Title
        title_label = QLabel("MEX - Model EXplorer")
        title_label.setFont(font_manager.get_font("heading"))
        title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title_label.setStyleSheet(f"color: {COLORS['primary']}; margin: 10px;")
        layout.addWidget(title_label)

        # Version info
        version_label = QLabel("Version 1.3.1 - Memory Support Edition")
        version_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        version_label.setStyleSheet(f"color: {COLORS['text_secondary']}; margin-bottom: 20px;")
        layout.addWidget(version_label)

        # About text
        about_text = QTextBrowser()
        about_text.setOpenExternalLinks(True)
        about_text.setHtml(f"""
        <style>
            body {{
                font-family: 'SF Pro Text', system-ui, -apple-system, sans-serif;
                font-size: {font_manager.base_size}px;
                color: {COLORS['text_primary']};
                line-height: 1.6;
            }}
            h3 {{
                color: {COLORS['primary']};
                margin-top: 15px;
                margin-bottom: 5px;
            }}
            .info {{
                background-color: {COLORS['info_bg']};
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
            }}
            .warning {{
                background-color: {COLORS['warning'] if theme_manager.is_dark_mode else '#FEF3C7'};
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
                border-left: 3px solid {COLORS['warning']};
            }}
            ul {{ margin-left: 20px; }}
        </style>

        <h3>About MEX - Model EXplorer</h3>
        <p>MEX (Model EXplorer) is a powerful desktop interface for Google Cloud's Vertex AI,
        providing easy access to multiple AI models including Claude and Gemini.</p>

        <h3>🧠 NEW: Memory Tool Support</h3>
        <div class="info">
            <p><b>Claude Sonnet 4.5 now includes memory capabilities!</b></p>
            <ul>
                <li>✅ Disabled by default - enable via checkbox</li>
                <li>🔧 Toggle memory tool in the query interface</li>
                <li>💡 AI can remember context across conversations</li>
                <li>📚 Improves responses with persistent knowledge</li>
            </ul>
        </div>

        <h3>Token & Character Counting</h3>
        <div class="info">
            <p><b>Approximations used in MEX:</b></p>
            <ul>
                <li>1 token ≈ 0.75 words</li>
                <li>1 token ≈ 4 characters</li>
                <li>100 tokens ≈ 75 words</li>
            </ul>
        </div>

        <div class="warning">
            <p><b>⚠️ Important Note:</b><br>
            The actual token count may vary slightly depending on the specific tokenizer used.
            Different models use different tokenization methods, so the character and token counts
            shown are estimates. The actual usage may differ by ±10-20%.</p>
        </div>

        <h3>Features</h3>
        <ul>
            <li>🧠 Memory tool support for Claude Sonnet 4.5 (disabled by default)</li>
            <li>Support for multiple AI models (Claude Haiku 4.5, 3.7, Sonnet 4.5, Opus 4.1, Gemini 2.5)</li>
            <li>1M token context window for Claude Sonnet 4.5</li>
            <li>📁 Create project structure from AI responses</li>
            <li>Real-time character and token counting</li>
            <li>Multiple query tabs with optional synchronization</li>
            <li>Dark/Light mode toggle</li>
            <li>Raw JSON response viewing</li>
            <li>Response export functionality</li>
            <li>Adjustable font sizes</li>
            <li>Stop query functionality</li>
            <li>Copy query to clipboard button</li>
            <li>Fictional pricing estimates</li>
        </ul>

        <h3>Memory Tool</h3>
        <div class="info">
            <p>The memory tool allows Claude to:</p>
            <ul>
                <li>Store information across conversations</li>
                <li>Learn from past interactions</li>
                <li>Build context over time</li>
                <li>Provide more personalized responses</li>
            </ul>
            <p><b>Note:</b> Memory is model-specific and conversation-scoped.</p>
        </div>

        <h3>Keyboard Shortcuts</h3>
        <ul>
            <li><b>Ctrl+Enter:</b> Execute query (when in prompt field)</li>
            <li><b>Ctrl+T:</b> New tab</li>
            <li><b>Ctrl+W:</b> Close current tab</li>
        </ul>
        """)

        about_text.setStyleSheet(f"""
            QTextBrowser {{
                border: 1px solid {COLORS['border']};
                border-radius: 4px;
                padding: 10px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
            }}
        """)
        layout.addWidget(about_text)

        # Close button
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.accept)
        close_btn.setStyleSheet(f"""
            QPushButton {{
                padding: 8px 24px;
                background-color: {COLORS['primary']};
                color: white;
                border: none;
                border-radius: 4px;
                font-size: {font_manager.base_size}px;
                font-weight: 500;
            }}
            QPushButton:hover {{
                background-color: {COLORS['primary_hover']};
            }}
        """)

        button_layout = QHBoxLayout()
        button_layout.addStretch()
        button_layout.addWidget(close_btn)
        button_layout.addStretch()

        layout.addLayout(button_layout)
        self.setLayout(layout)

class ProjectIdDialog(QDialog):
    """Dialog to request Project ID from the user"""
    def __init__(self, parent=None, default_project=None):
        super().__init__(parent)
        self.setWindowTitle("MEX - Enter Google Cloud Project ID")
        self.setModal(True)
        self.setMinimumWidth(500)

        layout = QVBoxLayout()

        # Info label
        info_label = QLabel("Please enter your Google Cloud Project ID:")
        info_label.setWordWrap(True)
        info_label.setStyleSheet(f"""
            color: {COLORS['text_primary']};
            font-size: {font_manager.base_size}px;
            margin-bottom: 10px;
        """)
        layout.addWidget(info_label)

        # Project ID input
        self.project_input = QLineEdit()
        if default_project:
            self.project_input.setText(default_project)
            self.project_input.setPlaceholderText(f"e.g., {default_project}")
        else:
            self.project_input.setPlaceholderText("e.g., my-project-id")

        self.project_input.setStyleSheet(f"""
            QLineEdit {{
                padding: 8px;
                border: 1px solid {COLORS['border']};
                border-radius: 4px;
                font-size: {font_manager.base_size}px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
            }}
            QLineEdit:focus {{
                border-color: {COLORS['primary']};
            }}
        """)
        layout.addWidget(self.project_input)

        # Disclaimer box
        disclaimer_box = QGroupBox("⚠️ Disclaimer")
        disclaimer_box.setStyleSheet(f"""
            QGroupBox {{
                font-weight: bold;
                border: 2px solid {COLORS['warning']};
                border-radius: 5px;
                margin-top: 10px;
                padding-top: 10px;
                background-color: {COLORS['disclaimer_bg']};
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 10px 0 10px;
                color: {COLORS['danger']};
            }}
        """)

        disclaimer_layout = QVBoxLayout()
        disclaimer_text = QLabel(
            "• Use at your own risk\n"
            "• All pricing shown is fictional and for demonstration only\n"
            "• Actual costs may vary significantly\n"
            "• This is not an official Google product"
        )
        disclaimer_text.setWordWrap(True)
        disclaimer_text.setStyleSheet(f"""
            color: {COLORS['text_primary']};
            font-size: {font_manager.base_size - 1}px;
            font-weight: normal;
            padding: 5px;
        """)
        disclaimer_layout.addWidget(disclaimer_text)
        disclaimer_box.setLayout(disclaimer_layout)

        layout.addWidget(disclaimer_box)

        # Help text
        help_label = QLabel("You can find your Project ID in the Google Cloud Console")
        help_label.setWordWrap(True)
        help_label.setStyleSheet(f"""
            color: {COLORS['text_secondary']};
            font-size: {font_manager.base_size - 2}px;
            margin-top: 5px;
        """)
        layout.addWidget(help_label)

        # Buttons
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok |
            QDialogButtonBox.StandardButton.Cancel
        )
        buttons.accepted.connect(self.validate_and_accept)
        buttons.rejected.connect(self.reject)

        # Style the buttons
        buttons.setStyleSheet(f"""
            QPushButton {{
                padding: 6px 16px;
                border-radius: 4px;
                font-size: {font_manager.base_size}px;
                font-weight: 500;
            }}
            QPushButton[text="OK"] {{
                background-color: {COLORS['primary']};
                color: white;
                border: none;
            }}
            QPushButton[text="OK"]:hover {{
                background-color: {COLORS['primary_hover']};
            }}
            QPushButton[text="Cancel"] {{
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
                border: 1px solid {COLORS['border']};
            }}
            QPushButton[text="Cancel"]:hover {{
                background-color: {COLORS['background']};
            }}
        """)

        layout.addSpacing(10)
        layout.addWidget(buttons)

        self.setLayout(layout)

        # Focus on input
        self.project_input.setFocus()

    def validate_and_accept(self):
        """Validate the project ID and accept if valid"""
        project_id = self.project_input.text().strip()

        if not project_id:
            QMessageBox.warning(
                self,
                "Invalid Project ID",
                "Please enter a valid Project ID"
            )
            return

        # Basic validation: project IDs should contain only lowercase letters, numbers, and hyphens
        if not all(c.isalnum() or c == '-' for c in project_id):
            QMessageBox.warning(
                self,
                "Invalid Project ID",
                "Project ID should only contain lowercase letters, numbers, and hyphens"
            )
            return

        self.accept()

    def get_project_id(self):
        """Get the entered project ID"""
        return self.project_input.text().strip()

class AnimatedButton(QPushButton):
    """Custom animated button with hover effects"""
    def __init__(self, text, primary=False):
        super().__init__(text)
        self.primary = primary
        self.base_font_size = font_manager.base_size
        self.setup_style()

    def setup_style(self):
        if self.primary:
            self.setStyleSheet(f"""
                QPushButton {{
                    background: qlineargradient(x1: 0, y1: 0, x2: 1, y2: 1,
                                              stop: 0 {COLORS['primary']},
                                              stop: 1 {COLORS['primary_hover']});
                    color: white;
                    border: none;
                    border-radius: 6px;
                    padding: 8px 16px;
                    font-weight: 600;
                    font-size: {self.base_font_size}px;
                }}
                QPushButton:hover {{
                    background: qlineargradient(x1: 0, y1: 0, x2: 1, y2: 1,
                                              stop: 0 {COLORS['primary_hover']},
                                              stop: 1 {COLORS['primary']});
                }}
                QPushButton:pressed {{
                    padding: 9px 15px 7px 17px;
                }}
                QPushButton:disabled {{
                    background: #9CA3AF;
                }}
            """)
        else:
            self.setStyleSheet(f"""
                QPushButton {{
                    background-color: {COLORS['surface']};
                    color: {COLORS['text_primary']};
                    border: 1px solid {COLORS['border']};
                    border-radius: 6px;
                    padding: 6px 12px;
                    font-weight: 500;
                    font-size: {self.base_font_size}px;
                }}
                QPushButton:hover {{
                    background-color: {COLORS['background']};
                    border-color: {COLORS['primary']};
                    color: {COLORS['primary']};
                }}
                QPushButton:pressed {{
                    padding: 7px 11px 5px 13px;
                }}
            """)

    def update_font_size(self, size):
        """Update button font size"""
        self.base_font_size = size
        self.setup_style()

    def update_theme(self):
        """Update button theme"""
        self.setup_style()

class StyledCard(QFrame):
    """Styled card component with shadow"""
    def __init__(self):
        super().__init__()
        self.update_theme()

    def update_theme(self):
        self.setStyleSheet(f"""
            QFrame {{
                background-color: {COLORS['surface']};
                border-radius: 8px;
                border: 1px solid {COLORS['border']};
            }}
        """)

        # Add subtle drop shadow
        shadow = QGraphicsDropShadowEffect()
        shadow.setBlurRadius(10)
        shadow.setXOffset(0)
        shadow.setYOffset(2)
        shadow.setColor(QColor(0, 0, 0, 20 if not theme_manager.is_dark_mode else 60))
        self.setGraphicsEffect(shadow)

class APIWorker(QThread):
    """Worker thread for API calls"""
    finished = pyqtSignal(str, str, str, int, int)  # response, error, raw_response, input_tokens, output_tokens
    progress = pyqtSignal(str, int)  # message, percentage

    def __init__(self, model_config, prompt, credentials, use_1m_context=False, use_memory=False):
        super().__init__()
        self.model_config = model_config
        self.prompt = prompt
        self.credentials = credentials
        self.use_1m_context = use_1m_context
        self.use_memory = use_memory
        self._is_cancelled = False

    def cancel(self):
        """Cancel the API request"""
        self._is_cancelled = True

    def get_access_token(self):
        """Get a fresh access token for API calls."""
        self.credentials.refresh(Request())
        return self.credentials.token

    def build_request_payload(self):
        """Build the appropriate request payload based on the model publisher."""
        if self.model_config["publisher"] == "anthropic":
            # Determine max_tokens based on 1M context window usage
            if self.use_1m_context and self.model_config.get("supports_1m_context"):
                # When using 1M context, we need to be more conservative with output tokens
                # to ensure input + output doesn't exceed 1M total
                max_output = min(
                    self.model_config["max_output_tokens"],
                    1000000 - (len(self.prompt) // 4)  # Approximate input tokens
                )
            else:
                max_output = self.model_config["max_output_tokens"]

            payload = {
                "anthropic_version": "vertex-2023-10-16",
                "messages": [{"role": "user", "content": self.prompt}],
                "max_tokens": max(1024, max_output),  # Ensure at least 1024 tokens
                "stream": True
            }
            
            # Add memory tool if enabled and supported
            if self.use_memory and self.model_config.get("supports_memory"):
                payload["tools"] = [{
                    "type": "memory_20250818",
                    "name": "memory"
                }]
            
            return payload
            
        elif self.model_config["publisher"] == "google":
            return {
                "contents": [{
                    "role": "user",
                    "parts": [{"text": self.prompt}]
                }],
                "generationConfig": {
                    "maxOutputTokens": self.model_config["max_output_tokens"]
                }
            }
        else:
            raise ValueError(f"Unknown publisher: {self.model_config['publisher']}")

    def parse_anthropic_stream(self, response_text):
        """Parse Anthropic's Server-Sent Events streaming format - handles text AND tool_use blocks."""
        full_text = ""
        lines = response_text.split('\n')

        logging.info(f"Parsing Anthropic stream with {len(lines)} lines")

        for line in lines:
            if line.startswith('data: '):
                try:
                    data_str = line[6:].strip()
                    if data_str and data_str != '[DONE]':
                        data = json.loads(data_str)

                        # Handle content_block_delta events for TEXT content
                        if data.get("type") == "content_block_delta":
                            delta = data.get("delta", {})
                            
                            # Text content
                            if delta.get("type") == "text_delta":
                                delta_text = delta.get("text", "")
                                full_text += delta_text
                            
                            # Tool use content (input_json_delta) - skip these
                            elif delta.get("type") == "input_json_delta":
                                logging.debug(f"Skipping tool_use input_json_delta: {delta.get('partial_json', '')}")
                                continue

                        # Handle content_block_start events (initial content) - only for text blocks
                        elif data.get("type") == "content_block_start":
                            content_block = data.get("content_block", {})
                            
                            # Only process text blocks, skip tool_use blocks
                            if content_block.get("type") == "text":
                                block_text = content_block.get("text", "")
                                full_text += block_text
                            elif content_block.get("type") == "tool_use":
                                logging.debug(f"Skipping tool_use block: {content_block.get('name', 'unknown')}")
                                continue

                except json.JSONDecodeError as e:
                    logging.warning(f"Failed to parse line as JSON: {line[:100]}")
                    continue

        logging.info(f"Parsed Anthropic response length: {len(full_text)} characters")
        return full_text

    def parse_google_stream(self, response_text):
        """Parse Google's streaming format - COMPLETE response."""
        full_text = ""

        # Split by lines and filter out empty lines and commas
        lines = [line.strip() for line in response_text.split('\n') if line.strip() and line.strip() != ',']

        logging.info(f"Parsing Google stream with {len(lines)} valid lines")

        # Handle array format: [obj1, obj2, obj3]
        if response_text.strip().startswith('['):
            try:
                # Try to parse as a JSON array
                data_array = json.loads(response_text)
                for data in data_array:
                    candidates = data.get("candidates", [])
                    if candidates:
                        content = candidates[0].get("content", {})
                        parts = content.get("parts", [])
                        if parts:
                            text = parts[0].get("text", "")
                            full_text += text
                logging.info(f"Parsed Google array response length: {len(full_text)} characters")
                return full_text
            except json.JSONDecodeError:
                pass

        # Handle newline-delimited JSON format
        for line in lines:
            # Skip lines that are just commas
            if line == ',':
                continue

            try:
                # Remove trailing comma if present
                if line.endswith(','):
                    line = line[:-1]

                data = json.loads(line)
                candidates = data.get("candidates", [])
                if candidates:
                    content = candidates[0].get("content", {})
                    parts = content.get("parts", [])
                    if parts:
                        text = parts[0].get("text", "")
                        full_text += text
            except json.JSONDecodeError:
                continue

        logging.info(f"Parsed Google response length: {len(full_text)} characters")
        return full_text

    def parse_response(self, response_text, response_data=None):
        """Parse the response based on the model publisher and format - COMPLETE response."""
        try:
            if self.model_config["publisher"] == "anthropic":
                # First try streaming format
                if "data:" in response_text:
                    parsed = self.parse_anthropic_stream(response_text)
                    if parsed:
                        logging.info(f"Successfully parsed Anthropic streaming response: {len(parsed)} chars")
                        return parsed

                # Then try non-streaming JSON format
                elif response_data and isinstance(response_data, dict):
                    if "content" in response_data:
                        if isinstance(response_data["content"], list) and len(response_data["content"]) > 0:
                            # Filter out tool_use blocks, only get text blocks
                            text_content = ""
                            for block in response_data["content"]:
                                if block.get("type") == "text":
                                    text_content += block.get("text", "")
                            return text_content

                # If neither worked, return the raw text
                logging.warning("Could not parse Anthropic response, returning raw text")
                return response_text

            elif self.model_config["publisher"] == "google":
                # Parse Google's streaming format
                parsed = self.parse_google_stream(response_text)
                if parsed:
                    logging.info(f"Successfully parsed Google response: {len(parsed)} chars")
                    return parsed

                # If parsing failed, return raw text
                logging.warning("Could not parse Google response, returning raw text")
                return response_text
            else:
                return response_text

        except Exception as e:
            logging.error(f"Error parsing response: {e}")
            logging.debug(f"Response text preview: {response_text[:500]}")
            return f"Error parsing response: {str(e)}\n\nRaw response:\n{response_text[:1000]}"

    def run(self):
        """Run the API call in a separate thread"""
        try:
            if self._is_cancelled:
                self.finished.emit("", "Query cancelled by user", "", 0, 0)
                return

            self.progress.emit("🔐 Authenticating...", 20)
            access_token = self.get_access_token()
            logging.info(f"🔑 Access Token (masked): {access_token[:10]}...{access_token[-5:]}")

            if self._is_cancelled:
                self.finished.emit("", "Query cancelled by user", "", 0, 0)
                return

            publisher = self.model_config["publisher"]
            model_id = self.model_config["model_id"]
            model_path = model_id.split(":")[0]
            method = model_id.split(":")[1] if ":" in model_id else "predict"

            url = f"{VERTEX_AI_ENDPOINT}/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/{publisher}/models/{model_path}:{method}"

            payload = self.build_request_payload()
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=utf-8"
            }

            # Add beta headers
            beta_headers = []
            
            # Add 1M context header if enabled
            if self.use_1m_context and self.model_config.get("supports_1m_context"):
                beta_headers.append("context-1m-2025-08-07")
                logging.info("Using 1M context window beta feature")

            # Add memory header if enabled
            if self.use_memory and self.model_config.get("supports_memory"):
                beta_headers.append("context-management-2025-06-27")
                logging.info("Using memory tool beta feature")
            
            # Combine beta headers
            if beta_headers:
                headers["anthropic-beta"] = ",".join(beta_headers)

            if self._is_cancelled:
                self.finished.emit("", "Query cancelled by user", "", 0, 0)
                return

            self.progress.emit("📤 Sending request...", 50)
            logging.info(f"Sending request to: {url}")
            logging.info(f"Headers: {headers}")
            logging.info(f"Payload: {json.dumps(payload, indent=2)}")

            response = requests.post(url, headers=headers, json=payload, timeout=120, stream=True)

            if self._is_cancelled:
                self.finished.emit("", "Query cancelled by user", "", 0, 0)
                return

            if response.status_code != 200:
                error_msg = f"API call failed with status {response.status_code}: {response.text}"
                logging.error(error_msg)
                logging.error(f"Response Headers: {response.headers}")
                self.finished.emit("", error_msg, "", 0, 0)
                return

            self.progress.emit("💬 Processing response...", 80)

            # Read the COMPLETE response
            response_text = response.text
            logging.info(f"Received COMPLETE response of length: {len(response_text)} characters")

            # Parse the response to extract actual text content
            parsed_response = self.parse_response(response_text)

            logging.info(f"Final parsed response length: {len(parsed_response)} characters")

            # Calculate approximate token counts
            input_tokens = len(self.prompt) // 4
            output_tokens = len(parsed_response) // 4

            self.progress.emit("✅ Complete!", 100)
            self.finished.emit(parsed_response, "", response_text, input_tokens, output_tokens)

        except Exception as e:
            logging.error(f"Error in API worker: {e}", exc_info=True)
            self.finished.emit("", str(e), "", 0, 0)

class QueryTab(QWidget):
    """Individual query tab widget with enhanced design and memory support"""
    font_size_changed = pyqtSignal(int)  # Signal for font size changes

    def __init__(self, tab_name, credentials, parent=None):
        super().__init__(parent)
        self.tab_name = tab_name
        self.credentials = credentials
        self.worker = None
        self.start_time = None
        self.raw_response = ""  # Store raw response
        self.current_model_config = None
        self.query_timer = QElapsedTimer()
        self.init_ui()

    def init_ui(self):
        main_layout = QVBoxLayout()
        main_layout.setSpacing(8)
        main_layout.setContentsMargins(12, 12, 12, 12)

        # Create a splitter for resizable sections
        splitter = QSplitter(Qt.Orientation.Vertical)
        splitter.setHandleWidth(8)
        splitter.setStyleSheet(f"""
            QSplitter::handle {{
                background-color: {COLORS['border']};
                border-radius: 2px;
            }}
            QSplitter::handle:hover {{
                background-color: {COLORS['text_secondary']};
            }}
        """)

        # TOP SECTION (Controls + Prompt)
        top_widget = QWidget()
        top_layout = QVBoxLayout(top_widget)
        top_layout.setSpacing(8)
        top_layout.setContentsMargins(0, 0, 0, 0)

        # Compact Header with Model Selector - using VBoxLayout for two rows
        header_layout = QVBoxLayout()
        header_layout.setSpacing(4)

        # First row: Execute, Stop, Model selector, and checkboxes
        first_row = QHBoxLayout()
        first_row.setSpacing(8)

        # Execute and Stop buttons
        self.generate_btn = AnimatedButton("📤 Execute", primary=True)
        self.generate_btn.clicked.connect(self.generate_response)
        first_row.addWidget(self.generate_btn)

        # Stop button (initially hidden)
        self.stop_btn = AnimatedButton("⏹ Stop", primary=True)
        self.stop_btn.clicked.connect(self.stop_query)
        self.stop_btn.setVisible(False)
        self.stop_btn.setStyleSheet(f"""
            QPushButton {{
                background: qlineargradient(x1: 0, y1: 0, x2: 1, y2: 1,
                                          stop: 0 {COLORS['danger']},
                                          stop: 1 #DC2626);
                color: white;
                border: none;
                border-radius: 6px;
                padding: 8px 16px;
                font-weight: 600;
                font-size: {font_manager.base_size}px;
            }}
            QPushButton:hover {{
                background: qlineargradient(x1: 0, y1: 0, x2: 1, y2: 1,
                                          stop: 0 #DC2626,
                                          stop: 1 {COLORS['danger']});
            }}
        """)
        first_row.addWidget(self.stop_btn)

        self.model_combo = QComboBox()
        self.model_combo.setMinimumWidth(200)
        self.model_combo.setMaximumWidth(250)
        self.update_combo_style()

        # Add models to combo box - Claude 4.5 Sonnet as default
        for key, config in AVAILABLE_MODELS.items():
            self.model_combo.addItem(f"{config['icon']} {config['display_name']}", key)

        # Set Claude 4.5 Sonnet as default (it's the second item after adding Haiku)
        self.model_combo.setCurrentIndex(2)

        # Model info label with tooltip
        self.model_info = QLabel("")
        self.model_info.setStyleSheet(f"color: {COLORS['text_secondary']}; font-size: {font_manager.base_size - 2}px;")
        self.model_info.setCursor(Qt.CursorShape.WhatsThisCursor)

        first_row.addWidget(self.model_combo)
        first_row.addWidget(self.model_info)

        # 1M Context checkbox (only visible for supported models)
        self.use_1m_context_checkbox = QCheckBox("1M Context")
        self.use_1m_context_checkbox.setChecked(False)
        self.use_1m_context_checkbox.setStyleSheet(f"""
            QCheckBox {{
                color: {COLORS['primary']};
                font-size: {font_manager.base_size - 2}px;
                font-weight: 600;
            }}
            QCheckBox::indicator {{
                width: 14px;
                height: 14px;
                border-radius: 3px;
                border: 1px solid {COLORS['border']};
                background-color: {COLORS['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {COLORS['primary']};
                border-color: {COLORS['primary']};
            }}
        """)
        self.use_1m_context_checkbox.setToolTip(
            "Enable 1 million token context window (beta)\n"
            "• Shared between input and output\n"
            "• Premium pricing: 2x input, 1.5x output for tokens >200K\n"
            "• Only available for Claude Sonnet 4.5"
        )
        self.use_1m_context_checkbox.stateChanged.connect(self.update_model_info)
        self.use_1m_context_checkbox.stateChanged.connect(self.update_pricing_estimate)
        first_row.addWidget(self.use_1m_context_checkbox)

        # Memory checkbox (only visible for supported models) - DISABLED BY DEFAULT
        self.use_memory_checkbox = QCheckBox("🧠")
        self.use_memory_checkbox.setChecked(False)  # DISABLED BY DEFAULT
        self.use_memory_checkbox.setStyleSheet(f"""
            QCheckBox {{
                color: {COLORS['secondary']};
                font-size: {font_manager.base_size - 2}px;
                font-weight: 600;
            }}
            QCheckBox::indicator {{
                width: 14px;
                height: 14px;
                border-radius: 3px;
                border: 1px solid {COLORS['border']};
                background-color: {COLORS['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {COLORS['secondary']};
                border-color: {COLORS['secondary']};
            }}
        """)
        self.use_memory_checkbox.setToolTip(
            "Enable memory tool (beta)\n"
            "• AI can remember context across conversations\n"
            "• Improves responses with persistent knowledge\n"
            "• Only available for Claude Sonnet 4.5\n"
            "• DISABLED BY DEFAULT - check to enable"
        )
        self.use_memory_checkbox.stateChanged.connect(self.update_model_info)
        first_row.addWidget(self.use_memory_checkbox)

        first_row.addStretch()

        # Input character and token count labels
        self.input_char_count_label = QLabel("Input: 0 chars")
        self.input_char_count_label.setStyleSheet(f"""
            color: {COLORS['text_secondary']};
            font-size: {font_manager.base_size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['background']};
            border-radius: 3px;
        """)

        self.input_token_count_label = QLabel("~0 tokens")
        self.input_token_count_label.setStyleSheet(f"""
            color: {COLORS['primary']};
            font-size: {font_manager.base_size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['info_bg']};
            border-radius: 3px;
            font-weight: 600;
        """)

        first_row.addWidget(self.input_char_count_label)
        first_row.addWidget(self.input_token_count_label)

        # Pricing label
        self.pricing_label = QLabel("")
        self.pricing_label.setStyleSheet(f"""
            color: {COLORS['warning']};
            font-size: {font_manager.base_size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['disclaimer_bg']};
            border-radius: 3px;
            font-weight: 600;
        """)
        self.pricing_label.setVisible(False)
        first_row.addWidget(self.pricing_label)

        # Second row: Action buttons
        second_row = QHBoxLayout()
        second_row.setSpacing(8)

        # Add Save button
        self.save_btn = AnimatedButton("💾 Save")
        self.save_btn.clicked.connect(self.save_response)
        self.save_btn.setEnabled(False)

        # Copy Output button
        self.copy_output_btn = AnimatedButton("📋 Copy Output")
        self.copy_output_btn.clicked.connect(self.copy_output)
        self.copy_output_btn.setEnabled(False)

        # Copy Query button
        self.copy_btn = AnimatedButton("Copy Query")
        self.copy_btn.clicked.connect(self.copy_response)

        # Clear button
        self.clear_btn = AnimatedButton("Clear")
        self.clear_btn.clicked.connect(self.clear_all)

        # Create Project button
        self.create_project_btn = AnimatedButton("📁 Create Project")
        self.create_project_btn.clicked.connect(self.create_project_from_response)
        self.create_project_btn.setEnabled(False)

        second_row.addWidget(self.save_btn)
        second_row.addWidget(self.copy_output_btn)
        second_row.addWidget(self.copy_btn)
        second_row.addWidget(self.clear_btn)
        second_row.addWidget(self.create_project_btn)
        second_row.addStretch()

        # Add both rows to header layout
        header_layout.addLayout(first_row)
        header_layout.addLayout(second_row)

        # Create a hidden Raw JSON checkbox for compatibility (controlled by main window)
        self.show_raw_json_checkbox = QCheckBox()
        self.show_raw_json_checkbox.setVisible(False)
        self.show_raw_json_checkbox.stateChanged.connect(self.toggle_response_format)

        # Prompt Input - now with 9 lines minimum height
        self.prompt_edit = QTextEdit()
        self.prompt_edit.setPlaceholderText("Enter your query here...")

        # Calculate height for 9 lines
        font_metrics = self.prompt_edit.fontMetrics()
        line_height = font_metrics.lineSpacing()
        nine_lines_height = line_height * 9 + 20  # 20px for padding

        self.prompt_edit.setMinimumHeight(nine_lines_height)
        self.prompt_edit.setMaximumHeight(300)  # Increased max height for resizability
        self.prompt_edit.setFont(font_manager.get_font("mono"))
        self.update_prompt_style()
        self.prompt_edit.textChanged.connect(self.update_char_count)
        self.prompt_edit.textChanged.connect(self.update_pricing_estimate)

        # Progress Bar (compact)
        self.progress_bar = QProgressBar()
        self.progress_bar.setVisible(False)
        self.progress_bar.setMaximumHeight(16)
        self.progress_bar.setStyleSheet(f"""
            QProgressBar {{
                border: 1px solid {COLORS['border']};
                border-radius: 4px;
                text-align: center;
                font-size: {font_manager.base_size - 2}px;
                background-color: {COLORS['background']};
            }}
            QProgressBar::chunk {{
                background: qlineargradient(x1: 0, y1: 0, x2: 1, y2: 0,
                                          stop: 0 {COLORS['primary']},
                                          stop: 1 {COLORS['secondary']});
                border-radius: 3px;
            }}
        """)

        top_layout.addLayout(header_layout)
        top_layout.addWidget(self.prompt_edit)
        top_layout.addWidget(self.progress_bar)

        # BOTTOM SECTION (Response - gets more space)
        response_widget = QWidget()
        response_layout = QVBoxLayout(response_widget)
        response_layout.setSpacing(4)
        response_layout.setContentsMargins(0, 0, 0, 0)

        # Response header
        response_header = QHBoxLayout()
        response_label = QLabel("💬 Response")
        response_label.setFont(font_manager.get_font("subheading"))
        response_label.setStyleSheet(f"color: {COLORS['text_primary']}; font-weight: 600;")

        self.response_info = QLabel("")
        self.response_info.setStyleSheet(f"""
            color: {COLORS['text_secondary']};
            font-size: {font_manager.base_size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['background']};
            border-radius: 3px;
        """)

        # Output character and token count labels
        self.output_char_count_label = QLabel("")
        self.output_char_count_label.setStyleSheet(f"""
            color: {COLORS['text_secondary']};
            font-size: {font_manager.base_size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['background']};
            border-radius: 3px;
        """)

        self.output_token_count_label = QLabel("")
        self.output_token_count_label.setStyleSheet(f"""
            color: {COLORS['secondary']};
            font-size: {font_manager.base_size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['success_bg']};
            border-radius: 3px;
            font-weight: 600;
        """)

        response_header.addWidget(response_label)
        response_header.addStretch()
        response_header.addWidget(self.output_char_count_label)
        response_header.addWidget(self.output_token_count_label)
        response_header.addWidget(self.response_info)

        # Response text (takes all available space)
        self.response_edit = QTextEdit()
        self.response_edit.setReadOnly(True)
        self.response_edit.setPlaceholderText("Response will appear here...")
        self.response_edit.setFont(font_manager.get_font("mono"))

        # Enable line wrapping
        self.response_edit.setLineWrapMode(QTextEdit.LineWrapMode.WidgetWidth)

        self.update_response_style()

        # Store the parsed response separately
        self.parsed_response = ""

        response_layout.addLayout(response_header)
        response_layout.addWidget(self.response_edit, 1)  # Give it stretch factor

        # Status label (compact)
        self.status_label = QLabel("")
        self.status_label.setWordWrap(True)
        self.status_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.status_label.setVisible(False)
        self.status_label.setMaximumHeight(30)
        self.update_status_style()

        # Add widgets to splitter
        splitter.addWidget(top_widget)
        splitter.addWidget(response_widget)

        # Set initial sizes - adjusted for 9-line prompt (35% top, 65% bottom)
        splitter.setSizes([350, 450])

        # Prevent the top section from becoming too small
        splitter.setStretchFactor(0, 0)  # Don't stretch top section
        splitter.setStretchFactor(1, 1)  # Allow bottom section to stretch

        # Add to main layout
        main_layout.addWidget(splitter)
        main_layout.addWidget(self.status_label)

        self.setLayout(main_layout)
        self.update_model_info()
        self.model_combo.currentIndexChanged.connect(self.update_model_info)
        self.model_combo.currentIndexChanged.connect(self.update_pricing_estimate)

    def update_pricing_estimate(self):
        """Calculate and display fictional pricing estimate"""
        if not self.current_model_config:
            return

        input_tokens = len(self.prompt_edit.toPlainText()) // 4

        if input_tokens == 0:
            self.pricing_label.setVisible(False)
            return

        # Estimate output tokens (assume 2x input for estimation)
        estimated_output_tokens = input_tokens * 2

        # Get pricing info
        pricing = self.current_model_config.get("pricing", {"input": 0.001, "output": 0.002})

        # Check if using 1M context and if tokens exceed 200K
        use_1m = self.use_1m_context_checkbox.isChecked() and self.current_model_config.get("supports_1m_context")
        total_tokens = input_tokens + estimated_output_tokens

        if use_1m and total_tokens > 200000:
            # Premium pricing for tokens over 200K
            base_input_tokens = min(input_tokens, 200000)
            premium_input_tokens = max(0, input_tokens - 200000)

            base_output_tokens = min(estimated_output_tokens, 200000 - base_input_tokens)
            premium_output_tokens = estimated_output_tokens - base_output_tokens

            input_cost = (base_input_tokens / 1000) * pricing["input"]
            input_cost += (premium_input_tokens / 1000) * pricing.get("input_premium", pricing["input"] * 2)

            output_cost = (base_output_tokens / 1000) * pricing["output"]
            output_cost += (premium_output_tokens / 1000) * pricing.get("output_premium", pricing["output"] * 1.5)
        else:
            # Standard pricing
            input_cost = (input_tokens / 1000) * pricing["input"]
            output_cost = (estimated_output_tokens / 1000) * pricing["output"]

        total_cost = input_cost + output_cost

        # Format price display
        if total_cost < 0.01:
            price_text = f"${total_cost:.4f}"
        elif total_cost < 1:
            price_text = f"${total_cost:.3f}"
        else:
            price_text = f"${total_cost:.2f}"

        premium_note = " (Premium)" if use_1m and total_tokens > 200000 else ""
        self.pricing_label.setText(f"💰 ~{price_text} USD*{premium_note}")

        tooltip = (
            f"Fictional pricing estimate:\n"
            f"Input: ~{input_tokens:,} tokens × ${pricing['input']:.3f}/1K = ${input_cost:.4f}\n"
            f"Output: ~{estimated_output_tokens:,} tokens × ${pricing['output']:.3f}/1K = ${output_cost:.4f}\n"
            f"Total: ~{price_text} USD\n\n"
        )

        if use_1m and total_tokens > 200000:
            tooltip += (
                f"⚠️ Premium pricing applied for tokens >200K:\n"
                f"Input: 2x base rate\n"
                f"Output: 1.5x base rate\n\n"
            )

        tooltip += "*Prices are fictional and for demonstration only"

        self.pricing_label.setToolTip(tooltip)
        self.pricing_label.setVisible(True)

    def stop_query(self):
        """Stop the current query"""
        if self.worker and self.worker.isRunning():
            self.worker.cancel()
            self.worker.quit()
            self.worker.wait()
            self.on_query_stopped()

    def on_query_stopped(self):
        """Handle query stop"""
        self.generate_btn.setVisible(True)
        self.stop_btn.setVisible(False)
        self.generate_btn.setEnabled(True)
        self.progress_bar.setVisible(False)
        self.response_info.setText("⏹ Stopped")
        self.show_message("Query stopped", "warning")

    def copy_output(self):
        """Copy the output response to clipboard"""
        response = self.parsed_response if self.parsed_response else self.response_edit.toPlainText()
        if response:
            QApplication.clipboard().setText(response)
            self.show_message(f"Output copied! ({len(response):,} characters)", "success")
        else:
            self.show_message("No output to copy", "warning")

    def save_response(self):
        """Save the response to a text file"""
        if not self.parsed_response and not self.raw_response:
            self.show_message("No response to save", "warning")
            return

        # Prepare default filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        model_name = self.model_combo.currentText().split()[1] if self.model_combo.currentText() else "response"

        # Determine file extension based on current view
        if self.show_raw_json_checkbox.isChecked():
            default_filename = f"{model_name}_{timestamp}_raw.json"
            file_filter = "JSON Files (*.json);;Text Files (*.txt);;All Files (*.*)"
        else:
            default_filename = f"{model_name}_{timestamp}.txt"
            file_filter = "Text Files (*.txt);;JSON Files (*.json);;All Files (*.*)"

        # Open file dialog
        file_path, _ = QFileDialog.getSaveFileName(
            self,
            "Save Response",
            default_filename,
            file_filter
        )

        if file_path:
            try:
                # Determine what to save based on checkbox state and file extension
                content_to_save = ""

                if file_path.endswith('.json') or self.show_raw_json_checkbox.isChecked():
                    # Save raw JSON (formatted if possible)
                    if self.raw_response:
                        try:
                            # Try to format as pretty JSON
                            lines = self.raw_response.strip().split('\n')
                            formatted_json = []
                            for line in lines:
                                if line.strip() and line.strip() != ',':
                                    try:
                                        if line.endswith(','):
                                            line = line[:-1]
                                        json_obj = json.loads(line)
                                        formatted_json.append(json.dumps(json_obj, indent=2))
                                    except:
                                        formatted_json.append(line)
                            content_to_save = "\n\n".join(formatted_json)
                        except:
                            content_to_save = self.raw_response
                    else:
                        content_to_save = self.response_edit.toPlainText()
                else:
                    # Save parsed plaintext
                    content_to_save = self.parsed_response if self.parsed_response else self.response_edit.toPlainText()

                # Add metadata header
                use_1m = "Yes" if self.use_1m_context_checkbox.isChecked() else "No"
                use_memory = "Yes" if self.use_memory_checkbox.isChecked() else "No"
                metadata = f"""# Generated by MEX - Model EXplorer
# Date: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
# Model: {self.model_combo.currentText()}
# 1M Context: {use_1m}
# Memory Tool: {use_memory}
# Query Length: {len(self.prompt_edit.toPlainText())} characters
# Response Length: {len(content_to_save)} characters
# Format: {'Raw JSON' if (file_path.endswith('.json') or self.show_raw_json_checkbox.isChecked()) else 'Parsed Text'}
{"="*50}

"""
                # Save the file
                with open(file_path, 'w', encoding='utf-8') as f:
                    if not file_path.endswith('.json'):
                        f.write(metadata)
                    f.write(content_to_save)

                # Show success message
                file_size = os.path.getsize(file_path)
                size_kb = file_size / 1024
                self.show_message(f"Saved to {os.path.basename(file_path)} ({size_kb:.1f} KB)", "success")
                logging.info(f"Response saved to: {file_path}")

            except Exception as e:
                error_msg = f"Failed to save file: {str(e)}"
                self.show_message(error_msg, "error")
                logging.error(error_msg)

    def format_token_display(self, tokens):
        """Format token count for display (e.g., 1048576 -> 1M)"""
        if tokens >= 1000000:
            return f"{tokens/1000000:.1f}M"
        elif tokens >= 1000:
            return f"{tokens//1000}k"
        else:
            return str(tokens)

    def update_model_info(self):
        """Update model information display with accurate tooltip"""
        model_key = self.model_combo.currentData()
        if model_key:
            config = AVAILABLE_MODELS[model_key]
            self.current_model_config = config

            # Show/hide 1M context checkbox based on model support
            supports_1m = config.get("supports_1m_context", False)
            self.use_1m_context_checkbox.setVisible(supports_1m)

            # Show/hide memory checkbox based on model support
            supports_memory = config.get("supports_memory", False)
            self.use_memory_checkbox.setVisible(supports_memory)

            # Determine max input tokens based on 1M context setting
            if self.use_1m_context_checkbox.isChecked() and supports_1m:
                max_input = config.get("max_input_tokens_extended", config["max_input_tokens"])
            else:
                max_input = config["max_input_tokens"]

            # Format the token display
            input_display = self.format_token_display(max_input)
            output_display = self.format_token_display(config['max_output_tokens'])

            # Update the label to show input/output limits with memory indicator
            context_note = " (1M)" if self.use_1m_context_checkbox.isChecked() and supports_1m else ""
            memory_note = " 🧠" if self.use_memory_checkbox.isChecked() and supports_memory else ""
            self.model_info.setText(f"{input_display}/{output_display} tokens{context_note}{memory_note}")

            # Calculate approximate words and characters
            input_words = int(max_input * 0.75)
            output_words = int(config['max_output_tokens'] * 0.75)
            input_chars = max_input * 4  # Approximately 4 chars per token
            output_chars = config['max_output_tokens'] * 4

            # Get pricing info
            pricing = config.get("pricing", {"input": 0.001, "output": 0.002})

            # Set detailed tooltip
            tooltip_text = f"""
            <b>{config['display_name']}</b><br><br>
            <b>Input Token Limit:</b> {max_input:,} tokens<br>
            ≈ {input_words:,} words or ~{input_chars:,} characters<br><br>
            <b>Output Token Limit:</b> {config['max_output_tokens']:,} tokens<br>
            ≈ {output_words:,} words or ~{output_chars:,} characters<br><br>
            <b>Fictional Pricing:</b><br>
            Input: ${pricing['input']:.3f} per 1K tokens<br>
            Output: ${pricing['output']:.3f} per 1K tokens<br>
            """

            if supports_1m and self.use_1m_context_checkbox.isChecked():
                tooltip_text += f"""
            <br><b>Premium Pricing (>200K tokens):</b><br>
            Input: ${pricing.get('input_premium', pricing['input'] * 2):.3f} per 1K tokens<br>
            Output: ${pricing.get('output_premium', pricing['output'] * 1.5):.3f} per 1K tokens<br>
                """

            if supports_memory:
                memory_status = "ENABLED" if self.use_memory_checkbox.isChecked() else "disabled"
                tooltip_text += f"""
            <br><b>Memory Tool:</b> {memory_status}<br>
            {'✅ AI can remember context across conversations' if self.use_memory_checkbox.isChecked() else '❌ Memory tool disabled'}
                """

            tooltip_text += f"""
            <br><b>Description:</b> {config.get('description', 'General purpose model')}<br><br>
            <i>Note: All pricing is fictional. Actual costs will vary.</i>
            """

            self.model_info.setToolTip(tooltip_text)

            # Update char count display to reflect current model's limit
            self.update_char_count()

    def update_char_count(self):
        """Update character and token counts with visual feedback"""
        count = len(self.prompt_edit.toPlainText())

        # Calculate approximate token count (1 token ≈ 4 characters)
        approx_tokens = count // 4

        # Update input labels
        self.input_char_count_label.setText(f"Input: {count:,} chars")
        self.input_token_count_label.setText(f"~{approx_tokens:,} tokens")

        # Get current model's max input tokens
        if self.current_model_config:
            # Check if using 1M context
            if self.use_1m_context_checkbox.isChecked() and self.current_model_config.get("supports_1m_context"):
                max_tokens = self.current_model_config.get("max_input_tokens_extended", self.current_model_config['max_input_tokens'])
            else:
                max_tokens = self.current_model_config['max_input_tokens']

            # Calculate percentage based on token approximation
            percentage = (approx_tokens / max_tokens) * 100 if max_tokens > 0 else 0

            # Update colors based on usage
            if percentage > 95:
                char_color = COLORS['danger']
                token_bg = COLORS['error_bg']
            elif percentage > 80:
                char_color = COLORS['warning']
                token_bg = "#FEF3C7" if not theme_manager.is_dark_mode else "#78350F"
            else:
                char_color = COLORS['text_secondary']
                token_bg = COLORS['info_bg']

            self.input_char_count_label.setStyleSheet(f"""
                color: {char_color};
                font-size: {font_manager.base_size - 2}px;
                font-weight: 600;
                padding: 2px 6px;
                background-color: {COLORS['background']};
                border-radius: 3px;
            """)

            self.input_token_count_label.setStyleSheet(f"""
                color: {char_color if percentage > 80 else COLORS['primary']};
                font-size: {font_manager.base_size - 2}px;
                padding: 2px 6px;
                background-color: {token_bg};
                border-radius: 3px;
                font-weight: 600;
            """)

    def update_output_counts(self, text):
        """Update output character and token counts"""
        if text:
            char_count = len(text)
            token_count = char_count // 4  # Approximate tokens

            self.output_char_count_label.setText(f"Output: {char_count:,} chars")
            self.output_token_count_label.setText(f"~{token_count:,} tokens")
            self.output_char_count_label.setVisible(True)
            self.output_token_count_label.setVisible(True)
        else:
            self.output_char_count_label.setVisible(False)
            self.output_token_count_label.setVisible(False)

    def update_combo_style(self):
        """Update combo box style with current font size"""
        self.model_combo.setStyleSheet(f"""
            QComboBox {{
                padding: 6px 10px;
                border: 1px solid {COLORS['border']};
                border-radius: 6px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
                font-weight: 500;
            }}
            QComboBox:hover {{
                border-color: {COLORS['primary']};
            }}
            QComboBox::drop-down {{
                border: none;
                padding-right: 8px;
            }}
            QComboBox::down-arrow {{
                image: none;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 5px solid {COLORS['text_secondary']};
                margin-right: 4px;
            }}
            QComboBox QAbstractItemView {{
                background-color: {COLORS['surface']};
                border: 1px solid {COLORS['border']};
                color: {COLORS['text_primary']};
                selection-background-color: {COLORS['primary']};
                selection-color: white;
            }}
        """)

    def update_prompt_style(self):
        """Update prompt edit style with current font size"""
        self.prompt_edit.setStyleSheet(f"""
            QTextEdit {{
                border: 1px solid {COLORS['border']};
                border-radius: 6px;
                padding: 8px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
            }}
            QTextEdit:focus {{
                border-color: {COLORS['primary']};
            }}
        """)

    def update_response_style(self):
        """Update response edit style with current font size"""
        self.response_edit.setStyleSheet(f"""
            QTextEdit {{
                border: 1px solid {COLORS['border']};
                border-radius: 6px;
                padding: 10px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
                line-height: 1.5;
            }}
        """)

    def update_status_style(self):
        """Update status label style with current font size"""
        self.status_label.setStyleSheet(f"""
            padding: 6px;
            border-radius: 4px;
            font-size: {font_manager.base_size}px;
            font-weight: 500;
        """)

    def update_font_sizes(self, size):
        """Update all font sizes in this tab"""
        # Update text editors
        self.prompt_edit.setFont(font_manager.get_font("mono"))
        self.response_edit.setFont(font_manager.get_font("mono"))

        # Recalculate height for 9 lines with new font size
        font_metrics = self.prompt_edit.fontMetrics()
        line_height = font_metrics.lineSpacing()
        nine_lines_height = line_height * 9 + 20  # 20px for padding
        self.prompt_edit.setMinimumHeight(nine_lines_height)

        # Update styles
        self.update_combo_style()
        self.update_prompt_style()
        self.update_response_style()
        self.update_status_style()

        # Update buttons
        if hasattr(self, 'generate_btn'):
            self.generate_btn.update_font_size(size)
            self.stop_btn.update_font_size(size)
            self.clear_btn.update_font_size(size)
            self.copy_btn.update_font_size(size)
            self.copy_output_btn.update_font_size(size)
            self.save_btn.update_font_size(size)
            self.create_project_btn.update_font_size(size)

        # Update labels
        self.model_info.setStyleSheet(f"color: {COLORS['text_secondary']}; font-size: {size - 2}px;")
        self.input_char_count_label.setStyleSheet(f"""
            color: {COLORS['text_secondary']};
            font-size: {size - 2}px;
            padding: 2px 6px;
            background-color: {COLORS['background']};
            border-radius: 3px;
        """)

    def update_theme(self):
        """Update all colors when theme changes"""
        global COLORS
        COLORS = theme_manager.get_colors()

        # Update all styles
        self.update_combo_style()
        self.update_prompt_style()
        self.update_response_style()
        self.update_status_style()

        # Update buttons
        if hasattr(self, 'generate_btn'):
            self.generate_btn.update_theme()
            self.stop_btn.update_theme()
            self.clear_btn.update_theme()
            self.copy_btn.update_theme()
            self.copy_output_btn.update_theme()
            self.save_btn.update_theme()
            self.create_project_btn.update_theme()

        # Update labels and other elements
        self.update_char_count()
        self.update_output_counts(self.parsed_response if self.parsed_response else "")

    def toggle_response_format(self):
        """Toggle between raw JSON and parsed text display"""
        if self.show_raw_json_checkbox.isChecked() and self.raw_response:
            # Show raw JSON (prettified)
            try:
                # Try to format as pretty JSON if possible
                formatted_json = ""
                lines = self.raw_response.strip().split('\n')
                for line in lines:
                    if line.strip() and line.strip() != ',':
                        try:
                            if line.endswith(','):
                                line = line[:-1]
                            json_obj = json.loads(line)
                            formatted_json += json.dumps(json_obj, indent=2) + "\n\n"
                        except:
                            formatted_json += line + "\n"
                self.response_edit.setPlainText(formatted_json.strip())
            except:
                self.response_edit.setPlainText(self.raw_response)
        elif self.parsed_response:
            # Show parsed text
            self.response_edit.setPlainText(self.parsed_response)

    def generate_response(self):
        """Generate response with enhanced UX and memory support"""
        prompt = self.prompt_edit.toPlainText().strip()

        if not prompt:
            self.show_message("Please enter a query", "warning")
            return

        # Check against model's input limit
        if self.current_model_config:
            # Determine max tokens based on 1M context usage
            if self.use_1m_context_checkbox.isChecked() and self.current_model_config.get("supports_1m_context"):
                max_tokens = self.current_model_config.get("max_input_tokens_extended", self.current_model_config['max_input_tokens'])
            else:
                max_tokens = self.current_model_config['max_input_tokens']

            max_chars = max_tokens * 4
            if len(prompt) > max_chars:
                self.show_message(f"Query exceeds maximum of {max_chars:,} characters for this model", "error")
                return

        model_key = self.model_combo.currentData()
        model_config = AVAILABLE_MODELS[model_key]

        # Get 1M context setting
        use_1m_context = self.use_1m_context_checkbox.isChecked() and model_config.get("supports_1m_context", False)
        
        # Get memory setting
        use_memory = self.use_memory_checkbox.isChecked() and model_config.get("supports_memory", False)

        # Start timing
        self.query_timer.start()
        self.start_time = datetime.now()

        # Update UI state
        self.generate_btn.setVisible(False)
        self.stop_btn.setVisible(True)
        self.response_edit.clear()
        self.progress_bar.setVisible(True)
        self.progress_bar.setValue(0)
        self.raw_response = ""
        self.parsed_response = ""
        self.save_btn.setEnabled(False)
        self.copy_output_btn.setEnabled(False)
        self.output_char_count_label.setVisible(False)
        self.output_token_count_label.setVisible(False)

        # Show memory status in progress
        if use_memory:
            self.show_message("🧠 Memory tool enabled", "info")

        self.worker = APIWorker(model_config, prompt, self.credentials, use_1m_context, use_memory)
        self.worker.progress.connect(self.on_progress)
        self.worker.finished.connect(self.on_response)
        self.worker.start()

    def on_progress(self, message, percentage):
        """Handle progress updates with animation"""
        self.response_info.setText(message)
        self.progress_bar.setValue(percentage)

    def on_response(self, response, error, raw_response, input_tokens, output_tokens):
        """Handle API response with timing and pricing"""
        # Restore UI state
        self.generate_btn.setVisible(True)
        self.stop_btn.setVisible(False)
        self.generate_btn.setEnabled(True)
        self.progress_bar.setVisible(False)

        if error:
            self.show_message(f"Error: {error}", "error")
            self.response_info.setText("❌ Failed")
        else:
            elapsed = self.query_timer.elapsed() / 1000.0  # Convert to seconds

            # Store both raw and parsed responses
            self.raw_response = raw_response
            self.parsed_response = response

            logging.info(f"Displaying response: {len(response)} characters")

            # Enable save, copy, and create project buttons
            self.save_btn.setEnabled(True)
            self.copy_output_btn.setEnabled(True)
            self.create_project_btn.setEnabled(True)

            # Display based on checkbox state
            if self.show_raw_json_checkbox.isChecked():
                self.toggle_response_format()
            else:
                # Set the COMPLETE parsed response
                self.response_edit.setPlainText(response)

                # Force the text edit to update and show all content
                self.response_edit.document().setModified(False)
                self.response_edit.viewport().update()

            # Update output counts
            self.update_output_counts(response)

            # Calculate actual pricing
            if self.current_model_config:
                pricing = self.current_model_config.get("pricing", {"input": 0.001, "output": 0.002})

                # Check if premium pricing applies
                total_tokens = input_tokens + output_tokens
                use_1m = self.use_1m_context_checkbox.isChecked() and self.current_model_config.get("supports_1m_context")

                if use_1m and total_tokens > 200000:
                    # Premium pricing
                    base_input = min(input_tokens, 200000)
                    premium_input = max(0, input_tokens - 200000)

                    base_output = min(output_tokens, 200000 - base_input)
                    premium_output = max(0, output_tokens - base_output)

                    input_cost = (base_input / 1000) * pricing["input"]
                    input_cost += (premium_input / 1000) * pricing.get("input_premium", pricing["input"] * 2)

                    output_cost = (base_output / 1000) * pricing["output"]
                    output_cost += (premium_output / 1000) * pricing.get("output_premium", pricing["output"] * 1.5)
                else:
                    # Standard pricing
                    input_cost = (input_tokens / 1000) * pricing["input"]
                    output_cost = (output_tokens / 1000) * pricing["output"]

                total_cost = input_cost + output_cost

                # Format price
                if total_cost < 0.01:
                    price_text = f"${total_cost:.4f}"
                else:
                    price_text = f"${total_cost:.2f}"

                premium_note = " (Premium)" if use_1m and total_tokens > 200000 else ""
                memory_note = " 🧠" if self.use_memory_checkbox.isChecked() and self.current_model_config.get("supports_memory") else ""
                self.response_info.setText(f"✅ {elapsed:.1f}s | {price_text} USD*{premium_note}{memory_note}")

                tooltip = (
                    f"Query completed in {elapsed:.1f} seconds\n"
                    f"Input: {input_tokens:,} tokens × ${pricing['input']:.3f}/1K = ${input_cost:.4f}\n"
                    f"Output: {output_tokens:,} tokens × ${pricing['output']:.3f}/1K = ${output_cost:.4f}\n"
                    f"Total: {price_text} USD\n"
                )

                if use_1m and total_tokens > 200000:
                    tooltip += "\n⚠️ Premium pricing applied for tokens >200K\n"
                
                if self.use_memory_checkbox.isChecked() and self.current_model_config.get("supports_memory"):
                    tooltip += "\n🧠 Memory tool enabled\n"

                tooltip += "\n*Fictional pricing for demonstration only"

                self.response_info.setToolTip(tooltip)
            else:
                self.response_info.setText(f"✅ {elapsed:.1f}s")

            # Ensure the response is visible by scrolling to top
            cursor = self.response_edit.textCursor()
            cursor.movePosition(QTextCursor.MoveOperation.Start)
            self.response_edit.setTextCursor(cursor)
            self.response_edit.ensureCursorVisible()

            success_msg = f"Query executed successfully! ({len(response):,} chars)"
            if self.use_memory_checkbox.isChecked() and self.current_model_config.get("supports_memory"):
                success_msg += " 🧠 Memory active"
            self.show_message(success_msg, "success")

    def create_project_from_response(self):
        """Create project folder structure from formatted response text"""
        if not self.parsed_response and not self.response_edit.toPlainText():
            self.show_message("No response to create project from", "warning")
            return

        # Get the response text
        response_text = self.parsed_response if self.parsed_response else self.response_edit.toPlainText()

        # Ask user for output directory
        output_dir = QFileDialog.getExistingDirectory(
            self,
            "Select Output Directory for Project",
            str(Path.home()),
            QFileDialog.Option.ShowDirsOnly
        )

        if not output_dir:
            return

        try:
            # Parse the response to extract file paths and content
            files_data = self.parse_project_structure(response_text)

            if not files_data:
                self.show_message("No file structure found in response", "warning")
                return

            # Create the project
            files_created = 0
            dirs_created = set()

            for file_path, content in files_data.items():
                full_path = Path(output_dir) / file_path
                directory = full_path.parent

                # Create directory if needed
                if directory != Path(output_dir) and str(directory) not in dirs_created:
                    directory.mkdir(parents=True, exist_ok=True)
                    dirs_created.add(str(directory))

                # Write file
                with open(full_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                    if content and not content.endswith('\n'):
                        f.write('\n')

                files_created += 1

            # Show success message
            self.show_message(
                f"Project created! {files_created} files, {len(dirs_created)} directories",
                "success"
            )
            logging.info(f"Project created at: {output_dir}")

        except Exception as e:
            error_msg = f"Failed to create project: {str(e)}"
            self.show_message(error_msg, "error")
            logging.error(error_msg, exc_info=True)

    def parse_project_structure(self, text):
        """Parse formatted text to extract file paths and content"""
        import re
        
        files_data = {}
        current_file = None
        current_content = []
        in_code_block = False

        lines = text.split('\n')

        for line in lines:
            # Check for file path markers (bold text in markdown: **filepath**)
            file_match = re.match(r'\*\*([^*]+)\*\*', line.strip())

            if file_match:
                # Save previous file if exists
                if current_file and current_content:
                    files_data[current_file] = ''.join(current_content).strip()

                # Start new file
                current_file = file_match.group(1)
                current_content = []
                in_code_block = False

            # Check for code block markers
            elif line.strip().startswith('```'):
                if not in_code_block:
                    in_code_block = True
                else:
                    in_code_block = False

            # Collect content inside code blocks
            elif in_code_block and current_file:
                current_content.append(line + '\n')

        # Save last file if exists
        if current_file and current_content:
            files_data[current_file] = ''.join(current_content).strip()

        return files_data

    def clear_all(self):
        """Clear all fields"""
        self.prompt_edit.clear()
        self.response_edit.clear()
        self.response_info.setText("")
        self.raw_response = ""
        self.parsed_response = ""
        self.save_btn.setEnabled(False)
        self.copy_output_btn.setEnabled(False)
        self.create_project_btn.setEnabled(False)
        self.output_char_count_label.setVisible(False)
        self.output_token_count_label.setVisible(False)
        self.pricing_label.setVisible(False)

    def copy_response(self):
        """Copy query text with feedback"""
        query = self.prompt_edit.toPlainText()
        if query:
            QApplication.clipboard().setText(query)
            self.show_message(f"Query copied! ({len(query):,} characters)", "success")
        else:
            self.show_message("No query to copy", "warning")

    def show_message(self, message, msg_type="info"):
        """Show status message with appropriate styling"""
        self.status_label.setVisible(True)
        self.status_label.setWordWrap(True)  # Enable word wrapping

        # Adjust height for errors to show more text
        if msg_type == "error":
            self.status_label.setMaximumHeight(150)  # Allow taller for errors
        else:
            self.status_label.setMaximumHeight(60)  # Normal height

        if msg_type == "success":
            icon = "✅"
            bg_color = COLORS['success_bg']
            text_color = "#065F46" if not theme_manager.is_dark_mode else "#A7F3D0"
        elif msg_type == "error":
            icon = "❌"
            bg_color = COLORS['error_bg']
            text_color = "#991B1B" if not theme_manager.is_dark_mode else "#FCA5A5"
        elif msg_type == "warning":
            icon = "⚠️"
            bg_color = "#FEF3C7" if not theme_manager.is_dark_mode else "#78350F"
            text_color = "#92400E" if not theme_manager.is_dark_mode else "#FDE68A"
        else:
            icon = "ℹ️"
            bg_color = COLORS['info_bg']
            text_color = "#1E40AF" if not theme_manager.is_dark_mode else "#93C5FD"

        self.status_label.setText(f"{icon} {message}")
        self.status_label.setStyleSheet(f"""
            background-color: {bg_color};
            color: {text_color};
            padding: 8px;
            border-radius: 4px;
            font-size: {font_manager.base_size}px;
            font-weight: 500;
        """)

        # Auto-hide after delay - longer for errors
        delay = 10000 if msg_type == "error" else 3000
        QTimer.singleShot(delay, lambda: self.status_label.setVisible(False))

class MainWindow(QMainWindow):
    """Enhanced main application window"""
    def __init__(self):
        super().__init__()
        self.credentials = None
        self.tabs = []
        self.sync_checkbox = None
        self.authenticate()
        self.init_ui()

    def authenticate(self):
        """Authenticate with Google Cloud"""
        try:
            self.credentials, project = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            logging.info(f"✅ Authenticated with credentials for project: {project}")
        except Exception as e:
            logging.error(f"❌ Authentication failed: {e}")
            QMessageBox.critical(None, "Authentication Error",
                                f"Failed to authenticate with Google Cloud:\n{str(e)}\n\n"
                                "Please ensure you have valid credentials set up.")
            sys.exit(1)

    def init_ui(self):
        """Initialize the enhanced UI"""
        self.setWindowTitle(f"MEX - Model EXplorer | Project: {PROJECT_ID}")
        self.setGeometry(100, 100, 1400, 900)

        # Set application style
        self.update_main_style()

        # Central widget
        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        # Main layout with minimal margins
        main_layout = QVBoxLayout()
        main_layout.setSpacing(8)
        main_layout.setContentsMargins(16, 16, 16, 16)

        # Compact Header
        header_layout = QHBoxLayout()
        header_layout.setSpacing(8)

        # Execute All and New Tab buttons
        self.generate_all_btn = AnimatedButton("⚡ Execute All", primary=True)
        self.generate_all_btn.clicked.connect(self.generate_all)

        self.add_tab_btn = AnimatedButton("+ New Tab")
        self.add_tab_btn.clicked.connect(lambda: self.add_new_tab(f"Query {len(self.tabs) + 1}"))

        # Add Execute All and New Tab buttons first (leftmost)
        header_layout.addWidget(self.generate_all_btn)
        header_layout.addWidget(self.add_tab_btn)

        # Add app title with project info
        app_title = QLabel(f"MEX - Model EXplorer")
        app_title.setFont(font_manager.get_font("heading"))
        app_title.setStyleSheet(f"color: {COLORS['text_primary']}; margin: 0 20px;")

        # Add project badge
        project_badge = QLabel(f"🎯 {PROJECT_ID}")
        project_badge.setStyleSheet(f"""
            color: {COLORS['primary']};
            font-size: {font_manager.base_size - 1}px;
            font-weight: 600;
            padding: 4px 8px;
            background-color: {COLORS['info_bg']};
            border-radius: 4px;
        """)

        header_layout.addWidget(app_title)
        header_layout.addWidget(project_badge)

        header_layout.addStretch()

        # Raw JSON checkbox - moved to main header
        self.raw_json_checkbox = QCheckBox("Raw JSON")
        self.raw_json_checkbox.setChecked(False)
        self.raw_json_checkbox.setStyleSheet(f"""
            QCheckBox {{
                color: {COLORS['text_secondary']};
                font-size: {font_manager.base_size}px;
            }}
            QCheckBox::indicator {{
                width: 16px;
                height: 16px;
                border-radius: 3px;
                border: 1px solid {COLORS['border']};
                background-color: {COLORS['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {COLORS['primary']};
                border-color: {COLORS['primary']};
            }}
        """)
        self.raw_json_checkbox.stateChanged.connect(self.toggle_raw_json_all_tabs)
        header_layout.addWidget(self.raw_json_checkbox)

        # Dark/Light mode toggle button
        self.theme_btn = AnimatedButton("🌙 Dark" if not theme_manager.is_dark_mode else "☀️ Light")
        self.theme_btn.clicked.connect(self.toggle_theme)
        header_layout.addWidget(self.theme_btn)

        # About button
        self.about_btn = AnimatedButton("ℹ️ About")
        self.about_btn.clicked.connect(self.show_about_dialog)
        header_layout.addWidget(self.about_btn)

        # Font size control
        font_size_label = QLabel("Font Size:")
        font_size_label.setStyleSheet(f"color: {COLORS['text_secondary']}; font-size: {font_manager.base_size}px;")

        self.font_size_spinbox = QSpinBox()
        self.font_size_spinbox.setMinimum(10)
        self.font_size_spinbox.setMaximum(20)
        self.font_size_spinbox.setValue(font_manager.base_size)
        self.font_size_spinbox.setSuffix("px")
        self.font_size_spinbox.setStyleSheet(f"""
            QSpinBox {{
                padding: 4px 8px;
                border: 1px solid {COLORS['border']};
                border-radius: 4px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
                min-width: 70px;
            }}
            QSpinBox:hover {{
                border-color: {COLORS['primary']};
            }}
            QSpinBox::up-button, QSpinBox::down-button {{
                background-color: {COLORS['surface']};
                border: none;
            }}
            QSpinBox::up-arrow, QSpinBox::down-arrow {{
                color: {COLORS['text_secondary']};
            }}
        """)
        self.font_size_spinbox.valueChanged.connect(self.update_font_size)

        header_layout.addWidget(font_size_label)
        header_layout.addWidget(self.font_size_spinbox)

        # Sync checkbox
        self.sync_checkbox = QCheckBox("Sync queries")
        self.sync_checkbox.setFont(font_manager.get_font("body"))
        self.sync_checkbox.setStyleSheet(f"""
            QCheckBox {{
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
            }}
            QCheckBox::indicator {{
                width: 16px;
                height: 16px;
                border-radius: 3px;
                border: 1px solid {COLORS['border']};
                background-color: {COLORS['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {COLORS['primary']};
                border-color: {COLORS['primary']};
            }}
        """)
        self.sync_checkbox.stateChanged.connect(self.sync_prompts_changed)

        header_layout.addWidget(self.sync_checkbox)

        # Tab widget
        self.tab_widget = QTabWidget()
        self.tab_widget.setTabsClosable(True)
        self.tab_widget.tabCloseRequested.connect(self.close_tab)

        # Add initial tabs
        self.add_new_tab("Query 1")
        self.add_new_tab("Query 2")

        # Set the first tab as selected
        self.tab_widget.setCurrentIndex(0)

        # Add all to main layout
        main_layout.addLayout(header_layout)
        main_layout.addWidget(self.tab_widget, 1)

        central_widget.setLayout(main_layout)

    def toggle_raw_json_all_tabs(self):
        """Toggle raw JSON display for all tabs"""
        is_checked = self.raw_json_checkbox.isChecked()
        for tab in self.tabs:
            tab.show_raw_json_checkbox.setChecked(is_checked)

    def toggle_theme(self):
        """Toggle between dark and light mode"""
        global COLORS
        COLORS = theme_manager.toggle_theme()

        # Update button text
        self.theme_btn.setText("🌙 Dark" if not theme_manager.is_dark_mode else "☀️ Light")

        # Update main window style
        self.update_main_style()

        # Update all tabs
        for tab in self.tabs:
            tab.update_theme()

        # Update all buttons
        self.generate_all_btn.update_theme()
        self.add_tab_btn.update_theme()
        self.theme_btn.update_theme()
        self.about_btn.update_theme()

        # Update other UI elements
        self.sync_checkbox.setStyleSheet(f"""
            QCheckBox {{
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
            }}
            QCheckBox::indicator {{
                width: 16px;
                height: 16px;
                border-radius: 3px;
                border: 1px solid {COLORS['border']};
                background-color: {COLORS['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {COLORS['primary']};
                border-color: {COLORS['primary']};
            }}
        """)

        self.raw_json_checkbox.setStyleSheet(f"""
            QCheckBox {{
                color: {COLORS['text_secondary']};
                font-size: {font_manager.base_size}px;
            }}
            QCheckBox::indicator {{
                width: 16px;
                height: 16px;
                border-radius: 3px;
                border: 1px solid {COLORS['border']};
                background-color: {COLORS['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {COLORS['primary']};
                border-color: {COLORS['primary']};
            }}
        """)

        self.font_size_spinbox.setStyleSheet(f"""
            QSpinBox {{
                padding: 4px 8px;
                border: 1px solid {COLORS['border']};
                border-radius: 4px;
                background-color: {COLORS['surface']};
                color: {COLORS['text_primary']};
                font-size: {font_manager.base_size}px;
                min-width: 70px;
            }}
            QSpinBox:hover {{
                border-color: {COLORS['primary']};
            }}
            QSpinBox::up-button, QSpinBox::down-button {{
                background-color: {COLORS['surface']};
                border: none;
            }}
            QSpinBox::up-arrow, QSpinBox::down-arrow {{
                color: {COLORS['text_secondary']};
            }}
        """)

    def update_main_style(self):
        """Update main window style"""
        self.setStyleSheet(f"""
            QMainWindow {{
                background-color: {COLORS['background']};
            }}
            QTabWidget::pane {{
                border: none;
                background-color: {COLORS['surface']};
                border-radius: 8px;
            }}
            QTabBar::tab {{
                background-color: {COLORS['surface']};
                color: {COLORS['text_secondary']};
                padding: 8px 16px;
                margin-right: 2px;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                font-weight: 500;
                font-size: {font_manager.base_size}px;
            }}
            QTabBar::tab:selected {{
                background-color: {COLORS['primary']};
                color: white;
            }}
            QTabBar::tab:hover:!selected {{
                background-color: {COLORS['background']};
            }}
            QTabBar::close-button {{
                image: none;
                width: 14px;
                height: 14px;
                border-radius: 7px;
                background-color: {COLORS['text_secondary']}22;
            }}
            QTabBar::close-button:hover {{
                background-color: {COLORS['danger']};
            }}
        """)

    def show_about_dialog(self):
        """Show the About dialog"""
        dialog = AboutDialog(self)
        dialog.exec()

    def update_font_size(self, size):
        """Update font size across the application"""
        font_manager.set_base_size(size)

        # Update all tabs
        for tab in self.tabs:
            tab.update_font_sizes(size)

        # Update main window components
        self.update_main_style()

        # Update buttons
        self.generate_all_btn.update_font_size(size)
        self.add_tab_btn.update_font_size(size)
        self.about_btn.update_font_size(size)
        self.theme_btn.update_font_size(size)

    def add_new_tab(self, name):
        """Add a new query tab with animation"""
        tab = QueryTab(name, self.credentials)
        self.tabs.append(tab)

        if self.sync_checkbox and self.sync_checkbox.isChecked():
            tab.prompt_edit.textChanged.connect(self.sync_prompts)

        index = self.tab_widget.addTab(tab, name)

        # Don't automatically switch to new tab when adding initial tabs
        # Only switch when user explicitly adds a new tab
        if len(self.tabs) > 2:  # After initial tabs
            self.tab_widget.setCurrentIndex(index)

        self.tab_widget.setTabsClosable(self.tab_widget.count() > 1)

    def close_tab(self, index):
        """Close a tab with confirmation"""
        if self.tab_widget.count() > 1:
            tab = self.tabs[index]

            # Check if tab has content
            if tab.prompt_edit.toPlainText() or tab.response_edit.toPlainText():
                reply = QMessageBox.question(self, "Close Tab",
                                            "This tab contains content. Are you sure you want to close it?",
                                            QMessageBox.StandardButton.Yes |
                                            QMessageBox.StandardButton.No)
                if reply != QMessageBox.StandardButton.Yes:
                    return

            self.tabs.remove(tab)
            self.tab_widget.removeTab(index)
            self.tab_widget.setTabsClosable(self.tab_widget.count() > 1)

    def sync_prompts_changed(self):
        """Handle sync checkbox state change"""
        if self.sync_checkbox.isChecked():
            # Connect all tabs
            for tab in self.tabs:
                tab.prompt_edit.textChanged.connect(self.sync_prompts)

            # Sync with current tab's content if it has any
            current_tab = self.tab_widget.currentWidget()
            if current_tab and current_tab.prompt_edit.toPlainText():
                self.sync_prompts_from_tab(current_tab)
        else:
            # Disconnect all tabs
            for tab in self.tabs:
                try:
                    tab.prompt_edit.textChanged.disconnect(self.sync_prompts)
                except:
                    pass

    def sync_prompts_from_tab(self, source_tab):
        """Sync prompts from a specific tab to all others"""
        if not self.sync_checkbox or not self.sync_checkbox.isChecked():
            return

        text = source_tab.prompt_edit.toPlainText()
        for tab in self.tabs:
            if tab != source_tab:
                tab.prompt_edit.blockSignals(True)
                tab.prompt_edit.setPlainText(text)
                tab.update_char_count()
                tab.update_pricing_estimate()
                tab.prompt_edit.blockSignals(False)

    def sync_prompts(self):
        """Sync queries across all tabs"""
        if not self.sync_checkbox or not self.sync_checkbox.isChecked():
            return

        sender = self.sender()
        if sender and hasattr(sender, 'toPlainText'):
            text = sender.toPlainText()
            for tab in self.tabs:
                if tab.prompt_edit != sender:
                    tab.prompt_edit.blockSignals(True)
                    tab.prompt_edit.setPlainText(text)
                    tab.update_char_count()
                    tab.update_pricing_estimate()
                    tab.prompt_edit.blockSignals(False)

    def generate_all(self):
        """Generate responses in all tabs"""
        has_prompt = False
        for tab in self.tabs:
            if tab.prompt_edit.toPlainText().strip():
                has_prompt = True
                tab.generate_response()

        if not has_prompt:
            msg = QMessageBox(self)
            msg.setIcon(QMessageBox.Icon.Warning)
            msg.setWindowTitle("No Query")
            msg.setText("Please enter a query in at least one tab")
            msg.exec()

def get_project_id():
    """Get the project ID from environment variable or user input"""
    global PROJECT_ID

    # First check if PROJECT_ID is set in environment
    env_project_id = os.environ.get("PROJECT_ID")

    if env_project_id:
        PROJECT_ID = env_project_id
        logging.info(f"Using PROJECT_ID from environment: {PROJECT_ID}")
        return

    # Try to get the default project from gcloud
    default_project = None
    try:
        credentials, default_project = default()
        logging.info(f"Default project from gcloud: {default_project}")
    except:
        pass

    # Create a temporary QApplication for the dialog
    app = QApplication.instance()
    if app is None:
        app = QApplication(sys.argv)
        temp_app = True
    else:
        temp_app = False

    # Show dialog to get project ID
    dialog = ProjectIdDialog(None, default_project)
    if dialog.exec() == QDialog.DialogCode.Accepted:
        PROJECT_ID = dialog.get_project_id()
        logging.info(f"Using PROJECT_ID from user input: {PROJECT_ID}")
    else:
        # User cancelled
        logging.error("No PROJECT_ID provided, exiting")
        sys.exit(0)

    # Clean up temporary app
    if temp_app:
        app.quit()

def main():
    # Get project ID before creating main application
    get_project_id()

    # Create main application
    app = QApplication(sys.argv)
    app.setApplicationName("MEX - Model EXplorer")
    app.setStyle("Fusion")

    # Set application palette for consistent theming
    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor(COLORS["background"]))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(COLORS["text_primary"]))
    app.setPalette(palette)

    window = MainWindow()
    window.show()

    sys.exit(app.exec())

if __name__ == "__main__":
    main()


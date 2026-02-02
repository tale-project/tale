"""
Tale Operator Service

AI-powered browser automation service using OpenCode CLI with Playwright MCP.
Provides REST API for web search and browser task automation.
"""

import os

__version__ = os.environ.get("TALE_VERSION", "dev")

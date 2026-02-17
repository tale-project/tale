#!/bin/bash
set -e

# Start Xvfb if not in headless mode
if [ "${OPERATOR_HEADLESS}" = "false" ]; then
    echo "Starting Xvfb virtual display..."
    Xvfb :99 -screen 0 1920x1080x24 &
    export DISPLAY=:99
    sleep 2
    echo "Xvfb started on display :99"
fi

# Configure OpenCode
# OpenCode directly supports OpenAI-compatible APIs without needing a proxy
echo "Configuring OpenCode..."

# Validate required environment variables
if [ -z "${OPENAI_CODING_MODEL}" ]; then
    echo "Error: OPENAI_CODING_MODEL environment variable is required but not set" >&2
    exit 1
fi

# Set up Vision model config (falls back to main model config if not set)
VISION_BASE_URL="${OPENAI_VISION_BASE_URL:-${OPENAI_BASE_URL}}"
VISION_API_KEY="${OPENAI_VISION_API_KEY:-${OPENAI_API_KEY}}"
VISION_MODEL="${OPENAI_VISION_MODEL:-gpt-4o}"

# Create OpenCode config directory
mkdir -p ~/.config/opencode ~/.local/share/opencode

# Generate OpenCode configuration at runtime
# Uses @ai-sdk/openai-compatible for any OpenAI-compatible API
cat > ~/.config/opencode/opencode.json << EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "custom": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Custom Provider",
      "options": {
        "baseURL": "${OPENAI_BASE_URL}",
        "apiKey": "{env:OPENAI_API_KEY}"
      },
      "models": {
        "${OPENAI_CODING_MODEL}": {
          "name": "${OPENAI_CODING_MODEL}",
          "limit": {
            "context": 200000,
            "output": 65536
          }
        }
      }
    }
  },
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "@playwright/mcp@latest", "--headless"],
      "enabled": true
    },
    "vision": {
      "type": "local",
      "command": ["python", "-m", "app.mcp.vision_server"],
      "enabled": true,
      "environment": {
        "OPENAI_VISION_BASE_URL": "${VISION_BASE_URL}",
        "OPENAI_VISION_API_KEY": "${VISION_API_KEY}",
        "OPENAI_VISION_MODEL": "${VISION_MODEL}"
      }
    }
  }
}
EOF

echo "OpenCode configured with:"
echo "  - Provider: custom (${OPENAI_BASE_URL})"
echo "  - Model: ${OPENAI_CODING_MODEL}"
echo "  - MCP: Playwright + Vision"
echo "  - Vision model: ${VISION_MODEL}"

# Execute the main command
exec "$@"

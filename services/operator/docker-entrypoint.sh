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

# Start LiteLLM proxy in background
echo "Starting LiteLLM proxy on port 4000..."
export LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-sk-litellm-operator}"

litellm --config /app/litellm_config.yaml --port 4000 --host 127.0.0.1 > /tmp/litellm.log 2>&1 &
LITELLM_PID=$!

# Wait for LiteLLM to be ready
echo "Waiting for LiteLLM proxy to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:4000/health > /dev/null 2>&1; then
        echo "LiteLLM proxy is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "Warning: LiteLLM proxy health check timed out, continuing anyway..."
        echo "LiteLLM logs:"
        cat /tmp/litellm.log || true
    fi
    sleep 1
done

# Configure Claude Code to use LiteLLM proxy
export ANTHROPIC_BASE_URL="http://127.0.0.1:4000"
export ANTHROPIC_API_KEY="${LITELLM_MASTER_KEY}"

# Configure Claude Code settings and MCP servers
mkdir -p ~/.claude

# Accept terms and configure basic settings
cat > ~/.claude/settings.json << 'SETTINGS'
{
  "hasAcknowledgedTerms": true,
  "permissions": {
    "allow": ["Bash(*)", "Read(*)", "Write(*)", "Edit(*)", "mcp__playwright(*)"],
    "deny": []
  }
}
SETTINGS

# Configure MCP servers (Playwright) in ~/.claude.json
cat > ~/.claude.json << 'MCPCONFIG'
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    }
  }
}
MCPCONFIG

echo "Claude Code configured with Playwright MCP"

# Execute the main command
exec "$@"

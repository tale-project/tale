#!/bin/bash
set -e

# Auto-detect Pencil MCP server binary path based on runtime architecture
ARCH="$(uname -m)"
if [ "$ARCH" = "aarch64" ]; then
    PENCIL_MCP_SERVER_PATH="${PENCIL_MCP_SERVER_PATH:-/opt/pencil/resources/app.asar.unpacked/out/mcp-server-linux-arm64}"
else
    PENCIL_MCP_SERVER_PATH="${PENCIL_MCP_SERVER_PATH:-/opt/pencil/resources/app.asar.unpacked/out/mcp-server-linux-x64}"
fi
export PENCIL_MCP_SERVER_PATH

# Validate required environment variables
if [ -z "${OPENAI_API_KEY}" ]; then
    echo "Error: OPENAI_API_KEY environment variable is required" >&2
    exit 1
fi

if [ -z "${OPENAI_DESIGN_MODEL}" ] && [ -z "${DESIGNER_DESIGN_MODEL}" ]; then
    echo "Error: OPENAI_DESIGN_MODEL or DESIGNER_DESIGN_MODEL is required" >&2
    exit 1
fi

echo "Designer service configured:"
echo "  Model:           ${OPENAI_DESIGN_MODEL:-${DESIGNER_DESIGN_MODEL}}"
echo "  Base URL:        ${OPENAI_BASE_URL:-default}"
echo "  Max iterations:  ${DESIGNER_MAX_AGENT_ITERATIONS:-5}"
echo "  Pencil MCP:      ${PENCIL_MCP_SERVER_PATH}"

# Execute the main command
exec "$@"

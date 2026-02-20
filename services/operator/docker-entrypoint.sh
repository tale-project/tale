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

# Validate required environment variables
if [ -z "${OPENAI_MODEL}" ]; then
    echo "Error: OPENAI_MODEL environment variable is required" >&2
    exit 1
fi

if [ -z "${OPENAI_API_KEY}" ]; then
    echo "Error: OPENAI_API_KEY environment variable is required" >&2
    exit 1
fi

echo "Operator service configured with:"
echo "  - Model: ${OPENAI_MODEL}"
echo "  - Base URL: ${OPENAI_BASE_URL}"
echo "  - Headless: ${OPERATOR_HEADLESS:-true}"
echo "  - Max concurrent: ${OPERATOR_MAX_CONCURRENT_REQUESTS:-10}"

# Execute the main command
exec "$@"

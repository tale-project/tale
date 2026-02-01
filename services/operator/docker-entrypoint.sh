#!/bin/bash
set -e

# Start Xvfb if not in headless mode
if [ "${OPERATOR_HEADLESS}" = "false" ]; then
    echo "Starting Xvfb virtual display..."
    Xvfb :99 -screen 0 1920x1080x24 &
    export DISPLAY=:99
    # Wait for Xvfb to start
    sleep 2
    echo "Xvfb started on display :99"
fi

# Execute the main command
exec "$@"

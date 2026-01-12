#!/bin/sh
set -e

# ============================================================================
# Tale Search (SearXNG) Entrypoint Wrapper
# ============================================================================
# This script translates SEARCH_* environment variables to SearXNG configuration
# and starts the SearXNG service.

echo "Starting Tale Search (SearXNG)..."

# ============================================================================
# Configuration File Generation
# ============================================================================

CONFIG_FILE="/etc/searxng/settings.yml"

# Generate SearXNG configuration from SEARCH_* environment variables
cat > "$CONFIG_FILE" <<EOF
# Tale Search Configuration
# Auto-generated from SEARCH_* environment variables

use_default_settings:
  engines:
    keep_only:
      - google
      - bing
      - duckduckgo
      - brave
      - wikipedia
      - startpage

general:
  debug: ${SEARCH_DEBUG:-false}
  instance_name: '${SEARCH_INSTANCE_NAME:-Tale Search}'

search:
  safe_search: ${SEARCH_SAFE_SEARCH:-0}
  autocomplete: ''
  default_lang: '${SEARCH_DEFAULT_LANG:-all}'
  formats:
    - html
    - json

server:
  secret_key: '${SEARCH_SECRET_KEY:-tale-search-secret-key-change-in-production}'
  limiter: ${SEARCH_LIMITER:-false}
  public_instance: ${SEARCH_PUBLIC_INSTANCE:-false}
  bind_address: '${SEARCH_BIND_ADDRESS:-0.0.0.0}'
  port: ${SEARCH_PORT:-8080}
  http_protocol_version: '1.1'
  # Disable real_ip check to suppress X-Forwarded-For warning in non-proxy setups
  method: 'POST'

ui:
  static_use_hash: true

engines:
  # Google is prioritized with highest weight
  - name: google
    engine: google
    shortcut: g
    disabled: false
    timeout: 10.0
    weight: 2.0
    retry_on_http_error: [403, 429, 503]

  - name: bing
    engine: bing
    shortcut: b
    disabled: false
    timeout: 10.0
    weight: 1.0
    retry_on_http_error: [403, 429, 503]

  - name: duckduckgo
    engine: duckduckgo
    shortcut: ddg
    disabled: true
    timeout: 10.0
    weight: 0.8

  - name: brave
    engine: brave
    shortcut: br
    disabled: false
    timeout: 10.0
    weight: 0.9

  - name: wikipedia
    engine: wikipedia
    shortcut: w
    disabled: false
    weight: 0.5

  - name: startpage
    engine: startpage
    shortcut: sp
    disabled: true
    timeout: 15.0
    weight: 0.7

outgoing:
  request_timeout: ${SEARCH_REQUEST_TIMEOUT:-10.0}
  max_request_timeout: ${SEARCH_MAX_REQUEST_TIMEOUT:-30.0}
  pool_connections: ${SEARCH_POOL_CONNECTIONS:-100}
  pool_maxsize: ${SEARCH_POOL_MAXSIZE:-20}
  retries: ${SEARCH_RETRIES:-2}
  enable_http2: true

# Disable redis to prevent bot detection checks
redis:
  url: false
EOF

echo "Configuration file generated at: $CONFIG_FILE"
echo "Instance name: ${SEARCH_INSTANCE_NAME:-Tale Search}"
echo "Bind address: ${SEARCH_BIND_ADDRESS:-0.0.0.0}:${SEARCH_PORT:-8080}"
echo "Debug mode: ${SEARCH_DEBUG:-false}"
echo "Public instance: ${SEARCH_PUBLIC_INSTANCE:-false}"

# Create empty limiter.toml to suppress missing config warning
cat > "/etc/searxng/limiter.toml" <<LIMITER
# Limiter configuration (disabled)
# This file exists only to suppress the missing config warning
LIMITER
echo "Created limiter.toml to suppress warning"

# ============================================================================
# Start SearXNG
# ============================================================================

echo "Starting SearXNG service..."

# Start granian directly, bypassing the original entrypoint which tries to
# run update-ca-certificates (fails due to permissions, but harmless)
# The base image already has valid CA certificates installed
exec /usr/local/searxng/.venv/bin/granian searx.webapp:app


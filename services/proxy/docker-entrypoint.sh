#!/bin/sh
set -e

# ============================================================================
# Caddy Entrypoint Script
# ============================================================================
# This script:
# 1. Maps TLS_MODE to Caddy's TLS_ISSUER format
# 2. Ensures self-signed CA certificates are readable by other containers
# ============================================================================

# ============================================================================
# Map TLS_MODE to Caddy's TLS configuration
# ============================================================================
# User-friendly: TLS_MODE=selfsigned|letsencrypt
# Caddy expects: TLS_CONFIG with issuer and optional email
case "${TLS_MODE:-selfsigned}" in
  letsencrypt)
    # For Let's Encrypt, include email if provided
    if [ -n "${TLS_EMAIL:-}" ]; then
      export TLS_CONFIG="${TLS_EMAIL}"
      echo "TLS Mode: Let's Encrypt (trusted certificates)"
      echo "  Email: ${TLS_EMAIL}"
    else
      # Let Caddy use its default ACME behavior
      export TLS_CONFIG=""
      echo "TLS Mode: Let's Encrypt (trusted certificates)"
      echo "  Warning: TLS_EMAIL not set, certificate expiry notifications disabled"
    fi
    ;;
  selfsigned|*)
    export TLS_CONFIG="internal"
    echo "TLS Mode: Self-signed (browser warning expected)"
    echo "  To trust certs on host: docker exec tale-proxy caddy trust"
    ;;
esac

# Function to fix certificate permissions after Caddy generates them
fix_cert_permissions() {
  CA_DIR="/data/caddy/pki/authorities/local"
  PKI_DIR="/data/caddy/pki"
  AUTH_DIR="/data/caddy/pki/authorities"

  if [ -d "$CA_DIR" ]; then
    # Make the directory hierarchy readable by others
    chmod 755 "$PKI_DIR" 2>/dev/null || true
    chmod 755 "$AUTH_DIR" 2>/dev/null || true
    chmod 755 "$CA_DIR" 2>/dev/null || true
    # Make the CA certificates readable by others
    chmod 644 "$CA_DIR"/*.crt 2>/dev/null || true
    echo "Fixed CA certificate permissions in $CA_DIR"
  fi
}

# Start a background process to fix permissions after Caddy generates certs
(
  # Wait for Caddy to generate certificates (check every 5 seconds for up to 60 seconds)
  for i in $(seq 1 12); do
    sleep 5
    if [ -f "/data/caddy/pki/authorities/local/root.crt" ]; then
      fix_cert_permissions
      break
    fi
  done
) &

# Execute the main command (Caddy)
exec "$@"

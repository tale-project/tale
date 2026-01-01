#!/bin/sh
set -e

# ============================================================================
# Caddy Entrypoint Script
# ============================================================================
# This script:
# 1. Generates TLS config in Caddyfile based on TLS_MODE (hardcoded, not env vars)
# 2. Ensures self-signed CA certificates are readable by other containers
# ============================================================================

# Source and destination for Caddyfile
# We copy to /config (writable volume) because /etc/caddy is read-only in the image
CADDYFILE_SRC="/etc/caddy/Caddyfile"
CADDYFILE="/config/Caddyfile"

# ============================================================================
# Generate TLS configuration based on TLS_MODE
# ============================================================================
# We hardcode the TLS config directly into Caddyfile because environment
# variables don't persist through `caddy reload` commands.
echo "TLS Configuration:"
echo "  TLS_MODE: ${TLS_MODE:-selfsigned}"

case "${TLS_MODE:-selfsigned}" in
  letsencrypt)
    echo "  Mode: Let's Encrypt (ACME - trusted certificates)"
    if [ -n "${TLS_EMAIL:-}" ]; then
      echo "  Email: ${TLS_EMAIL}"
      # ACME with email for notifications
      TLS_CONFIG="tls ${TLS_EMAIL}"
    else
      echo "  Warning: TLS_EMAIL not set, certificate expiry notifications disabled"
      # ACME without email
      TLS_CONFIG="tls"
    fi
    ;;
  selfsigned|*)
    echo "  Mode: Self-signed (internal CA - browser warning expected)"
    echo "  To trust certs on host: docker exec tale-proxy caddy trust"
    # Internal CA for self-signed certificates
    TLS_CONFIG="tls internal"
    ;;
esac

# Copy Caddyfile to writable location and apply TLS config
cp "$CADDYFILE_SRC" "$CADDYFILE"
sed -i "s|.*TLS_PLACEHOLDER.*|\\t${TLS_CONFIG}|" "$CADDYFILE"
echo "  Caddyfile configured: ${TLS_CONFIG}"

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
  for _ in $(seq 1 12); do
    sleep 5
    if [ -f "/data/caddy/pki/authorities/local/root.crt" ]; then
      fix_cert_permissions
      break
    fi
  done
) &

# Execute the main command (Caddy)
exec "$@"

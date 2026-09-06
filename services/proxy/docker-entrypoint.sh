#!/bin/sh
set -e

# ============================================================================
# Caddy Entrypoint Script
# ============================================================================
# This script:
# 1. Validates required environment variables (HOST, SITE_URL)
# 2. Generates TLS config in Caddyfile based on TLS_MODE (hardcoded, not env vars)
# 3. Ensures self-signed CA certificates are readable by other containers
# ============================================================================

# ============================================================================
# Domain Configuration
# ============================================================================
HOST="${HOST:-localhost}"

# SITE_URL is required
if [ -z "${SITE_URL:-}" ]; then
  echo "Error: SITE_URL is required. Set it in your .env file." >&2
  exit 1
fi
# Trim leading/trailing whitespace
SITE_URL=$(echo "${SITE_URL}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
export SITE_URL

# Base path for subpath deployments (from .env, e.g., /test or /app)
# Strip trailing slashes, ensure leading slash if non-empty, strip SITE_URL trailing slash
BASE_PATH=$(echo "${BASE_PATH:-}" | sed 's|/\+$||')
if [ -n "$BASE_PATH" ] && [ "${BASE_PATH#/}" = "$BASE_PATH" ]; then
  BASE_PATH="/${BASE_PATH}"
fi
SITE_URL=$(echo "${SITE_URL}" | sed 's|/\+$||')
export BASE_PATH
export SITE_URL

# ----------------------------------------------------------------------------
# Additional public origins (multi-domain deployments)
# ----------------------------------------------------------------------------
# ADDITIONAL_SITE_URLS lists the OTHER domains this same deployment answers on,
# comma- or whitespace-separated. Each becomes another address on the site
# block below, so Caddy serves — and, in letsencrypt mode, obtains a
# certificate for — every one of them. Unset (the default) leaves the block
# exactly as it was: one address, SITE_URL.
ADDITIONAL_SITE_URLS=$(echo "${ADDITIONAL_SITE_URLS:-}" | tr ',' ' ')
SITE_ADDRESSES="${SITE_URL}"
for extra in $ADDITIONAL_SITE_URLS; do
  extra=$(echo "${extra}" | sed 's|/\+$||')
  [ -z "$extra" ] && continue
  case "$extra" in
    http://*|https://*) ;;
    *)
      echo "Error: ADDITIONAL_SITE_URLS entry '${extra}' must start with http:// or https://." >&2
      exit 1
      ;;
  esac
  # A duplicate of SITE_URL (or of an earlier entry) would make Caddy refuse
  # the config with "duplicate site address".
  case " ${SITE_ADDRESSES} " in
    *" ${extra} "*) continue ;;
  esac
  SITE_ADDRESSES="${SITE_ADDRESSES} ${extra}"
done
export ADDITIONAL_SITE_URLS

# Docs subdomain origin (https://docs.<HOST> by default; override with DOCS_URL
# in .env when the docs site lives on a different host).
if [ -z "${DOCS_URL:-}" ]; then
  DOCS_URL="https://docs.${HOST}"
fi
DOCS_URL=$(echo "${DOCS_URL}" | sed 's|/\+$||;s|^[[:space:]]*||;s|[[:space:]]*$||')
export DOCS_URL

echo "Domain Configuration:"
echo "  HOST: ${HOST}"
echo "  SITE_URL: ${SITE_URL}"
if [ "${SITE_ADDRESSES}" != "${SITE_URL}" ]; then
  echo "  ADDITIONAL_SITE_URLS:${SITE_ADDRESSES#${SITE_URL}}"
fi
echo "  DOCS_URL: ${DOCS_URL}"
if [ -n "$BASE_PATH" ]; then
  echo "  BASE_PATH: ${BASE_PATH}"
fi

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
    external)
      echo "  Mode: External (TLS handled by reverse proxy, Caddy serves HTTP only)"
      TLS_CONFIG=""
      ;;
    letsencrypt)
      echo "  Mode: Let's Encrypt (ACME - trusted certificates)"
      if [ -n "${TLS_EMAIL:-}" ]; then
        echo "  Email: ${TLS_EMAIL}"
        # ACME with email for notifications
        TLS_CONFIG="tls ${TLS_EMAIL}"
      else
        TLS_EMAIL_DEFAULT="tls@${HOST:-localhost}"
        echo "  Email: ${TLS_EMAIL_DEFAULT} (default, set TLS_EMAIL to override)"
        TLS_CONFIG="tls ${TLS_EMAIL_DEFAULT}"
      fi
      ;;
    selfsigned|*)
      echo "  Mode: Self-signed (internal CA - browser warning expected)"
      echo "  To trust certs on host: docker exec tale-proxy caddy trust"
      # Internal CA for self-signed certificates
      TLS_CONFIG="tls internal"
      ;;
  esac

# HTTPS is required for non-external modes — OAuth providers reject http://
# callbacks and crypto.subtle is unavailable in insecure contexts.
if [ "${TLS_MODE:-selfsigned}" != "external" ] && echo "${SITE_URL}" | grep -qi '^http://'; then
  echo "Error: SITE_URL must use https://. Plain HTTP is not supported." >&2
  echo "  If running behind a TLS-terminating reverse proxy, set TLS_MODE=external." >&2
  exit 1
fi
# Same rule for every additional domain — each is a full entry point, and a
# plain-HTTP one would hand out insecure cookies on that domain.
if [ "${TLS_MODE:-selfsigned}" != "external" ]; then
  for addr in $SITE_ADDRESSES; do
    if echo "${addr}" | grep -qi '^http://'; then
      echo "Error: ADDITIONAL_SITE_URLS entry '${addr}' must use https://. Plain HTTP is not supported." >&2
      echo "  If running behind a TLS-terminating reverse proxy, set TLS_MODE=external." >&2
      exit 1
    fi
  done
fi
if [ "${TLS_MODE:-selfsigned}" != "external" ] && echo "${DOCS_URL}" | grep -qi '^http://'; then
  echo "Error: DOCS_URL must use https://. Plain HTTP is not supported." >&2
  echo "  If running behind a TLS-terminating reverse proxy, set TLS_MODE=external." >&2
  exit 1
fi

# Copy Caddyfile to writable location and apply TLS config
cp "$CADDYFILE_SRC" "$CADDYFILE"
sed -i "s|^[[:space:]]*#[[:space:]]*TLS_PLACEHOLDER[[:space:]]*\$|\\t${TLS_CONFIG}|" "$CADDYFILE"

# Replace SITE_ORIGIN in the Caddyfile with the deployment's address list —
# SITE_URL plus every ADDITIONAL_SITE_URLS entry, comma-separated, which is
# how one Caddy site block serves several domains (no subpath in any of them).
# In `external` mode Caddy must listen on plain HTTP, so each address is
# rewritten to http and its port dropped BEFORE substitution — doing it after
# would have to string-match each address again inside the file.
SITE_ADDRESS_LIST=""
for addr in $SITE_ADDRESSES; do
  if [ "${TLS_MODE:-selfsigned}" = "external" ]; then
    addr=$(echo "${addr}" | sed -E 's|^https://|http://|; s|:[0-9]+$||')
  fi
  if [ -z "$SITE_ADDRESS_LIST" ]; then
    SITE_ADDRESS_LIST="${addr}"
  else
    SITE_ADDRESS_LIST="${SITE_ADDRESS_LIST}, ${addr}"
  fi
done
if [ "${TLS_MODE:-selfsigned}" = "external" ]; then
  echo "  Caddy listen address (site): ${SITE_ADDRESS_LIST}"
fi
sed -i "s|{[\$]SITE_ORIGIN:[^}]*}|${SITE_ADDRESS_LIST}|" "$CADDYFILE"
# DOCS_ORIGIN is the parallel host block for the docs site (docs.<HOST>).
sed -i "s|{[\$]DOCS_ORIGIN:[^}]*}|${DOCS_URL}|" "$CADDYFILE"

# ============================================================================
# Backend-api routing
# ============================================================================
# Everything the pg backend owns is listed here explicitly — auth, the app
# API, the hint stream, both machine doors, SSO/SCIM/trusted-headers on BOTH
# their 0.5-native and 0.4 `/http_api/...` paths (registered IdP redirect
# URIs carry the old ones), the control channel the CLI drains through, the
# cloud-import OAuth callbacks and the WebDAV protocol door.
#
# BACKEND_UPSTREAM began life as the cutover's reversibility switch (unset ⇒
# lanes fall back to Convex). The Convex runtime is gone, so an unset value
# no longer means "0.4 lanes" — it means uploads, live updates and every
# machine door 404 (v0.5.0 shipped that way). The lanes are therefore ALWAYS
# injected; the variable remains an override for split deployments.
OBJECT_STORE_BUCKET="${OBJECT_STORE_BUCKET:-tale-blobs}"
OBJECT_STORE_UPSTREAM="${OBJECT_STORE_UPSTREAM:-object-store:9000}"
BACKEND_UPSTREAM="${BACKEND_UPSTREAM:-backend-api:3005}"

echo "Backend routing: 0.5 lanes → ${BACKEND_UPSTREAM}"
BACKEND_BLOCK=$(cat <<EOF
	handle /api/auth/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/app/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /events {
		reverse_proxy ${BACKEND_UPSTREAM} {
			flush_interval -1
		}
	}
	handle /api/tools/* {
		log_skip
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	# The in-sandbox connectors bridge + the live-body host-call door. A
	# container normally reaches these over the sandbox network, but the
	# public path must follow the tools lane so a deployment that routes
	# sandbox traffic through the proxy keeps working.
	handle /api/connectors/execute {
		log_skip
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/connectors/status {
		log_skip
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/connectors/hostcall {
		log_skip
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	# The connector OAuth2 consent flow (browser-facing) and the Slack
	# Events Request URL (signature-authorized) — both live on the backend
	# once it owns the connectors domain.
	handle /api/connectors/oauth2/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/connectors/slack/* {
		log_skip
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/automations/webhook/* {
		log_skip
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/v1/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/control/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/sso/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /http_api/api/sso/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /scim/v2/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /http_api/scim/v2/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/trusted-headers/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /http_api/api/trusted-headers/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /api/cloud-import/oauth2/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	handle /http_api/api/cloud-import/oauth2/* {
		reverse_proxy ${BACKEND_UPSTREAM}
	}
	# The BLOB store, published at its own bucket path.
	#
	# Uploads and downloads run browser↔store directly: the store, not Node,
	# answers the Range requests media seeking needs. The store itself is
	# internal-only, so the backend signs browser-facing URLs against
	# OBJECT_STORE_PUBLIC_ENDPOINT (this origin) and they arrive here.
	#
	# The path is LITERALLY the bucket name and is NOT stripped: SigV4 covers
	# the host and the path, so rewriting either would break every signature.
	# That is also why this proxies verbatim — no header or URI rewriting.
	#
	# `log_skip`: a presigned URL carries its signature in the query string,
	# and INFO-level access logs would write it to stdout. The path is
	# auth-bound by that signature; logging it adds no security value.
	handle /${OBJECT_STORE_BUCKET}/* {
		log_skip
		reverse_proxy ${OBJECT_STORE_UPSTREAM}
	}
EOF
)
  # `awk` (not sed): the block is multi-line and carries the tabs Caddy's
  # formatter expects, which sed's replacement escaping would mangle.
  awk -v block="$BACKEND_BLOCK" '
    /# BACKEND_PLACEHOLDER/ { print block; next }
    { print }
  ' "$CADDYFILE" > "${CADDYFILE}.tmp" && mv "${CADDYFILE}.tmp" "$CADDYFILE"
  # The Prometheus scrape lane lives inside the token-gated metrics block,
  # so it is templated separately (injecting it with the routes above would
  # put it ahead of the auth matcher and expose the numbers unauthenticated).
  BACKEND_METRICS_BLOCK=$(cat <<EOF
		handle /metrics/backend {
			rewrite * /metrics
			reverse_proxy ${BACKEND_UPSTREAM}
		}
EOF
)
  awk -v block="$BACKEND_METRICS_BLOCK" '
    /# BACKEND_METRICS_PLACEHOLDER/ { print block; next }
    { print }
  ' "$CADDYFILE" > "${CADDYFILE}.tmp" && mv "${CADDYFILE}.tmp" "$CADDYFILE"

# The WebDAV door moves with the backend too. Its handle keeps the body cap
# and only swaps upstream, through Caddy's own env placeholder — one export
# here so the two stay in sync without a second templating pass.
WEBDAV_UPSTREAM="${BACKEND_UPSTREAM}"
export WEBDAV_UPSTREAM

# Inject base path stripping for subpath deployments
if [ -n "$BASE_PATH" ]; then
  sed -i "s|# BASE_PATH_PLACEHOLDER|uri strip_prefix ${BASE_PATH}|" "$CADDYFILE"
else
  sed -i "/# BASE_PATH_PLACEHOLDER/d" "$CADDYFILE"
fi

# For external mode, force Caddy to listen on HTTP by rewriting the scheme.
# SITE_URL stays as-is for the platform (public URL), but Caddy must not auto-enable TLS.
# The site addresses were already http-ified above, before substitution; the
# docs block still carries its https origin and is rewritten here.
if [ "${TLS_MODE:-selfsigned}" = "external" ]; then
  DOCS_ADDR=$(echo "${DOCS_URL}" | sed -E 's|^https://|http://|; s|:[0-9]+$||')
  sed -i "s|${DOCS_URL}|${DOCS_ADDR}|" "$CADDYFILE"
  echo "  Caddy listen address (docs): ${DOCS_ADDR}"
fi

echo "  Caddyfile configured: ${TLS_CONFIG:-none}"

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
# (not needed for external mode — no certificates are generated)
if [ "${TLS_MODE:-selfsigned}" != "external" ]; then
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
fi

# For Let's Encrypt mode: retry certificate obtention if DNS wasn't ready at startup.
# Caddy's built-in retry uses exponential backoff that gets very slow after failures.
# This loop checks that DNS resolves to our public IP before reloading Caddy,
# covering the common case where DNS is configured hours or days after deployment.
if [ "${TLS_MODE:-selfsigned}" = "letsencrypt" ]; then
  (
    sleep 60
    SERVER_IP=$(wget -qO- -T5 http://ipv4.icanhazip.com 2>/dev/null | tr -d '[:space:]')
    if [ -n "$SERVER_IP" ]; then
      echo "ACME retry: server public IP is ${SERVER_IP}"
    else
      echo "ACME retry: could not determine public IP, will retry every 15 minutes"
    fi

    while true; do
      if find /data/caddy/certificates -name "${HOST}" -type d 2>/dev/null | grep -q .; then
        echo "ACME certificate obtained for ${HOST}"
        break
      fi
      if [ -n "$SERVER_IP" ]; then
        # Verify domain resolves to our IP via external DNS (bypasses Docker DNS,
        # handles wildcard DNS that resolves non-existent subdomains to a fallback IP)
        if nslookup "${HOST}" 1.1.1.1 2>/dev/null | grep -q "${SERVER_IP}"; then
          echo "DNS resolved ${HOST} to ${SERVER_IP}, reloading Caddy..."
          caddy reload --config "$CADDYFILE" --adapter caddyfile 2>/dev/null || true
          sleep 120
        else
          sleep 300
        fi
      else
        # Fallback: safe interval under Let's Encrypt rate limit (5 failures/host/hour)
        caddy reload --config "$CADDYFILE" --adapter caddyfile 2>/dev/null || true
        sleep 900
      fi
    done
  ) &
fi

# Execute the main command (Caddy)
exec "$@"

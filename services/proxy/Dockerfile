# ============================================================================
# Tale Proxy Service (Caddy)
# ============================================================================
# This Dockerfile builds a Caddy reverse proxy for the Tale platform
# with automatic HTTPS support via Let's Encrypt
# ============================================================================

FROM caddy:2.10-alpine

# Copy Caddyfile
COPY services/proxy/Caddyfile /etc/caddy/Caddyfile

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Caddy will automatically handle HTTPS certificate management
# Certificates are stored in /data/caddy
VOLUME /data

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

# Caddy runs as non-root by default
# Start Caddy with the Caddyfile
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]


# ============================================================================
# Tale LLM Gateway
# ============================================================================
# Thin wrapper around the upstream maximhq/bifrost gateway image. The gateway
# is the only path from an in-sandbox coding agent (Claude Code / OpenCode) to
# an LLM: the platform provisions providers + mints per-session virtual keys
# over its management API. We re-tag the upstream image as tale-llm-gateway so
# it carries Tale OCI metadata and ships through the same build/scan pipeline
# as the other services; the runtime is unchanged.
# ============================================================================

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Upstream gateway core (vendor image — NOT renamed; this is the literal
# upstream artifact). Pinned because the project has had VK auth regressions.
FROM maximhq/bifrost:v1.5.13

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-llm-gateway" \
      org.opencontainers.image.description="Tale LLM gateway — managed provider auth + per-session virtual keys" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# The base image ships busybox wget but no curl.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

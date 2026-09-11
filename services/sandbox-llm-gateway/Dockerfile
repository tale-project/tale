# ============================================================================
# Tale Sandbox LLM Gateway
# ============================================================================
# Thin wrapper around the upstream maximhq/bifrost gateway image. The gateway
# is the only path from an in-sandbox coding agent (Claude Code / OpenCode) to
# an LLM: the platform provisions providers + mints per-session virtual keys
# over its management API. We re-tag the upstream image as tale-sandbox-llm-gateway
# so it carries Tale OCI metadata and ships through the same build/scan pipeline
# as the other services; the runtime is unchanged.
# ============================================================================

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Upstream gateway core (vendor image — NOT renamed; this is the literal
# upstream artifact). Pinned (the project has had VK auth regressions) — verify
# virtual-key auth after any bump. Held at v1.6.11: v1.5.13 provisioned DeepSeek
# as a generic custom-OpenAI upstream and dropped its `reasoning_content` on
# tool-loop turns, so DeepSeek 400'd ("The `reasoning_content` in the thinking
# mode must be passed back to the API") on every thinking claude-code run.
# v1.6.9 made DeepSeek thinking survive multi-turn on the OpenAI-compatible
# surface; v1.6.10/.11 hardened reasoning replay. Deliberately below the v2.0.0
# major (datasheet-backed request reshaping — larger regression surface).
FROM maximhq/bifrost:v1.6.11

# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-sandbox-llm-gateway" \
      org.opencontainers.image.description="Tale sandbox LLM gateway — managed provider auth + per-session virtual keys" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# The base image ships busybox wget but no curl.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

# Re-assert the upstream image's existing non-root user (uid 1000, owns /app and
# the /app/data SQLite store). The runtime is unchanged — bifrost already runs as
# appuser — but Trivy's static Dockerfile scan can't see the base image's USER,
# so an explicit instruction is needed to satisfy AVD-DS-0002.
USER appuser

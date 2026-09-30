# ============================================================================
# Tale Sandbox LLM Gateway
# ============================================================================
# Thin wrapper around the upstream maximhq/bifrost gateway image. The gateway
# is the only path from an in-sandbox coding agent (Claude Code / OpenCode) to
# an LLM: the platform provisions providers + mints per-session virtual keys
# over its management API. We re-tag the upstream image as tale-sandbox-llm-gateway
# so it carries Tale OCI metadata and ships through the same build/scan pipeline
# as the other services. The runtime is the upstream one; our entrypoint only
# derives the gateway's setup token before handing over (docker-entrypoint.sh).
# ============================================================================

# Version argument - injected by CI from git tag, defaults to 'dev' for local builds
ARG VERSION=dev

# Upstream gateway core (vendor image — NOT renamed; this is the literal
# upstream artifact). Pinned: the project has had virtual-key auth and
# reasoning-replay regressions, so after any bump re-verify virtual-key auth,
# the first admin bootstrap (the setup token), usage booking on whole and
# streamed answers, and DeepSeek thinking on a claude-code tool loop — v1.5.13
# dropped `reasoning_content` on tool-loop turns of a custom OpenAI-compatible
# upstream, and DeepSeek 400'd ("The `reasoning_content` in the thinking mode
# must be passed back to the API") on every thinking run. v2.2 is the first
# line that cancels the vendor call when its caller hangs up (the 1.6 line
# served, and billed, an abandoned whole answer to its end, and a prefill a
# stream was waiting on). Its datasheet-backed request reshaping leaves the
# per-(org, model) custom records alone; it applies to standard providers.
FROM maximhq/bifrost:v2.2.4

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

# Sets BIFROST_SETUP_TOKEN to the gateway admin password (always: an explicit
# one is replaced), then runs the upstream entrypoint (/app/docker-entrypoint.sh)
# with the upstream command.
# Redeclaring ENTRYPOINT resets the inherited CMD, so it is restated.
COPY --chmod=0555 services/sandbox-llm-gateway/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/app/main"]

# Re-assert the upstream image's existing non-root user (uid 1000, owns /app and
# the /app/data SQLite store). The runtime is unchanged — bifrost already runs as
# appuser — but Trivy's static Dockerfile scan can't see the base image's USER,
# so an explicit instruction is needed to satisfy AVD-DS-0002.
USER appuser

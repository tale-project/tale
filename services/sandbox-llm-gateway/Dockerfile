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

# =============================================================================
# tale-init: patched dumb-init 1.2.5 at /init (MAXSIG 31 -> 64), for Incus.
# Incus runs /init as PID 1 and halts a container with SIGPWR, or SIGRTMIN+3
# when PID 1 blocks it; the runtime rewrites both to the stop signal. Docker
# never runs it: the ENTRYPOINT below is unchanged. patches/README.md says why
# and when it goes. Byte-identical in the six stack images (db, platform,
# proxy, sandbox, sandbox-egress, sandbox-llm-gateway), held by
# tools/cli/scripts/oci-image-metadata.test.ts.
# =============================================================================
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS tale-init
COPY patches/dumb-init/maxsig-64.patch /tmp/maxsig-64.patch
RUN set -eux; \
    apk add --no-cache gcc musl-dev patch; \
    wget -q -O /tmp/dumb-init.tar.gz https://github.com/Yelp/dumb-init/archive/refs/tags/v1.2.5.tar.gz; \
    echo '3eda470d8a4a89123f4516d26877a727c0945006c8830b7e3bad717a5f6efc4e  /tmp/dumb-init.tar.gz' | sha256sum -c -; \
    tar -C /tmp -xzf /tmp/dumb-init.tar.gz; \
    cd /tmp/dumb-init-1.2.5; \
    patch -p1 < /tmp/maxsig-64.patch; \
    grep -qx '#define MAXSIG 64' dumb-init.c; \
    gcc -std=gnu99 -static -s -Wall -Werror -O2 -o /init dumb-init.c; \
    /init --version

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
FROM maximhq/bifrost:v2.2.4@sha256:5f8215163cea192451f4b2ee5e0b583874ffe9435a5ab733e08c07aaf38ace57

# The base image ships busybox wget but no curl.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

# Sets BIFROST_SETUP_TOKEN to the gateway admin password (always: an explicit
# one is replaced), then runs the upstream entrypoint (/app/docker-entrypoint.sh)
# with the upstream command.
# Redeclaring ENTRYPOINT resets the inherited CMD, so it is restated.
COPY --chmod=0555 services/sandbox-llm-gateway/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# /init for Incus, from the tale-init stage (Docker never runs it).
COPY --from=tale-init /init /init

# Keep version metadata after filesystem work so new releases reuse its layers.
# Re-declare VERSION arg (ARGs don't persist after FROM)
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-sandbox-llm-gateway" \
      org.opencontainers.image.description="Tale sandbox LLM gateway — managed provider auth + per-session virtual keys" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.url="https://tale.dev" \
      org.opencontainers.image.documentation="https://docs.tale.dev" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"
LABEL dev.tale.init="dumb-init-1.2.5+maxsig64"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/app/main"]

# Re-assert the upstream image's existing non-root user (uid 1000, owns /app and
# the /app/data SQLite store). The runtime is unchanged — bifrost already runs as
# appuser — but Trivy's static Dockerfile scan can't see the base image's USER,
# so an explicit instruction is needed to satisfy AVD-DS-0002.
USER appuser

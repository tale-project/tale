# Tale Sandbox Spawner
#
# Thin stateless HTTP service. Accepts HMAC-signed /v1/execute calls and
# spawns one ephemeral runtime container per call by talking to the host
# docker daemon.
#
# Security model — `/var/run/docker.sock` is bind-mounted in (see compose.yml).
# Anyone with write access to the socket is effectively root on the host, so
# the spawner runs as root by design: that is the security boundary, not the
# in-container UID. The HMAC on every API call + the loopback-only host port
# (127.0.0.1:8003) keep unauthenticated callers off the socket; trivy is told
# to ignore the non-root warning at the FROM line.
#
# Build (from repo root):
#   docker compose build sandbox
# or directly (CI uses context=., so all COPY paths are repo-root relative):
#   docker build -f services/sandbox/Dockerfile .

ARG VERSION=dev
ARG DOCKER_CLI_VERSION=27

# docker CLI stage — aliased so the runner stage can `COPY --from=docker-cli`
# without variable expansion in `--from=` (BuildKit forbids that and fails the
# build; the workaround is a global-ARG-referencing FROM with a named stage).
FROM docker:${DOCKER_CLI_VERSION}-cli AS docker-cli

# =============================================================================
# Stage 1: BUILDER — install full deps (incl. devDeps) for typecheck/tests
# =============================================================================
FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS builder

WORKDIR /app

# Lockfile + manifest first so the dep layer caches across source edits.
COPY services/sandbox/package.json services/sandbox/bun.lock ./

RUN bun install --frozen-lockfile

COPY services/sandbox/tsconfig.json ./
COPY services/sandbox/src/ ./src/
# The exact shared credential scrubber used by the platform backend too.
COPY packages/shared/src/monitoring/privacy.ts /packages/shared/src/monitoring/privacy.ts

# =============================================================================
# Stage 2: RUNNER — production deps only + docker CLI for spawning siblings
# =============================================================================
# trivy:ignore:AVD-DS-0002 -- runs as root by design; needs /var/run/docker.sock
FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS runner

WORKDIR /app

# docker CLI for spawning sibling containers via the mounted socket. The
# Debian-shipped `docker.io` package is too old (API 1.41; current daemons
# require >=1.44); pull the official static CLI binary instead.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc/* /usr/share/man/* /usr/share/info/*

# Production install: skip devDependencies to keep the runtime image small.
# Lockfile is already validated in the builder stage; --frozen-lockfile here
# guards against a drifted package.json slipping into the runner image.
# TypeScript declarations + sourcemaps in production deps are never read at
# runtime (typecheck runs in CI with full deps, never inside this image) and
# @kubernetes/client-node alone ships tens of MB of them — strip to keep the
# image inside its size budget. Bun hardlinks node_modules out of its install
# cache, so the cache must be removed in the SAME layer or the stripped files
# survive as cache inodes and the image doesn't actually shrink.
COPY services/sandbox/package.json services/sandbox/bun.lock ./
RUN bun install --frozen-lockfile --production \
    && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete \
    && rm -rf /root/.bun/install/cache

COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /packages/shared/src/monitoring/privacy.ts /packages/shared/src/monitoring/privacy.ts

# Two-file entrypoint pair. `docker-entrypoint.sh` owns container-level
# bootstrap (host-side directory perms, env init); `entrypoint.sh` owns
# the app launch and is what gets `exec`'d into PID 1.
COPY services/sandbox/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh

ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-sandbox" \
      org.opencontainers.image.description="Tale Sandbox Spawner — stateless docker-run service for artifact_run" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

# Bun caps fetch at 256 requests in flight by default, and every live exec
# and attach stream holds one to its runnerd for its whole life: past 256 the
# health probes, creates and cancels behind them queue until they time out.
# DOCKER_HOST names the socket every deployment mounts, the one the CLI's
# default context resolves to anyway, so the host probes need no
# `docker context inspect` fork to learn it. An operator's own DOCKER_HOST
# still wins.
ENV TALE_VERSION=${VERSION} \
    SANDBOX_PORT=8003 \
    DO_NOT_TRACK=1 \
    BUN_CONFIG_MAX_HTTP_REQUESTS=1024 \
    DOCKER_HOST=unix:///var/run/docker.sock

EXPOSE 8003

# Healthcheck mirrors compose.yml's external probe so direct `docker run`
# (without compose) gets the same liveness signal: a runc exec every 30 s. No
# --start-interval: the Dockerfile frontend Docker Engine 24 bundles, the
# oldest engine Tale supports, does not know the flag.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s \
  CMD curl -fsS http://127.0.0.1:8003/health || exit 1

# Root by design — see header comment. The docker socket is the boundary.
USER root

ENTRYPOINT ["/docker-entrypoint.sh"]

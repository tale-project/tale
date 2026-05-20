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
ARG BUN_VERSION=1.3.12
ARG DOCKER_CLI_VERSION=27

# docker CLI stage — aliased so the runner stage can `COPY --from=docker-cli`
# without variable expansion in `--from=` (BuildKit forbids that and fails the
# build; the workaround is a global-ARG-referencing FROM with a named stage).
FROM docker:${DOCKER_CLI_VERSION}-cli AS docker-cli

# =============================================================================
# Stage 1: BUILDER — install full deps (incl. devDeps) for typecheck/tests
# =============================================================================
FROM oven/bun:${BUN_VERSION}-debian AS builder

WORKDIR /app

# Lockfile + manifest first so the dep layer caches across source edits.
COPY services/sandbox/package.json services/sandbox/bun.lock ./

RUN bun install --frozen-lockfile

COPY services/sandbox/tsconfig.json ./
COPY services/sandbox/src/ ./src/

# =============================================================================
# Stage 2: RUNNER — production deps only + docker CLI for spawning siblings
# =============================================================================
# trivy:ignore:AVD-DS-0002 -- runs as root by design; needs /var/run/docker.sock
FROM oven/bun:${BUN_VERSION}-debian AS runner

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
COPY services/sandbox/package.json services/sandbox/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json

ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-sandbox" \
      org.opencontainers.image.description="Tale Sandbox Spawner — stateless docker-run service for artifact_run" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"

ENV TALE_VERSION=${VERSION} \
    SANDBOX_PORT=8003 \
    DO_NOT_TRACK=1

EXPOSE 8003

# Healthcheck mirrors compose.yml's external probe so direct `docker run`
# (without compose) gets the same liveness signal.
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=15s \
  CMD curl -fsS http://127.0.0.1:8003/health || exit 1

# Root by design — see header comment. The docker socket is the boundary.
USER root

CMD ["bun", "src/server.ts"]

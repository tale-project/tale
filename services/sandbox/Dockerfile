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

# docker CLI stage — the runner stage copies the binary out of it. The tag names
# the CLI's major line and the digest is what BuildKit pulls. The line takes no
# build argument: it used to, but beside a digest a changed argument would
# silently change nothing. Renovate moves tag and digest together.
FROM docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker-cli

# =============================================================================
# Stage 1: BUILDER — install full deps (incl. devDeps) for typecheck/tests
# =============================================================================
FROM oven/bun:1.4.2-debian@sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73 AS builder

WORKDIR /app

# Lockfile + manifest first so the dep layer caches across source edits.
COPY services/sandbox/package.json services/sandbox/bun.lock ./

# The manifest's one workspace dependency, @tale/incus (the Incus REST client),
# resolves only inside the repository's workspace and has no dependencies of
# its own. The standalone lockfile pins the registry packages alone, so the
# entry leaves the manifest before the frozen install, and the package is
# copied in below, where Bun resolves `@tale/incus` from ./src.
RUN bun -e 'const m = await Bun.file("package.json").json(); delete m.dependencies["@tale/incus"]; await Bun.write("package.json", JSON.stringify(m, null, 2) + "\n");' \
    && bun install --frozen-lockfile

COPY services/sandbox/tsconfig.json ./
COPY services/sandbox/src/ ./src/
COPY packages/incus/package.json ./node_modules/@tale/incus/package.json
COPY packages/incus/src/ ./node_modules/@tale/incus/src/
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
# survive as cache inodes and the image doesn't actually shrink. The manifest
# is the builder's, without its workspace entry; the workspace package comes
# from the builder too.
COPY --from=builder /app/package.json ./package.json
COPY services/sandbox/bun.lock ./
RUN bun install --frozen-lockfile --production \
    && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete \
    && rm -rf /root/.bun/install/cache

COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules/@tale/incus ./node_modules/@tale/incus
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /packages/shared/src/monitoring/privacy.ts /packages/shared/src/monitoring/privacy.ts

# Two-file entrypoint pair. `docker-entrypoint.sh` owns container-level
# bootstrap (host-side directory perms, env init); `entrypoint.sh` owns
# the app launch and is what gets `exec`'d into PID 1.
COPY services/sandbox/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/sandbox/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh

# /init for Incus, from the tale-init stage (Docker never runs it).
COPY --from=tale-init /init /init

ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.title="tale-sandbox" \
      org.opencontainers.image.description="Tale Sandbox Spawner — stateless docker-run service for artifact_run" \
      org.opencontainers.image.source="https://github.com/tale-project/tale" \
      org.opencontainers.image.url="https://tale.dev" \
      org.opencontainers.image.documentation="https://docs.tale.dev" \
      org.opencontainers.image.vendor="Tale" \
      org.opencontainers.image.licenses="MIT"
LABEL dev.tale.init="dumb-init-1.2.5+maxsig64"

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

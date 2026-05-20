# Tale Sandbox Spawner
#
# Thin stateless HTTP service. Mounts /var/run/docker.sock (host root —
# see plan "Security model" for the explicit threat acceptance), accepts
# HMAC-signed /v1/execute calls, builds one ephemeral container per call.
#
# Runs as root by design: needs to talk to /var/run/docker.sock to spawn
# sibling runtime containers. The docker socket is the security boundary,
# not the in-container UID.

# trivy:ignore:AVD-DS-0002 -- runs as root by design; needs /var/run/docker.sock
FROM oven/bun:1.1-debian

WORKDIR /app

# docker CLI for spawning sibling containers via mounted socket. The
# Debian-shipped `docker.io` package is API 1.41 (too old; current
# daemons require ≥1.44). Pull the official static CLI binary instead.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb* tsconfig.json /app/
RUN bun install --frozen-lockfile || bun install

COPY src/ /app/src/

EXPOSE 8003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD curl -fsS http://127.0.0.1:8003/health || exit 1

CMD ["bun", "src/server.ts"]

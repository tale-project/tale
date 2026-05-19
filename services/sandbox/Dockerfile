# Tale Sandbox Spawner
#
# Thin stateless HTTP service. Mounts /var/run/docker.sock (host root —
# see plan "Security model" for the explicit threat acceptance), accepts
# HMAC-signed /v1/execute calls, builds one ephemeral container per call.

FROM oven/bun:1.1-debian

WORKDIR /app

# docker CLI for spawning sibling containers via mounted socket.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      docker.io \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb* tsconfig.json /app/
RUN bun install --frozen-lockfile || bun install

COPY src/ /app/src/

EXPOSE 8003

HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=5s \
  CMD curl -fsS http://127.0.0.1:8003/health || exit 1

CMD ["bun", "src/server.ts"]

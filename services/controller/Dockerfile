# Tale Controller — privileged control-plane sidecar.
#
# Restarts allowlisted compose services ({rag, convex}) on an HMAC-signed
# request so a deployment-config change takes effect. Mounts /var/run/docker.sock
# (see compose.yml) — host root, the same accepted boundary as the sandbox
# spawner — but constrained to list+restart of two services. Reachable only on
# the internal network; every call is HMAC-verified.
#
# Build (from repo root — context is `.` so COPY paths are repo-root relative):
#   docker compose --profile controller build controller
#   docker build -f services/controller/Dockerfile .
#
# Zero runtime dependencies → no `bun install` needed; Bun runs the TS directly.

ARG BUN_VERSION=1.3.12

# trivy:ignore:AVD-DS-0002 -- runs as root by design; needs /var/run/docker.sock
FROM oven/bun:${BUN_VERSION}-debian AS runner

WORKDIR /app

COPY services/controller/package.json ./
COPY services/controller/src/ ./src/

ENV CONTROLLER_PORT=8004
EXPOSE 8004

CMD ["bun", "src/server.ts"]

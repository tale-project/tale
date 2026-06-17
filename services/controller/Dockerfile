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

# Two-file entrypoint pair. `docker-entrypoint.sh` owns container-level
# bootstrap and `exec`s `entrypoint.sh` (the app launch) so SIGTERM reaches Bun
# directly. See the script headers for the split rationale.
COPY services/controller/docker-entrypoint.sh /docker-entrypoint.sh
COPY services/controller/entrypoint.sh /entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /entrypoint.sh

ENV CONTROLLER_PORT=8004
EXPOSE 8004

# Healthcheck mirrors compose.yml's external probe so a direct `docker run`
# (without compose) gets the same liveness signal. No curl in the image — Bun's
# fetch reaches the in-process /health endpoint (which also pings the socket).
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD bun -e 'const r=await fetch("http://127.0.0.1:8004/health");process.exit(r.ok?0:1)' || exit 1

# Root by design — see the header comment. The mounted docker socket is the
# security boundary, not the in-container UID. DS-0002 is accepted, scoped to
# this Dockerfile, in .trivyignore.yaml.
USER root

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "src/server.ts"]

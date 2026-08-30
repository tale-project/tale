import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

/**
 * Sandbox spawner — thin stateless docker-run service.
 *
 * SECURITY: mounts /var/run/docker.sock so it can spawn sibling containers.
 * docker.sock = host root; this is the explicit security boundary the
 * sandbox plan accepts. The spawner accepts only HMAC-signed typed JSON
 * over HTTP (reachable only on the `internal` network), and the docker
 * argv builder validates every identifier with strict regexes so a
 * malformed input never reaches `docker run` (see
 * services/sandbox/src/docker-args.ts).
 *
 * Joined to BOTH networks:
 *   - `internal` — so the platform container can reach it on
 *     http://sandbox:8003.
 *   - `sandbox` — so the per-call runtime containers it spawns can be
 *     attached to the internal-only egress bridge.
 *
 * Single container (blue-green dropped): the backend addresses it by the bare
 * `sandbox` alias on `internal` (the compose service-key alias), and it talks
 * to its egress sidecar via the bare `sandbox-egress` alias on the shared
 * sandbox network. A deploy rolls it in place after draining via /v1/drain
 * (drainSandbox, deploy.ts).
 *
 * Operators wanting stronger isolation set SANDBOX_RUNTIME=runsc and
 * install gVisor on the host; the spawner picks the runtime via env.
 */
export function createSandboxService(config: ServiceConfig): ComposeService {
  return {
    image: imageRef(config, 'sandbox'),
    container_name: `${getProjectId()}-sandbox`,
    // Graceful drain on stop: the spawner's SIGTERM handler stops accepting new
    // executions, cancels in-flight ones, and waits up to ~20s for them to tear
    // down (services/sandbox/src/cleanup.ts installSignalHandlers). Give Docker
    // a grace window past that deadline so a roll drains cleanly instead of
    // SIGKILL'ing mid-execution. The deploy drains via /v1/drain first
    // (drainSandbox, deploy.ts); this is the backstop.
    stop_grace_period: '30s',
    // NOTE: no published `ports` here. The backend (in-container, stateful
    // compose) reaches the spawner via the `internal` Docker network at
    // http://sandbox:8003 — publishing a host-side port is unnecessary
    // attack surface in production (the spawner mounts /var/run/docker.sock,
    // so any reachable peer is effectively host-root). The dev compose
    // generator overlays `127.0.0.1:8003:8003` so that `bun dev` with the backend
    // running on the host can reach the spawner.
    // Per-container resource caps. The spawner is a thin Bun HTTP server
    // that issues `docker` subprocess calls; 512 MB is generous for the
    // server itself but excludes the runtime containers it spawns (those
    // get their own caps via `--memory=1g` in docker-args.ts). pids_limit
    // bounds the docker-CLI fanout under a fork-bomb regression; the
    // nofile bump leaves room for many in-flight SSE streams.
    mem_limit: '512m',
    pids_limit: 512,
    ulimits: {
      nofile: { soft: 4096, hard: 8192 },
    },
    env_file: ['.env'],
    environment: {
      SANDBOX_RUNTIME: '${SANDBOX_RUNTIME:-runc}',
      // Native docker/docker compose inside session containers. Unset so the
      // spawner applies its tier-aware default (on for sysbox/kata, off for
      // runc/gvisor); set SANDBOX_DOCKER_IN_CONTAINER (or the deployment.json
      // sandboxRuntime section) to force it.
      SANDBOX_DOCKER_IN_CONTAINER: '${SANDBOX_DOCKER_IN_CONTAINER:-}',
      SANDBOX_RUNTIME_IMAGE:
        '${SANDBOX_RUNTIME_IMAGE:-tale-sandbox-runtime:latest}',
      // Shared cross-session docker build cache. Unset here so the spawner
      // applies its default (follows SANDBOX_DOCKER_IN_CONTAINER — on whenever
      // DinD is on); set SANDBOX_DOCKER_BUILD_CACHE=true/false (or the
      // deployment.json sandboxRuntime section) to force it. The image refs the
      // spawner `docker run`s for the shared buildkitd + its pull-through
      // registry mirror; defaults match `tale deploy`'s re-tag (deploy.ts) and
      // stock `registry:2`, overridable for a pinned/mirrored ref in fenced
      // deploys (the spawner pulls the mirror at runtime — deploy.ts does not).
      SANDBOX_DOCKER_BUILD_CACHE: '${SANDBOX_DOCKER_BUILD_CACHE:-}',
      SANDBOX_BUILDKITD_IMAGE:
        '${SANDBOX_BUILDKITD_IMAGE:-tale-sandbox-buildkitd:latest}',
      SANDBOX_BUILDKITD_MIRROR_IMAGE:
        '${SANDBOX_BUILDKITD_MIRROR_IMAGE:-registry:2}',
      // Live browser view (read-only mirror). Unset here so BOTH sides apply
      // their default-ON; set SANDBOX_BROWSER_VIEW=0 (or false/no/off) to opt
      // out. ONE value drives both sides — this spawner reads it directly and
      // the backend reads it from its environment — and it is read on the platform
      // service too (NOT a sandbox-only var), so both interpolate from the same
      // root .env to stay in lockstep. Mirrors compose.yml.
      SANDBOX_BROWSER_VIEW: '${SANDBOX_BROWSER_VIEW:-}',
      // Shared sandbox network; the egress sidecar is addressed by its bare
      // `sandbox-egress` alias so spawned runtime containers route outbound
      // through it.
      SANDBOX_EGRESS_NETWORK: 'tale-sandbox-net',
      SANDBOX_EGRESS_PROXY: 'http://sandbox-egress:3128',
    },
    volumes: [
      '/var/run/docker.sock:/var/run/docker.sock',
      // 1:1 bind so per-call workspace dirs created by the spawner are
      // visible to the docker daemon at the same host path when it mounts
      // them into the runtime container.
      '/var/lib/tale-sandbox:/var/lib/tale-sandbox',
      // Read-only deployment config so loadConfig reads the sandboxRuntime tier
      // from deployment.json (same shared volume as rag/platform; R2-B11 lockstep
      // with compose.yml).
      '${PLATFORM_SHARED_CONFIG:-convex-data}:/app/platform-config:ro',
    ],
    restart: 'unless-stopped',
    healthcheck: {
      test: ['CMD', 'curl', '-fsS', 'http://127.0.0.1:8003/health'],
      interval: '10s',
      timeout: '5s',
      retries: 3,
      start_period: '15s',
    },
    depends_on: {
      'sandbox-egress': { condition: 'service_healthy' },
    },
    logging: DEFAULT_LOGGING,
    // The backend reaches the spawner on `internal` via the bare `sandbox`
    // compose service-key alias (single container — blue-green dropped).
    networks: ['internal', 'sandbox'],
  };
}

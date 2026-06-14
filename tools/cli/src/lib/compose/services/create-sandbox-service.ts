import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

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
 * Operators wanting stronger isolation set SANDBOX_RUNTIME=runsc and
 * install gVisor on the host; the spawner picks the runtime via env.
 */
export function createSandboxService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-sandbox:${config.version}`,
    container_name: `${getProjectId()}-sandbox`,
    // NOTE: no published `ports` here. Convex (in-container, stateful
    // compose) reaches the spawner via the `internal` Docker network at
    // http://sandbox:8003 — publishing a host-side port is unnecessary
    // attack surface in production (the spawner mounts /var/run/docker.sock,
    // so any reachable peer is effectively host-root). The dev compose
    // generator overlays `127.0.0.1:8003:8003` so that `bun dev` with Convex
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
      // Native docker/docker compose inside session containers (off by default;
      // only valid on a sysbox/kata tier — the spawner fails closed otherwise).
      // The deployment.json sandboxRuntime section overrides both of these.
      SANDBOX_DOCKER_IN_CONTAINER: '${SANDBOX_DOCKER_IN_CONTAINER:-false}',
      SANDBOX_RUNTIME_IMAGE:
        '${SANDBOX_RUNTIME_IMAGE:-tale-sandbox-runtime:latest}',
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
    networks: ['internal', 'sandbox'],
  };
}

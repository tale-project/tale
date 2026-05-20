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
    // Bind to host loopback ONLY. The spawner mounts /var/run/docker.sock
    // and (in dev opt-in unauth mode) is reachable without HMAC; exposing
    // it on 0.0.0.0 would be remote root via docker.sock to any peer that
    // can route to the host. Convex reaches the spawner through the
    // `internal` Docker network (http://sandbox:8003), not this published
    // port. The loopback bind is for `bun dev` running convex on the host.
    ports: ['127.0.0.1:8003:8003'],
    env_file: ['.env'],
    environment: {
      SANDBOX_RUNTIME: '${SANDBOX_RUNTIME:-runc}',
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

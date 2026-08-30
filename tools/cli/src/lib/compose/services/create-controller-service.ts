import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * Controller — privileged control-plane sidecar (OPT-IN).
 *
 * Restarts the allowlisted compose services {backend-api, backend-worker,
 * sandbox} on an HMAC-signed request so a deployment-config change (external
 * knowledge Postgres / object storage) takes effect — WITHOUT giving the
 * browser-facing platform docker-socket access.
 *
 * SECURITY: mounts /var/run/docker.sock = host root, the same accepted
 * boundary as the sandbox spawner, but far more constrained — list+restart of
 * those services only (no run/exec), HMAC-verified, internal-network-only, no
 * published port. Emitted only when CONTROLLER_TOKEN is set (the shared HMAC
 * secret); the platform and backend sign restart requests with the same
 * token. The allowlist itself lives in services/controller/src/server.ts.
 *
 * COMPOSE_PROJECT_NAME scopes restarts to this project so another stack on the
 * same host is never touched.
 */
export function createControllerService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-controller:${config.version}`,
    container_name: `${getProjectId()}-controller`,
    mem_limit: '256m',
    pids_limit: 256,
    env_file: ['.env'],
    environment: {
      CONTROLLER_PORT: '8004',
      COMPOSE_PROJECT_NAME: getProjectId(),
    },
    volumes: ['/var/run/docker.sock:/var/run/docker.sock'],
    restart: 'unless-stopped',
    healthcheck: {
      // No curl in the bun image; probe /health with bun itself.
      test: [
        'CMD',
        'bun',
        '-e',
        'const r=await fetch("http://127.0.0.1:8004/health");process.exit(r.ok?0:1)',
      ],
      interval: '30s',
      timeout: '5s',
      retries: 3,
      start_period: '10s',
    },
    logging: DEFAULT_LOGGING,
    networks: ['internal'],
  };
}

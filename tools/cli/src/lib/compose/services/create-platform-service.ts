import { THREE_WAY } from '../app-tier';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';
import { createPlatformBackendService } from './create-backend-services';
import { memoryReservation } from './memory-env';
import { platformLabels } from './traefik-labels';

/**
 * `platform`, as one colour's replica template: the whole application or
 * the API with the pages where the colour's shape says so (app-tier.ts,
 * `createPlatformBackendService`), and otherwise the web tier alone, below.
 *
 * NO `container_name`: `docker compose --scale` cannot replicate a service
 * whose name is pinned, and the colour's compose project already carries the
 * colour, so every replica is `<project>-<colour>-platform-<n>`. Callers
 * address them by compose label (`list-service-containers.ts`), never by a
 * reconstructed name.
 */
export function createPlatformService(
  config: ServiceConfig,
  color: DeploymentColor,
): ComposeService {
  const role = (config.appTier ?? THREE_WAY).roles.platform ?? 'web';
  if (role === 'all' || role === 'api')
    return createPlatformBackendService(config, color, role);
  return {
    image: imageRef(config, 'platform'),
    labels: platformLabels(color),
    // /app/data is the org config store, mounted read-only so server.ts can
    // watch config files and serve branding images. Platform mounts none of
    // the proxy's volumes (zero outbound HTTPS).
    volumes: ['config-data:/app/data:ro', 'static-assets:/app/static-assets'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Graceful shutdown budget. Told to stop, the web tier keeps answering
    // for SHUTDOWN_DRAIN_SECONDS (6) so the proxy stops routing, then closes
    // its listener within five more (services/platform/backend/web-main.ts);
    // an image from before it moved onto the backend's process took up to
    // 41 s for the same. Without this, Docker's default 10s grace SIGKILLs
    // the old colour mid-drain on a blue-green flip, cutting in-flight
    // HTTP/SSE streams. `docker stop` (no -t, see stop-container.ts) honors
    // this StopTimeout — the same mechanism the sandbox tier relies on
    // (create-sandbox-service.ts).
    stop_grace_period: '45s',
    // Spared by reclaim while sandbox sessions press on host memory, per
    // replica, where the engine runs cgroup v2. Mirrored in compose.yml.
    ...memoryReservation('platform', config),
    healthcheck: {
      test: [
        'CMD-SHELL',
        'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]',
      ],
      interval: '5s',
      timeout: '3s',
      retries: 3,
      start_period: '180s',
    },
    // Cross-compose dependencies (db, proxy) are handled by the CLI's deploy
    // ordering: stateful services are deployed and health-checked before any
    // colour starts. `depends_on` could not express them anyway — the colour
    // is its own compose project, and compose has no cross-project deps.
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ['platform', `platform-${color}`],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

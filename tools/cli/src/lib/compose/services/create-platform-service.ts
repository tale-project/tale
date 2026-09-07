import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

/**
 * The web tier, as one colour's replica template.
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
  return {
    image: imageRef(config, 'platform'),
    // /app/data is the org config store, mounted read-only so server.ts can
    // watch config files and serve branding images. Platform does not mount
    // caddy-data any more (zero outbound HTTPS).
    volumes: ['config-data:/app/data:ro'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Graceful shutdown budget. The entrypoint's SIGTERM trap
    // (services/platform/docker-entrypoint.sh) drains for
    // SHUTDOWN_DRAIN_SECONDS (6) so the proxy stops routing, waits
    // SHUTDOWN_GRACE_SECONDS (5) for in-flight requests, then gives Vite up to
    // SHUTDOWN_TIMEOUT_SECONDS (30) to exit = ~41s worst case. Without this,
    // Docker's default 10s grace SIGKILLs the old colour mid-drain on a
    // blue-green flip, cutting in-flight HTTP/SSE chat streams. `docker stop`
    // (no -t, see stop-container.ts) honors this StopTimeout — the same
    // mechanism the sandbox tier relies on (create-sandbox-service.ts). Keep
    // this >= the SHUTDOWN_* budget; bump it if those defaults grow.
    stop_grace_period: '45s',
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

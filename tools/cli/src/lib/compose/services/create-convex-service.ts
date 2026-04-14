import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * Convex service (Phase 2+). Runs convex-local-backend + Dashboard as an
 * independent data-plane container. Platform pushes schema + env remotely.
 *
 * Note: Convex is a singleton (like a Postgres primary) — it does NOT follow
 * the blue/green pattern. Both platform colors point at the same convex
 * instance. Docker restart policy handles crash recovery.
 */
export function createConvexService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-convex:${config.version}`,
    container_name: `${getProjectId()}-convex`,
    volumes: ['convex-data:/app/data', 'caddy-data:/caddy-data:ro'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    // start_period covers cold-boot with search-index warmup; platform's
    // wait_for_http for convex is 120s, so align here to avoid a window
    // where Docker flags convex healthy before indexes are queryable.
    healthcheck: {
      test: [
        'CMD-SHELL',
        'curl -sf http://localhost:3210/version && [ -f /tmp/convex-ready ]',
      ],
      interval: '5s',
      timeout: '3s',
      retries: 3,
      start_period: '120s',
    },
    // Convex needs the Postgres backend up before it can boot.
    depends_on: {
      db: { condition: 'service_healthy' },
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ['convex'],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

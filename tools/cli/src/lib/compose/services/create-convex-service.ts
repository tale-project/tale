import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * Convex service (Phase 2+). Runs convex-local-backend + Dashboard as an
 * independent data-plane container. Platform pushes schema + env remotely.
 *
 * Note: Convex is a singleton (like a Postgres primary) — it does NOT follow
 * the blue/green pattern. Both platform colors point at the same convex
 * instance. Docker restart policy handles crash recovery.
 *
 * The `color` parameter is currently ignored but kept in the signature so
 * callers can stay uniform; only one convex container exists per project.
 */
export function createConvexService(
  config: ServiceConfig,
  _color: DeploymentColor,
): ComposeService {
  return {
    image: `${config.registry}/tale-convex:${config.version}`,
    container_name: `${getProjectId()}-convex`,
    volumes: ['convex-data:/app/data', 'caddy-data:/caddy-data:ro'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    healthcheck: {
      test: [
        'CMD-SHELL',
        'curl -sf http://localhost:3210/version && [ -f /tmp/convex-ready ]',
      ],
      interval: '5s',
      timeout: '3s',
      retries: 3,
      start_period: '60s',
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

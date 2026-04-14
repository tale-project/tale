import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

export function createPlatformService(
  config: ServiceConfig,
  color: DeploymentColor,
): ComposeService {
  return {
    image: `${config.registry}/tale-platform:${config.version}`,
    container_name: `${getProjectId()}-platform-${color}`,
    // Phase 2 (split): /app/data lives in convex-data, mounted read-only so
    // server.ts can watch config files and serve branding images. Platform
    // does not mount caddy-data any more (zero outbound HTTPS).
    volumes: ['convex-data:/app/data:ro'],
    env_file: ['.env'],
    restart: 'unless-stopped',
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
    // Cross-compose dependencies (db, convex, proxy) are handled by the
    // CLI's deploy ordering: stateful services are deployed and health-checked
    // before color services start. Only declare intra-compose dependencies.
    depends_on: {
      [`rag-${color}`]: { condition: 'service_healthy' },
      [`crawler-${color}`]: { condition: 'service_healthy' },
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ['platform', `platform-${color}`],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

export function createCrawlerService(
  config: ServiceConfig,
  color: DeploymentColor,
): ComposeService {
  return {
    image: `${config.registry}/tale-crawler:${config.version}`,
    container_name: `${getProjectId()}-crawler-${color}`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    healthcheck: {
      test: ['CMD', 'curl', '-f', 'http://localhost:8002/health'],
      interval: '5s',
      timeout: '3s',
      retries: 2,
      start_period: '40s',
    },
    // Phase 2 (split): platform-config source moved from platform-data to
    // convex-data (see create-rag-service for rationale).
    volumes: ['crawler-data:/app/data', 'convex-data:/app/platform-config:ro'],
    // Cross-compose dependencies (db, convex) are handled by the CLI's
    // deploy ordering: stateful services are health-checked before color
    // services start.
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ['crawler', `crawler-${color}`],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

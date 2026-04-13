import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

export function createRagService(
  config: ServiceConfig,
  color: DeploymentColor,
): ComposeService {
  return {
    image: `${config.registry}/tale-rag:${config.version}`,
    container_name: `${getProjectId()}-rag-${color}`,
    // Phase 2 (split): platform-config (providers/*.json) lives in the
    // convex-data volume now. Keep the in-container path unchanged so the
    // Python code that reads TALE_PLATFORM_SHARED_CONFIG_DIR doesn't need to
    // change.
    volumes: ['rag-data:/app/data', 'convex-data:/app/platform-config:ro'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    healthcheck: {
      test: ['CMD', 'curl', '-f', 'http://localhost:8001/health'],
      interval: '5s',
      timeout: '3s',
      retries: 2,
      start_period: '40s',
    },
    // Wait for convex to seed providers/*.json into the shared volume before
    // mounting it.
    depends_on: {
      db: { condition: 'service_healthy' },
      convex: { condition: 'service_healthy' },
    },
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ['rag', `rag-${color}`],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

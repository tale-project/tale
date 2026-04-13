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
    volumes: ['rag-data:/app/data', 'platform-data:/app/platform-config:ro'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    healthcheck: {
      test: ['CMD', 'curl', '-f', 'http://localhost:8001/health'],
      interval: '5s',
      timeout: '3s',
      retries: 2,
      start_period: '40s',
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

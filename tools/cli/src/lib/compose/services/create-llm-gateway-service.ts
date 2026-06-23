import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * LLM gateway service. Fronts every model provider with a single
 * OpenAI-compatible endpoint, mints per-session virtual keys, and is the
 * single source of truth for usage accounting. Built on the upstream
 * maximhq/bifrost core.
 *
 * Joined to BOTH networks:
 *   - `internal` — so the platform / convex containers can reach it on
 *     http://llm-gateway:8080.
 *   - `sandbox` — so in-sandbox agents routed through EXTERNAL_AGENT_GATEWAY_URL
 *     can reach the gateway from the sandbox bridge.
 */
export function createLlmGatewayService(config: ServiceConfig): ComposeService {
  return {
    image: `${config.registry}/tale-llm-gateway:${config.version}`,
    container_name: `${getProjectId()}-llm-gateway`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    mem_limit: '512m',
    volumes: ['llm-gateway-data:/app/data'],
    healthcheck: {
      test: [
        'CMD-SHELL',
        'wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1',
      ],
      interval: '10s',
      timeout: '5s',
      retries: 3,
      start_period: '15s',
    },
    logging: DEFAULT_LOGGING,
    networks: { internal: {}, sandbox: {} },
  };
}

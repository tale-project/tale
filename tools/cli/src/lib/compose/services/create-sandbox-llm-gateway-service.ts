import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

/**
 * Sandbox LLM gateway service. Fronts every model provider with a single
 * OpenAI-compatible endpoint, mints per-session virtual keys, and is the
 * single source of truth for usage accounting for in-sandbox coding agents.
 * Built on the upstream maximhq/bifrost core.
 *
 * Joined to BOTH networks:
 *   - `internal` — so the platform / convex containers can reach it on
 *     http://sandbox-llm-gateway:8080.
 *   - `sandbox` — so in-sandbox agents routed through EXTERNAL_AGENT_GATEWAY_URL
 *     can reach the gateway from the sandbox bridge.
 *
 * The data volume keeps its pre-rename name (`llm-gateway-data`) so the service
 * rename needs no data migration of its SQLite store, which holds what the
 * platform cannot re-derive (the admin account, minted keys with their spend,
 * the request log) and which snapshots capture (GATEWAY_VOLUME in
 * ../../backup/constants.ts). The transitional `llm-gateway` network
 * alias keeps the old hostname resolving for one release so in-flight sessions
 * survive the deploy that lands the rename.
 *
 * The `.env` it reads carries SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD, which the
 * gateway image turns into its setup token: a fresh gateway creates its admin
 * account only for a platform that presents it.
 */
export function createSandboxLlmGatewayService(
  config: ServiceConfig,
): ComposeService {
  return {
    image: imageRef(config, 'sandbox-llm-gateway'),
    container_name: `${getProjectId()}-sandbox-llm-gateway`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Graceful drain on stop: on SIGTERM the gateway stops taking new calls,
    // waits for the ones in flight (streamed answers included) to finish, and
    // then writes its in-memory budget counters, the spend the platform
    // books, to its store. Docker's 10s default would cut every model stream
    // still running 10s into a deploy's stop, and kill the gateway before
    // that write; 90s lets an ordinary model call finish.
    stop_grace_period: '90s',
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
    networks: {
      internal: { aliases: ['llm-gateway'] },
      sandbox: { aliases: ['llm-gateway'] },
    },
  };
}

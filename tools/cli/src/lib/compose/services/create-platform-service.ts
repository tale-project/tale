import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

export function createPlatformService(
  config: ServiceConfig,
  color: DeploymentColor,
): ComposeService {
  return {
    image: imageRef(config, 'platform'),
    container_name: `${getProjectId()}-platform-${color}`,
    // Phase 2 (split): /app/data lives in convex-data, mounted read-only so
    // server.ts can watch config files and serve branding images. Platform
    // does not mount caddy-data any more (zero outbound HTTPS).
    volumes: ['convex-data:/app/data:ro'],
    env_file: ['.env'],
    // Live browser view (read-only mirror). Read here too — the entrypoint
    // pushes it to Convex (run_external_agent gates on it) and the sandbox
    // spawner reads the SAME var, so the two MUST stay in lockstep. Unset ⇒
    // default ON; set SANDBOX_BROWSER_VIEW=0 (or false/no/off) to opt out.
    // Interpolates from the same root .env as the sandbox service so one value
    // drives both; empty ⇒ the entrypoint skips pushing it, leaving the
    // Convex-side default ON. Mirrors compose.yml.
    environment: {
      SANDBOX_BROWSER_VIEW: '${SANDBOX_BROWSER_VIEW:-}',
    },
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
    // Cross-compose dependencies (db, convex, proxy) are handled by the
    // CLI's deploy ordering: stateful services are deployed and health-checked
    // before color services start. Platform now has no intra-compose
    // dependencies (rag/crawler ran in-process inside the Convex backend),
    // so no `depends_on` is emitted.
    logging: DEFAULT_LOGGING,
    networks: {
      internal: {
        aliases: ['platform', `platform-${color}`],
      },
    },
    extra_hosts: EXTRA_HOSTS,
  };
}

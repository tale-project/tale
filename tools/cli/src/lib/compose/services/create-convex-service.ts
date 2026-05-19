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
    // NET_ADMIN: required for the entrypoint's SSRF egress firewall
    // (iptables REJECT rules for IMDS + link-local + RFC1918). Without
    // this cap, services/convex/docker-entrypoint.sh:79 logs a warning
    // and skips the firewall — yt-dlp's own DNS resolution then becomes
    // a DNS-rebinding SSRF vector against the host's cloud metadata
    // service. The compose.yml had this all along; the CLI generator
    // was silently dropping it (R1.17). Bonus fix surfaced by the
    // sandbox review.
    cap_add: ['NET_ADMIN'],
    // Per-container resource caps. yt-dlp + ffmpeg subprocesses peak
    // ~300-500 MB each; APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=32 means
    // the worst case is 32 parallel ingest jobs. mem_limit caps blast
    // radius; pids_limit defends against fork-bomb regressions; nofile
    // gives breathing room for concurrent yt-dlp + ffmpeg + Convex.
    mem_limit: '12g',
    pids_limit: 4096,
    ulimits: {
      nofile: { soft: 65536, hard: 65536 },
    },
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

import { getProjectId } from '../../../utils/load-env';
import { EXTRA_HOSTS } from '../generators/constants';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/** The api's container port — the proxy's `BACKEND_UPSTREAM` target. */
export const BACKEND_API_PORT = 3005;

function backendBase(config: ServiceConfig): ComposeService {
  return {
    // The SAME image as platform: the backend and the web tier share their
    // wire contracts, so they must never version-skew.
    image: `${config.registry}/tale-platform:${config.version}`,
    // NET_ADMIN: the entrypoint installs the SSRF egress firewall (iptables
    // REJECT for IMDS + link-local + RFC1918) before dropping privileges.
    // This tier opens sockets outside the pinned-IP fetch path (yt-dlp,
    // ffmpeg, the crawler's fetch/render lane), so a DNS rebind would
    // otherwise be an SSRF vector against the host's metadata service.
    cap_add: ['NET_ADMIN'],
    // yt-dlp + ffmpeg subprocesses peak ~300-500 MB each and ingest runs
    // concurrently; the cap bounds the blast radius, pids_limit defends
    // against a fork-bomb regression, nofile covers concurrent sockets.
    mem_limit: '12g',
    pids_limit: 4096,
    ulimits: {
      nofile: { soft: 65536, hard: 65536 },
    },
    // The org config store — this tier OWNS every write to it (governance
    // policies, SSO connection files, provider/agent/skill trees); the web
    // tier mounts the same volume read-only.
    volumes: ['convex-data:/app/data'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    depends_on: {
      db: { condition: 'service_healthy' },
    },
    logging: DEFAULT_LOGGING,
    extra_hosts: EXTRA_HOSTS,
  };
}

/**
 * The api role: every application door (the app API, auth, the hint stream,
 * the machine doors, the in-sandbox bridges).
 *
 * A singleton like the database it fronts — it is NOT blue/green: both
 * platform colors point at the same api. Dual-homed onto the sandbox network
 * so a session container reaches the connectors bridge and the live-body
 * host-call door directly, the way it reached Convex before.
 */
export function createBackendApiService(config: ServiceConfig): ComposeService {
  return {
    ...backendBase(config),
    container_name: `${getProjectId()}-backend-api`,
    environment: {
      TALE_ROLE: 'api',
      PORT: String(BACKEND_API_PORT),
      TALE_CONFIG_DIR: '/app/data',
      SANDBOX_HTTP_API_BASE_URL: `http://backend-api:${BACKEND_API_PORT}`,
      // The bundled blob store the backend seeds the deployment default
      // against at boot. Internal address: presigned URLs are signed here
      // and forwarded by the proxy, so the store is never published.
      OBJECT_STORE_ENDPOINT: 'http://object-store:9000',
      OBJECT_STORE_BUCKET: '${OBJECT_STORE_BUCKET:-tale-blobs}',
      OBJECT_STORE_ACCESS_KEY: '${OBJECT_STORE_ACCESS_KEY:-tale}',
      OBJECT_STORE_SECRET_KEY:
        '${OBJECT_STORE_SECRET_KEY:?OBJECT_STORE_SECRET_KEY is required}',
    },
    healthcheck: {
      test: ['CMD-SHELL', `curl -sf http://localhost:${BACKEND_API_PORT}/ping`],
      interval: '10s',
      timeout: '3s',
      retries: 3,
      start_period: '30s',
    },
    networks: {
      internal: { aliases: ['backend-api'] },
      sandbox: { aliases: ['backend-api'] },
    },
  };
}

/**
 * The worker role: the job runner (schedules, watchdogs, agent turns). It
 * exposes no HTTP, so the image's baked web healthcheck would read
 * permanently unhealthy — liveness is the worker's own heartbeat plus
 * at-least-once job recovery.
 */
export function createBackendWorkerService(
  config: ServiceConfig,
): ComposeService {
  return {
    ...backendBase(config),
    container_name: `${getProjectId()}-backend-worker`,
    environment: {
      TALE_ROLE: 'worker',
      TALE_CONFIG_DIR: '/app/data',
      SANDBOX_HTTP_API_BASE_URL: `http://backend-api:${BACKEND_API_PORT}`,
      // The bundled blob store the backend seeds the deployment default
      // against at boot. Internal address: presigned URLs are signed here
      // and forwarded by the proxy, so the store is never published.
      OBJECT_STORE_ENDPOINT: 'http://object-store:9000',
      OBJECT_STORE_BUCKET: '${OBJECT_STORE_BUCKET:-tale-blobs}',
      OBJECT_STORE_ACCESS_KEY: '${OBJECT_STORE_ACCESS_KEY:-tale}',
      OBJECT_STORE_SECRET_KEY:
        '${OBJECT_STORE_SECRET_KEY:?OBJECT_STORE_SECRET_KEY is required}',
    },
    healthcheck: { disable: true },
    networks: {
      internal: { aliases: ['backend-worker'] },
    },
  };
}

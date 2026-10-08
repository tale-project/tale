import { getProjectId } from '../../../utils/load-env';
import {
  BUNDLED_OBJECT_STORE_ENDPOINT,
  EXTRA_HOSTS,
} from '../generators/constants';
import type { ComposeService, DeploymentColor, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

/** The api's container port — the proxy's `BACKEND_UPSTREAM` target. */
const BACKEND_API_PORT = 3005;

/**
 * How a backend role is being deployed.
 *
 * `colour` present — the role runs inside a colour's compose project: no
 * pinned name (so `--scale` can replicate it), no `depends_on` (the database
 * lives in ANOTHER compose project and cross-project dependencies do not
 * exist), and `TALE_COLOR` set so the process knows which colour a drain is
 * aimed at. Absent — the dev fleet's single named container, which does have
 * its dependencies in the same file.
 */
export interface BackendServiceOptions {
  colour?: DeploymentColor;
}

/** The api's stop grace, in seconds, under its default 15 s drain. */
const BACKEND_API_STOP_GRACE_S = 30;
/** The worker's stop grace, in seconds, under its default 90 s drain. */
export const BACKEND_WORKER_STOP_GRACE_S = 120;
/** How far a role's stop grace stays above its drain budget. */
const STOP_GRACE_ABOVE_DRAIN_S = 15;

/**
 * How long `docker stop` waits for a backend role before SIGKILL: the role's
 * own grace, or 15 s above the operator's `SHUTDOWN_DRAIN_MS` when that drain
 * is longer — a grace below the drain would kill the process in the middle
 * of it, with nothing in its log saying why. Read from `process.env`, where
 * `loadEnv` has folded the project's `.env`; a value the backend would
 * refuse at boot keeps the default.
 */
export function backendStopGraceSeconds(defaultSeconds: number): number {
  const raw = process.env.SHUTDOWN_DRAIN_MS?.trim() ?? '';
  const drainMs = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(drainMs) || drainMs <= 0) return defaultSeconds;
  return Math.max(
    defaultSeconds,
    Math.ceil(drainMs / 1000) + STOP_GRACE_ABOVE_DRAIN_S,
  );
}

function backendBase(
  config: ServiceConfig,
  service: 'backend-api' | 'backend-worker',
  options: BackendServiceOptions,
): ComposeService {
  return {
    // The SAME image as platform (imageRepoForService maps the backend tier
    // to it): the backend and the web tier share their wire contracts, so
    // they must never version-skew.
    image: imageRef(config, service),
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
    volumes: ['config-data:/app/data'],
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Both roles seed the deployment-default blob connection at boot —
    // without the store they crash-loop on ENOTFOUND. Inside a colour the
    // store is in another compose project, so the ordering is the deploy's
    // (stateful tier healthy before any colour starts) rather than compose's.
    ...(options.colour === undefined
      ? {
          depends_on: {
            db: { condition: 'service_healthy' },
            'object-store': { condition: 'service_healthy' },
          },
        }
      : {}),
    logging: DEFAULT_LOGGING,
    extra_hosts: EXTRA_HOSTS,
  };
}

/** Env every backend role shares, plus the colour when it has one. */
function roleEnvironment(
  role: 'api' | 'worker',
  options: BackendServiceOptions,
): Record<string, string> {
  return {
    TALE_ROLE: role,
    ...(options.colour === undefined ? {} : { TALE_COLOR: options.colour }),
    // The application store. Interpolated by docker compose from the
    // project .env at up-time: `tale init` generates DB_PASSWORD; the
    // tale-db image's init scripts own the `tale` role and `tale_app`
    // database. `:?` fails the up on a missing password instead of booting
    // against a guessed default (mirrors the object-store key below).
    //
    // An explicit DATABASE_URL wins, so a deployment can run against a
    // Postgres of its own. Without the outer default this key would pin the
    // bundled `db` and quietly ignore the variable the documentation tells
    // operators to set.
    DATABASE_URL:
      '${DATABASE_URL:-postgresql://${POSTGRES_USER:-tale}:${DB_PASSWORD:?DB_PASSWORD is required}@db:5432/${APP_DB_NAME:-tale_app}}',
    TALE_CONFIG_DIR: '/app/data',
    SANDBOX_URL: '${SANDBOX_URL:-http://sandbox:8003}',
    SANDBOX_AGENT_PROFILE: '${SANDBOX_AGENT_PROFILE:-agent}',
    TALE_SANDBOX_CLAUDE_EFFORT: '${TALE_SANDBOX_CLAUDE_EFFORT:-}',
    SANDBOX_HTTP_API_BASE_URL: `http://backend-api:${BACKEND_API_PORT}`,
    // Where the backend reaches the blob store. Defaults to the bundled
    // one at its internal address — presigned URLs are signed here and
    // forwarded by the proxy, so that store is never published — and an
    // explicit endpoint points the deployment at a bucket of its own. Empty
    // is meaningful too: it selects AWS S3 proper, addressed by bucket and
    // region, so this passes the variable through rather than defaulting a
    // deliberately blank value back to the bundled store.
    OBJECT_STORE_ENDPOINT: `\${OBJECT_STORE_ENDPOINT-${BUNDLED_OBJECT_STORE_ENDPOINT}}`,
    OBJECT_STORE_REGION: '${OBJECT_STORE_REGION:-us-east-1}',
    // Both empty by default: the backend reads "unset" off an empty string
    // and applies the shape the endpoint implies / the bucket root.
    OBJECT_STORE_FORCE_PATH_STYLE: '${OBJECT_STORE_FORCE_PATH_STYLE:-}',
    OBJECT_STORE_PREFIX: '${OBJECT_STORE_PREFIX:-}',
    OBJECT_STORE_BUCKET: '${OBJECT_STORE_BUCKET:-tale-blobs}',
    OBJECT_STORE_ACCESS_KEY: '${OBJECT_STORE_ACCESS_KEY:-tale}',
    OBJECT_STORE_SECRET_KEY:
      '${OBJECT_STORE_SECRET_KEY:?OBJECT_STORE_SECRET_KEY is required}',
    // Where the BROWSER reaches the store: the site origin, behind which
    // the proxy forwards `/<bucket>/*` verbatim.
    OBJECT_STORE_PUBLIC_ENDPOINT:
      '${OBJECT_STORE_PUBLIC_ENDPOINT:-${SITE_URL}}',
  };
}

/**
 * The api role: every application door (the app API, auth, the hint stream,
 * the machine doors, the in-sandbox bridges).
 *
 * Replicable: sessions, chat progress and SAML request ids are database rows,
 * hints ride the outbox, and the config store is serialized by a per-domain
 * advisory lock — so N replicas of one colour are interchangeable. Every one
 * of them answers the `backend-api` DNS alias, and Docker's resolver hands
 * the caller whichever answers; a replica that is still booting is not
 * listening, so the dialler simply falls through to one that is.
 *
 * Dual-homed onto the sandbox network so a session container reaches the
 * connectors bridge and the live-body host-call door directly.
 */
export function createBackendApiService(
  config: ServiceConfig,
  options: BackendServiceOptions = {},
): ComposeService {
  return {
    ...backendBase(config, 'backend-api', options),
    ...(options.colour === undefined
      ? { container_name: `${getProjectId()}-backend-api` }
      : {}),
    environment: {
      ...roleEnvironment('api', options),
      PORT: String(BACKEND_API_PORT),
    },
    // `docker stop` waits this long before SIGKILL: the api closes HTTP/SSE
    // and stops its job queue inside its 15 s drain (SHUTDOWN_DRAIN_MS) with
    // room to spare. Mirrored in compose.yml.
    stop_grace_period: `${backendStopGraceSeconds(BACKEND_API_STOP_GRACE_S)}s`,
    // LIVENESS, not readiness: `/ping` stays 200 while a replica drains, so
    // Docker does not kill a container that is deliberately finishing its
    // in-flight work. `/ready` is the deploy's question (503 once this
    // replica is draining) and is not what Docker or Caddy probe.
    healthcheck: {
      test: ['CMD-SHELL', `curl -sf http://localhost:${BACKEND_API_PORT}/ping`],
      interval: '10s',
      timeout: '3s',
      retries: 3,
      start_period: '30s',
    },
    // The shared `backend-api` alias is what the proxy and the sandbox
    // address; the colour-suffixed one is how the deploy reaches ONE colour
    // while both are up.
    networks: {
      internal: {
        aliases: [
          'backend-api',
          ...(options.colour ? [`backend-api-${options.colour}`] : []),
        ],
      },
      sandbox: {
        aliases: [
          'backend-api',
          ...(options.colour ? [`backend-api-${options.colour}`] : []),
        ],
      },
    },
  };
}

/**
 * The worker role: the job runner (schedules, watchdogs, agent turns). It
 * exposes no HTTP, so the image's baked web healthcheck would read
 * permanently unhealthy — liveness is pg-boss's job heartbeat plus
 * at-least-once job recovery.
 */
export function createBackendWorkerService(
  config: ServiceConfig,
  options: BackendServiceOptions = {},
): ComposeService {
  return {
    ...backendBase(config, 'backend-worker', options),
    ...(options.colour === undefined
      ? { container_name: `${getProjectId()}-backend-worker` }
      : {}),
    environment: roleEnvironment('worker', options),
    healthcheck: { disable: true },
    // `docker stop` waits this long before SIGKILL: a stopping worker hands
    // its automation runs to another one and waits out its other jobs inside
    // its 90 s drain (SHUTDOWN_DRAIN_MS); the grace stays 15 s above it.
    // Mirrored in compose.yml.
    stop_grace_period: `${backendStopGraceSeconds(BACKEND_WORKER_STOP_GRACE_S)}s`,
    // No shared alias: nothing addresses a worker by name — it is reached
    // only through the job queue. Old workers stay up through the api drain
    // so already-claimed jobs can finish; they refuse NEW claims once their
    // colour is draining.
    networks: {
      internal: {
        aliases: options.colour
          ? [`backend-worker-${options.colour}`]
          : ['backend-worker'],
      },
    },
  };
}

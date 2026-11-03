/*
  Where the e2e servers are. The Playwright suite runs one isolated copy of the
  test server per worker: worker `i` talks to the backend on `backendPort + i`
  and to its control server on `controlPort + i`, and never to another's. This
  module is the single place that turns the environment into that plan, so the
  config (how many workers, which port the health check watches), the launcher
  (which servers to start), the standalone server and the fixtures (which
  server a worker talks to) cannot disagree. It is pure (no sockets, no Bun
  API): Playwright's runner, a worker and Bun all load it, and
  `servers.test.ts` holds it.

    E2E_BACKEND_PORT  first backend port                        (default 3204)
    E2E_CONTROL_PORT  first control port       (default the first backend port + 1000)
    E2E_WORKERS       Playwright workers, one server each        (default min(4, cores))
    E2E_SERVERS       servers the launcher starts, never fewer than the workers
                      (default: as many as the workers)
    E2E_BASE_URL      a dev server the page is opened through (Vite), which
                      forwards to the one backend: one worker, `E2E_WORKERS=1`
*/

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_BACKEND_PORT = 3204;
/** A control server listens this far above its backend unless `E2E_CONTROL_PORT` says otherwise. */
const CONTROL_PORT_OFFSET = 1000;
/**
 * Workers by default: four cut the run to a quarter where the machine has the
 * cores for them, and more would starve the browsers and the backends on a
 * four-core runner.
 */
const DEFAULT_MAX_WORKERS = 4;
/** The most servers one plan may hold (each is a database and a set of timers). */
const MAX_SERVERS = 64;
/** The Vite dev server, through which the page may be opened instead of the backend. */
export const DEFAULT_APP_PORT = 3004;
/** A started session takes this long to run, so that "Starting…" is seen. */
export const DEFAULT_LAUNCH_DELAY_MS = 400;
export const DEFAULT_CHECK_DELAY_MS = 150;

/** A setting of the environment that cannot be used. */
export class E2eSetupError extends Error {
  override name = 'E2eSetupError';
}

/** Where the suite runs. Server `i` listens on `backendPort + i` and `controlPort + i`. */
export interface E2ePlan {
  backendPort: number;
  controlPort: number;
  /** Playwright workers: worker `i` talks to server `i`. */
  workers: number;
  /** Servers the launcher starts: the workers' and possibly more. */
  servers: number;
  /** The dev server the page is opened through, or `undefined`: through the backend itself. */
  baseUrl: string | undefined;
}

/** One server of a plan, as a spec sees it. */
export interface E2eServerAddress {
  index: number;
  /** The backend: the page, `/api`, the live view and `/mcp`. */
  port: number;
  controlPort: number;
  /** What a page is opened at (`http://localhost:<port>`); an origin of its own, with no path. */
  origin: string;
  /** The remote control of the fakes (`tests/e2e/control.ts`). */
  controlUrl: string;
}

/** The part of a server's settings that is not where it listens. */
export interface E2eServerSettings {
  /** Port of the dev server the page may be opened through: the backend answers `Host` values naming it. */
  appPort: number;
  launchDelayMs: number;
  checkDelayMs: number;
  /** A built page other than the service's own `dist/` (a private build); `undefined`: `dist/`. */
  distDir: string | undefined;
}

function setting(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function integer(
  env: Env,
  name: string,
  min: number,
  max: number,
): number | undefined {
  const text = setting(env, name);
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new E2eSetupError(
      `${name} must be a whole number from ${min} to ${max}, got "${text}".`,
    );
  }
  return value;
}

/**
 * The plan for an environment on a machine with `cores` cores. The workers and
 * the servers are one number unless told otherwise, so setting either one is
 * enough; a dev server (`E2E_BASE_URL`) is one place for the page to go, so it
 * takes one worker and refuses more.
 */
export function planFrom(env: Env, cores: number): E2ePlan {
  const baseUrl = setting(env, 'E2E_BASE_URL');
  const backendPort =
    integer(env, 'E2E_BACKEND_PORT', 1, 65_535) ?? DEFAULT_BACKEND_PORT;
  const controlPort =
    integer(env, 'E2E_CONTROL_PORT', 1, 65_535) ??
    backendPort + CONTROL_PORT_OFFSET;
  const requestedWorkers = integer(env, 'E2E_WORKERS', 1, MAX_SERVERS);
  const requestedServers = integer(env, 'E2E_SERVERS', 1, MAX_SERVERS);

  const automatic =
    baseUrl === undefined
      ? Math.min(DEFAULT_MAX_WORKERS, Math.max(1, Math.floor(cores) || 1))
      : 1;
  const workers = requestedWorkers ?? requestedServers ?? automatic;
  const servers = requestedServers ?? workers;

  if (servers < workers) {
    throw new E2eSetupError(
      `E2E_WORKERS=${workers} needs a server for each worker, but E2E_SERVERS=${servers} starts fewer.`,
    );
  }
  if (baseUrl !== undefined && workers > 1) {
    throw new E2eSetupError(
      `E2E_BASE_URL sends every worker to the same dev server, so only one worker can run: set E2E_WORKERS=1 (got ${workers}).`,
    );
  }
  const backendLast = backendPort + servers - 1;
  const controlLast = controlPort + servers - 1;
  if (backendLast > 65_535 || controlLast > 65_535) {
    throw new E2eSetupError(
      `${servers} servers from E2E_BACKEND_PORT=${backendPort} and E2E_CONTROL_PORT=${controlPort} run past port 65535.`,
    );
  }
  if (backendPort <= controlLast && controlPort <= backendLast) {
    throw new E2eSetupError(
      `The backend ports ${backendPort}-${backendLast} and the control ports ${controlPort}-${controlLast} overlap: move E2E_CONTROL_PORT.`,
    );
  }
  return { backendPort, controlPort, workers, servers, baseUrl };
}

/**
 * Server `index` of the plan. A worker beyond the plan has no server of its own
 * and is refused with the way out, instead of failing every request with a
 * refused connection.
 */
export function addressOf(
  plan: Pick<E2ePlan, 'backendPort' | 'controlPort' | 'servers'>,
  index: number,
): E2eServerAddress {
  if (!Number.isInteger(index) || index < 0 || index >= plan.servers) {
    throw new E2eSetupError(
      `Worker ${index} has no server of its own: ${plan.servers} ${plan.servers === 1 ? 'is' : 'are'} started. ` +
        'Set E2E_WORKERS to the number of workers you want (the launcher then starts as many servers); ' +
        'a --workers count on the command line cannot start more.',
    );
  }
  const port = plan.backendPort + index;
  const controlPort = plan.controlPort + index;
  return {
    index,
    port,
    controlPort,
    origin: `http://localhost:${port}`,
    controlUrl: `http://127.0.0.1:${controlPort}`,
  };
}

/**
 * The address Playwright polls to know the servers are up. The launcher starts
 * them in order in one go, so the last one listening means all of them do.
 */
export function healthUrl(
  plan: Pick<E2ePlan, 'backendPort' | 'servers'>,
): string {
  return `http://localhost:${plan.backendPort + plan.servers - 1}/api/health`;
}

/** The plan in a line for a log. */
export function describePlan(plan: E2ePlan): string {
  const range = (first: number) =>
    plan.servers === 1 ? `:${first}` : `:${first}-${first + plan.servers - 1}`;
  return `${plan.servers} ${plan.servers === 1 ? 'server' : 'servers'}, backend ${range(plan.backendPort)}, control ${range(plan.controlPort)}`;
}

/**
 * The one server of `bun tests/e2e/server.ts`: `E2E_BACKEND_PORT` and
 * `E2E_CONTROL_PORT` mean what they always did for it, whatever the suite's
 * `E2E_WORKERS` is.
 */
export function soloAddress(env: Env): E2eServerAddress {
  return addressOf(
    planFrom({ ...env, E2E_WORKERS: '1', E2E_SERVERS: '1' }, 1),
    0,
  );
}

export function serverSettings(env: Env): E2eServerSettings {
  return {
    appPort: integer(env, 'E2E_APP_PORT', 1, 65_535) ?? DEFAULT_APP_PORT,
    launchDelayMs:
      integer(env, 'E2E_LAUNCH_DELAY_MS', 0, 600_000) ??
      DEFAULT_LAUNCH_DELAY_MS,
    checkDelayMs:
      integer(env, 'E2E_CHECK_DELAY_MS', 0, 600_000) ?? DEFAULT_CHECK_DELAY_MS,
    distDir: setting(env, 'E2E_DIST_DIR'),
  };
}

/**
 * Mode + target resolution for the dev orchestrator, extracted as pure functions
 * so the env-driven branching (CONVEX_EXTERNAL / TALE_DEV_SKIP_DOCKER / TALE_E2E*
 * and the CONVEX_URL probe target) is testable without booting anything.
 *
 * node-only by location; pure (no I/O).
 */

export const DEFAULT_CONVEX_PORT = 3210;
export const DEFAULT_CONVEX_HOST = '127.0.0.1';

/** The one truthy parser for dev env toggles: `1`/`true`/`yes`/`on` (any case). */
export function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? '');
}

/**
 * Whether `bun run dev` should pop the app in a browser once it's READY.
 *
 * Opens by default (the common interactive case), with two ways out:
 *  - `CI` is set — never steal focus on a build agent.
 *  - `TALE_DEV_OPEN` is set to a falsy value (`0`/`false`/`no`/`off`) — the
 *    explicit opt-out for a headless / nested run (Playwright's webServer sets
 *    it, so a local e2e run never spawns a browser). Unset → open.
 */
export function shouldOpenBrowser(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isTruthy(env.CI)) return false;
  const flag = env.TALE_DEV_OPEN;
  if (flag === undefined || flag.trim() === '') return true;
  return isTruthy(flag);
}

/**
 * Adopt the backend endpoints the Convex CLI allocated for THIS project from a
 * freshly-parsed .env.local. On a fresh checkout the CLI writes only
 * VITE_CONVEX_URL / VITE_CONVEX_SITE_URL (and CONVEX_DEPLOYMENT) — and when the
 * default ports are taken (a second stack on one machine, e.g. an isolated E2E
 * worktree beside `bun dev`) it picks OTHER ports. Everything that keys on
 * CONVEX_URL / CONVEX_SITE_PROXY_URL (the readiness probe, the health check,
 * the auth-route wait, the Vite proxy) falls back to :3210/:3211, so without
 * this back-fill an isolated stack false-positives its probes against a
 * NEIGHBOURING backend and silently proxies every /api and /ws_api request
 * into it — test writes landing in the dev database. Explicit values win:
 * only unset keys are filled. Pure given both env records.
 */
export function adoptCliEndpoints(
  env: NodeJS.ProcessEnv,
  freshEnv: Record<string, string>,
): void {
  if (freshEnv.CONVEX_DEPLOYMENT && !env.CONVEX_DEPLOYMENT) {
    env.CONVEX_DEPLOYMENT = freshEnv.CONVEX_DEPLOYMENT;
  }
  if (!env.CONVEX_URL && freshEnv.VITE_CONVEX_URL) {
    env.CONVEX_URL = freshEnv.VITE_CONVEX_URL;
  }
  if (!env.CONVEX_SITE_PROXY_URL && freshEnv.VITE_CONVEX_SITE_URL) {
    env.CONVEX_SITE_PROXY_URL = freshEnv.VITE_CONVEX_SITE_URL;
  }
}

export interface ConvexTarget {
  host: string;
  port: number;
  url: string;
}

/**
 * Resolve the Convex host:port to probe/proxy. Honors `CONVEX_URL` (external
 * mode); on a malformed URL it calls `onWarn` and falls back to the local
 * default. Pure given `env` + `onWarn`.
 */
export function resolveConvexProbeTarget(
  env: NodeJS.ProcessEnv = process.env,
  onWarn: (message: string) => void = () => {},
): ConvexTarget {
  const fallback: ConvexTarget = {
    host: DEFAULT_CONVEX_HOST,
    port: DEFAULT_CONVEX_PORT,
    url: `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`,
  };
  const raw = env.CONVEX_URL;
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
    return { host: parsed.hostname, port, url: raw };
  } catch {
    onWarn(
      `CONVEX_URL=${raw} is not a valid URL; falling back to ${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`,
    );
    return fallback;
  }
}

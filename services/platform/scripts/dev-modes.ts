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

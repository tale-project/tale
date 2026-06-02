/**
 * Session idle timeout (#1502).
 *
 * A deployment-wide inactivity window for authenticated sessions, opt-in via
 * the `SESSION_IDLE_TIMEOUT_MINUTES` environment variable. When set, sessions
 * become a sliding window: each authenticated request slides the expiry
 * forward, and a session left idle longer than the window expires server-side
 * (Better Auth rejects it on the next request). When unset, every call site
 * keeps its existing default lifetime — no behaviour change.
 *
 * This is the server-side control (SOC 2 CC6.1 / ISO 27001 A.8.5). The client
 * watchdog (`useSessionIdleWatchdog`) is the matching UX: it warns and signs
 * the user out proactively rather than letting the next request 401.
 *
 * Scope: the env var is the deployment-wide BACKSTOP. It still drives Better
 * Auth's global sliding-window config (the server-side control), and it is the
 * hard cap an org admin cannot loosen past. On top of that, an org admin may
 * TIGHTEN the effective window via the `session_idle_timeout` governance
 * policy (#1502); that per-org window drives the client watchdog. Resolving
 * the per-org window on every server request would defeat the JWT-only fast
 * path, so server-side enforcement stays on the deployment backstop — see
 * `resolveEffectiveIdleMinutes` for how the two combine.
 */

const ENV_KEY = 'SESSION_IDLE_TIMEOUT_MINUTES';
const MIN_MINUTES = 1;
const MAX_MINUTES = 24 * 60; // 24h — an idle window longer than a day is an absolute cap, not "idle".

/** Effective idle window when neither env nor org policy is set, but an org
 *  admin enables the policy without changing the field (the editor default). */
export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const SESSION_IDLE_TIMEOUT_MIN_MINUTES = MIN_MINUTES;
export const SESSION_IDLE_TIMEOUT_MAX_MINUTES = MAX_MINUTES;

// Memoized on the raw env value. The auth path calls this on every session
// create/validate, but SESSION_IDLE_TIMEOUT_MINUTES doesn't change at runtime,
// so we recompute only when the raw value changes (keying on the value rather
// than a one-shot memo keeps it correct if the env is swapped between calls,
// e.g. in tests). `warnedRawValues` dedupes the warning so a misconfigured
// value isn't logged on every request.
let cachedRaw: string | null | undefined;
let cachedMinutes: number | null = null;
const warnedRawValues = new Set<string>();

/**
 * Parse and validate `SESSION_IDLE_TIMEOUT_MINUTES`. Returns the window in
 * minutes, or `null` when unset or invalid. An invalid value is logged once
 * and treated as unset (fail-open to the existing default) rather than
 * throwing — a bad env var must not break the auth path at startup.
 */
export function parseSessionIdleTimeoutMinutes(): number | null {
  const raw = process.env[ENV_KEY] ?? null;
  if (raw === cachedRaw) return cachedMinutes;

  let result: number | null;
  if (raw === null || raw.trim() === '') {
    result = null;
  } else {
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < MIN_MINUTES) {
      if (!warnedRawValues.has(raw)) {
        warnedRawValues.add(raw);
        console.warn(
          `[session-idle] ignoring ${ENV_KEY}="${raw}": expected a number >= ${MIN_MINUTES} (minutes; fractions are rounded down)`,
        );
      }
      result = null;
    } else if (minutes > MAX_MINUTES) {
      if (!warnedRawValues.has(raw)) {
        warnedRawValues.add(raw);
        console.warn(
          `[session-idle] clamping ${ENV_KEY}=${minutes} to the ${MAX_MINUTES}-minute maximum`,
        );
      }
      result = MAX_MINUTES;
    } else {
      result = Math.floor(minutes);
    }
  }

  cachedRaw = raw;
  cachedMinutes = result;
  return result;
}

/**
 * Better Auth `session` window for the sliding idle timeout, in **seconds**
 * (Better Auth's unit). `null` when no idle timeout is configured, so the
 * caller leaves Better Auth's default in place.
 *
 * `updateAge` is the refresh cadence: the session expiry is only re-extended
 * once per `updateAge`, so an active session slides forward without a write on
 * every single request. Capped at 60s (or half the window, whichever is
 * smaller) so the effective idle window is accurate to within a minute.
 */
export function sessionIdleWindowSeconds(): {
  expiresIn: number;
  updateAge: number;
} | null {
  const minutes = parseSessionIdleTimeoutMinutes();
  if (minutes === null) return null;
  const expiresIn = minutes * 60;
  const updateAge = Math.max(1, Math.min(60, Math.floor(expiresIn / 2)));
  return { expiresIn, updateAge };
}

/**
 * Expiry timestamp (ms) for a session being created/extended. Returns
 * `now + idleWindow` when the idle timeout is configured, otherwise
 * `now + fallbackMs` (the call site's existing default), so manually-created
 * sessions (trusted-headers, SSO) honour the same window as Better Auth's
 * native sliding session without changing behaviour when the feature is off.
 */
export function sessionExpiryMs(nowMs: number, fallbackMs: number): number {
  const minutes = parseSessionIdleTimeoutMinutes();
  if (minutes === null) return nowMs + fallbackMs;
  return nowMs + minutes * 60 * 1000;
}

/**
 * Combine the deployment backstop (`envMinutes`, from
 * `SESSION_IDLE_TIMEOUT_MINUTES`) with the per-org `session_idle_timeout`
 * governance policy into the effective idle window, in minutes (#1502).
 *
 * Rules (env is the hard cap an org may only TIGHTEN, never loosen past):
 *   - org policy enabled  → candidate = the org's window;
 *     env set → `min(candidate, envMinutes)`; env unset → candidate as-is.
 *   - org policy disabled/absent → fall back to `envMinutes` (today's
 *     deployment-wide behaviour).
 *   - neither configured → `null` (no idle timeout; watchdog is a no-op).
 *
 * Pure (env value is passed in, not read here) so it runs identically on the
 * client watchdog and in a Convex query, and is unit-testable in isolation.
 */
export function resolveEffectiveIdleMinutes(args: {
  policy: { enabled: boolean; idleTimeoutMinutes: number } | null;
  envMinutes: number | null;
}): number | null {
  const { policy, envMinutes } = args;
  if (policy?.enabled) {
    const candidate = policy.idleTimeoutMinutes;
    return envMinutes === null ? candidate : Math.min(candidate, envMinutes);
  }
  return envMinutes;
}

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
 * Scope: this is a single deployment-wide value. Per-organisation idle windows
 * would require reading each org's policy on every request, which defeats the
 * JWT-only fast path; that is intentionally out of scope here.
 */

const ENV_KEY = 'SESSION_IDLE_TIMEOUT_MINUTES';
const MIN_MINUTES = 1;
const MAX_MINUTES = 24 * 60; // 24h — an idle window longer than a day is an absolute cap, not "idle".

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

import { parseSessionIdleTimeoutMinutes } from '@tale/shared/utils/session-idle';

/**
 * The session cookie cache, opt-in through `SESSION_COOKIE_CACHE_SECONDS`.
 *
 * Every authenticated request resolves its session in the database: the
 * session row joined with its user, two reads on the auth pool before the
 * request does anything of its own. Better Auth can instead carry the
 * resolved session in a signed cookie for a short while and answer from it
 * without the database — at a large deployment that is most of the auth
 * reads gone.
 *
 * The price is revocation latency, which is why it is off unless an
 * operator turns it on: a change to the session or the account (sign-out
 * on another device, or the sessions ended when a password changes or an
 * admin revokes a member's passkey or resets their two-factor
 * authentication) reaches ordinary requests only when the cached copy
 * expires.
 * Organization membership is not cached — the org gate reads it on every
 * request — and open event streams re-prove the session against the
 * database on their own cadence.
 *
 * The cache also defers the sliding refresh that keeps `session.updatedAt`
 * current, so it must stay well inside an idle-timeout window: with
 * `SESSION_IDLE_TIMEOUT_MINUTES` set, the cache is held to a quarter of that
 * window, or idle enforcement would revoke sessions that are in use.
 */

/** The longest cache this deployment accepts, whatever the variable says. */
export const SESSION_COOKIE_CACHE_MAX_SECONDS = 300;

export function sessionCookieCacheSeconds(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.SESSION_COOKIE_CACHE_SECONDS;
  const parsed = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return 0;
  let seconds = Math.min(parsed, SESSION_COOKIE_CACHE_MAX_SECONDS);
  // The idle window is the process environment's, like the auth path reads it.
  const idleMinutes = parseSessionIdleTimeoutMinutes();
  if (idleMinutes !== null) {
    seconds = Math.min(seconds, Math.floor((idleMinutes * 60) / 4));
  }
  return Math.max(0, seconds);
}

/** The `session` options Better Auth reads for the cache, or nothing. */
export function sessionCookieCacheOption(
  env: Record<string, string | undefined> = process.env,
): { cookieCache?: { enabled: true; maxAge: number } } {
  const maxAge = sessionCookieCacheSeconds(env);
  return maxAge > 0 ? { cookieCache: { enabled: true, maxAge } } : {};
}

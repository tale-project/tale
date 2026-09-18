import { getEnv } from '@/lib/env';
import { sanitizeInternalRedirect } from '@/lib/shared/utils/safe-redirect';

/**
 * The login page's hand-off to an application's authenticating proxy: when
 * the backend saw the proxy's identity header (or the organization's key)
 * on the request, the page sends the browser to the trusted-headers door,
 * which signs the person into the organization that issued the key.
 *
 * The door answers a refusal as a page of its own, and a session cookie set
 * inside a cross-site frame may never come back — either way the browser
 * can land on the login page again moments later. This tab remembers that
 * it was just sent to the door so the page shows the form (with a retry)
 * instead of bouncing forever.
 */

const ATTEMPT_KEY = 'tale.trusted-headers.handoff-at';
/** A return within this window means the hand-off did not stick. */
const RECENT_ATTEMPT_MS = 60_000;

/** The door's address, carrying the validated in-app return path. */
export function proxyHandoffUrl(redirectTo: string | undefined): string {
  const basePath = getEnv('BASE_PATH');
  // Forward only a validated same-origin path — defence in depth against the
  // open redirect the door also guards (#2037).
  const target = sanitizeInternalRedirect(redirectTo, `${basePath}/dashboard`);
  return `${getEnv('SITE_URL')}${basePath}/api/trusted-headers/authenticate?redirect=${encodeURIComponent(target)}`;
}

/** Remember that this tab was just sent to the door. */
export function markProxyHandoffAttempt(now = Date.now()): void {
  try {
    window.sessionStorage.setItem(ATTEMPT_KEY, String(now));
  } catch (error) {
    console.warn('[login] cannot remember the proxy hand-off attempt', error);
  }
}

/**
 * True when this tab was sent to the door moments ago and is back on the
 * login page — going again would loop. Without usable storage the loop
 * cannot be detected, so the answer is true and the person decides.
 */
export function recentProxyHandoffAttempt(now = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(ATTEMPT_KEY);
    if (raw === null) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at < RECENT_ATTEMPT_MS;
  } catch (error) {
    console.warn('[login] cannot read the proxy hand-off attempt', error);
    return true;
  }
}

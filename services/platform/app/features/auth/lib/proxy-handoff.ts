import { getEnv } from '@/lib/env';
import {
  PROXY_HANDOFF_HOLD_COOKIE,
  PROXY_HANDOFF_HOLD_MAX_AGE_S,
} from '@/lib/shared/constants/trusted-headers';
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

/**
 * The door's address, carrying the validated in-app return path. Same-origin
 * on purpose: the browser must reach the door through the host it is on —
 * that is where the proxy that injects the key sits, and where the cookie
 * the door sets must land. An absolute `SITE_URL` would send a browser that
 * arrived through a gateway on another hostname straight to the canonical
 * origin, past the proxy, with no key on the request.
 */
export function proxyHandoffUrl(redirectTo: string | undefined): string {
  const basePath = getEnv('BASE_PATH');
  // Forward only a validated same-origin path — defence in depth against the
  // open redirect the door also guards (#2037).
  const target = sanitizeInternalRedirect(redirectTo, `${basePath}/dashboard`);
  // `via=app`: a refusal comes back to this page with its reason, for the
  // page to render — rather than as the door's own page.
  return `${basePath}/api/trusted-headers/authenticate?redirect=${encodeURIComponent(target)}&via=app`;
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

/**
 * The hold after an inactivity sign-out: while it stands, the backend does
 * not sign the app's own requests in from the proxy's headers and this page
 * waits for a click — so the notice is seen before the session comes back
 * (#1502). A cookie rather than storage because the backend must see it too;
 * `Secure` follows the page, never the other way round.
 */
export function holdProxyHandoff(): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PROXY_HANDOFF_HOLD_COOKIE}=1; Max-Age=${PROXY_HANDOFF_HOLD_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
}

/** Lift the hold — the person chose to continue. */
export function releaseProxyHandoff(): void {
  document.cookie = `${PROXY_HANDOFF_HOLD_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** True while the hold stands. */
export function proxyHandoffHeld(): boolean {
  return document.cookie
    .split(';')
    .some((part) => part.trim().startsWith(`${PROXY_HANDOFF_HOLD_COOKIE}=1`));
}

/**
 * The hold the app places on the proxy sign-in after an inactivity sign-out:
 * while this cookie is present the backend does not mint a session from the
 * proxy's headers on the app's own requests, and the sign-in page waits for
 * a click instead of handing off by itself — so the "signed out because you
 * were inactive" notice is seen before the session comes back (#1502). The
 * cookie is the app's, not a credential: readable by the page (it clears it
 * on Continue) and short-lived.
 */
export const PROXY_HANDOFF_HOLD_COOKIE = 'tale_handoff_hold';

/** Fifteen minutes — long enough to read the notice, short enough to expire
 * unnoticed in a tab left behind. */
export const PROXY_HANDOFF_HOLD_MAX_AGE_S = 15 * 60;

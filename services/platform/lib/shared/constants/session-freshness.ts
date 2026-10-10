/**
 * How long after sign-in a session counts as FRESH — Better Auth's
 * `session.freshAge`, in seconds. Registering a passkey needs a fresh
 * session: `@better-auth/passkey` guards both registration calls with
 * `freshSessionMiddleware`, which refuses an older one with 403
 * `SESSION_NOT_FRESH`. Such a session confirms the password first
 * (`POST /api/auth/reauthenticate`, `backend/auth/reauthenticate.ts`), which
 * replaces it with a fresh one.
 *
 * The auth config and the app's up-front check (`app/lib/auth/session-freshness.ts`)
 * read this one value, so the app asks for the password exactly when the
 * server would refuse.
 */
export const SESSION_FRESH_AGE_SECONDS = 24 * 60 * 60;

/** The re-authentication door, under Better Auth's `/api/auth` mount. */
export const REAUTHENTICATE_PATH = '/reauthenticate';

/** Better Auth's refusal of a session older than `SESSION_FRESH_AGE_SECONDS`. */
export const SESSION_NOT_FRESH_CODE = 'SESSION_NOT_FRESH';

/** The re-authentication door's refusal for an account with no password to
 * confirm: one that signs in through SSO or an authenticating proxy signs in
 * again there instead. */
export const PASSWORD_NOT_SET_CODE = 'PASSWORD_NOT_SET';

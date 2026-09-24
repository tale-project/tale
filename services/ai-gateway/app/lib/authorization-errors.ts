/**
 * What the panel says when an authorization fails.
 *
 * The gateway ends an authorization on one of these codes — the dialog hears
 * them from the API, and the page a redirected sign-in lands on hears them
 * from the authorization it reports — and each has its message under
 * `addAccount.errors`. Anything else reads as the general failure rather than
 * as a raw code.
 */
const AUTHORIZATION_ERRORS = new Set([
  'unknown_state',
  'missing_code',
  'state_mismatch',
  'exchange_failed',
  'expired',
  'denied',
  'unavailable',
]);

/** The `addAccount` key that says why an authorization failed. */
export function authorizationErrorKey(code: string): string {
  return AUTHORIZATION_ERRORS.has(code) ? `errors.${code}` : 'errors.failed';
}

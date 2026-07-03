/**
 * Build a 302 back to the login page carrying the failure so the UI can render
 * the REAL reason instead of a blank form or a bare "Internal server error".
 *
 * `message` is a translation key (e.g. `sso.errors.redirectMismatch`) when the
 * cause is a known Entra AADSTS code, or a plain-text fallback otherwise — the
 * login page renders either (a missing i18n key degrades to the string itself).
 * Shared by both the authorize and callback handlers so a failure lands
 * identically wherever in the flow it happens.
 */
export function redirectWithError(
  origin: string,
  message: string,
  errorCode?: string,
  recoveryKey?: string,
): Response {
  const basePath = process.env.BASE_PATH || '';
  const errorUrl = new URL(`${basePath}/log-in`, origin);
  errorUrl.searchParams.set('error', message);
  if (errorCode) errorUrl.searchParams.set('error_code', errorCode);
  if (recoveryKey) errorUrl.searchParams.set('recovery', recoveryKey);
  return new Response(null, {
    status: 302,
    headers: { Location: errorUrl.toString() },
  });
}

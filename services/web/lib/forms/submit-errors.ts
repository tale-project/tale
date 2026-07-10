/** Stable machine code the server returns when form delivery is unset. */
export const FORM_NOT_CONFIGURED_CODE = 'not_configured';

/** Maps a form-submit HTTP status (+ server error code) to the user-facing
 * i18n key message. The 503/not_configured pair is permanent (the deployment
 * has no `WEB_DISCORD_WEBHOOK_URL`), so it must not read as "try again". */
export function formSubmitErrorMessage(
  status: number,
  t: (
    key:
      | 'errors.rateLimited'
      | 'errors.notConfigured'
      | 'errors.serverUnavailable'
      | 'errors.generic',
  ) => string,
  code?: string,
): string {
  if (status === 429) return t('errors.rateLimited');
  if (status === 503 && code === FORM_NOT_CONFIGURED_CODE) {
    return t('errors.notConfigured');
  }
  if (status >= 500) return t('errors.serverUnavailable');
  return t('errors.generic');
}

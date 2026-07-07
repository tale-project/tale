/** Maps a form-submit HTTP status to the user-facing i18n key message. */
export function formSubmitErrorMessage(
  status: number,
  t: (
    key: 'errors.rateLimited' | 'errors.serverUnavailable' | 'errors.generic',
  ) => string,
): string {
  if (status === 429) return t('errors.rateLimited');
  if (status >= 500) return t('errors.serverUnavailable');
  return t('errors.generic');
}

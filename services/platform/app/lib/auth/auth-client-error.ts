/**
 * The Better Auth client's refusals, read the way the app reads a backend
 * answer. A call such as `authClient.organization.createTeam` resolves with
 * `{ error }` instead of rejecting; a surface throws the `Error` built here
 * and its failure toast reads it through `failureDetail`.
 */

import { i18n } from '@/lib/i18n/i18n';

import { isLapsedSessionAnswer, reportSessionLapsed } from './session-lapse';

/** The `error` a Better Auth client call resolves with. */
export interface AuthClientRefusal {
  status: number;
  code?: string;
  message?: string;
}

/**
 * Whether a Better Auth refusal says the session this tab had is gone. Its
 * session middleware answers 401 `UNAUTHORIZED`; an endpoint that reads the
 * session itself, such as `create-team`, answers a bare 401, which the status
 * alone names. A 401 with another code, sign-in's
 * `INVALID_EMAIL_OR_PASSWORD` for one, is a different refusal.
 */
export function isLapsedAuthClientAnswer(error: AuthClientRefusal): boolean {
  return isLapsedSessionAnswer(error.status, error.code ?? 'UNAUTHORIZED');
}

/**
 * A Better Auth refusal as the `Error` a surface throws to its failure toast.
 * A lapsed session reads as the localized "session ended" sentence and is
 * reported to the recovery flow (`session-lapse.ts`), as the session door's
 * own 401 is. Any other refusal keeps the library's words. One without words
 * carries none, so the toast shows only its title rather than an English
 * fallback.
 */
export function authClientError(error: AuthClientRefusal): Error {
  if (isLapsedAuthClientAnswer(error)) {
    reportSessionLapsed();
    return new Error(i18n.t('errors.sessionEnded', { ns: 'common' }), {
      cause: error,
    });
  }
  return new Error(error.message ?? '', { cause: error });
}

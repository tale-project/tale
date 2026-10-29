/**
 * The Better Auth client's refusals, read the way the app reads a backend
 * answer. A call such as `authClient.organization.createTeam` resolves with
 * `{ error }` instead of rejecting; a surface throws the `Error` built here
 * and its failure toast reads it through `failureDetail`.
 */

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ORGANIZATION_MESSAGE,
  ACCOUNT_AUTHENTICATION_MESSAGE,
} from '@/lib/shared/constants/session-authority';

import { isLapsedSessionAnswer, reportSessionLapsed } from './session-lapse';

/** The `error` a Better Auth client call resolves with. */
export interface AuthClientRefusal {
  status: number;
  code?: string;
  message?: string;
}

/** A refusal's status, code and words, as either the Better Auth client or
 * the backend's fetch seam reads them. */
interface SessionRefusalAnswer {
  status: number;
  code?: string | undefined;
  message?: string | undefined;
}

/** The session-authority refusals this server words itself: the session is
 * bound to another organization (`organization`), or the action needs a
 * session the account itself authenticated (`account`). */
export type AuthSessionRefusal = 'organization' | 'account';

/** These same codes also name other refusals. Recognize only the authority
 * sentence this server owns; never relabel another resource or stale-age
 * refusal merely because it used ORG_FORBIDDEN or SESSION_NOT_FRESH. */
export function authSessionRefusal(
  error: SessionRefusalAnswer | null | undefined,
): AuthSessionRefusal | undefined {
  if (error?.status !== 403) return undefined;
  if (
    error.code === 'ORG_FORBIDDEN' &&
    error.message === SESSION_ORGANIZATION_MESSAGE
  ) {
    return 'organization';
  }
  if (
    error.code === 'SESSION_NOT_FRESH' &&
    error.message === ACCOUNT_AUTHENTICATION_MESSAGE
  ) {
    return 'account';
  }
  return undefined;
}

/** {@link authSessionRefusal}'s refusals in the reader's language. */
export function authSessionRefusalMessage(
  error: SessionRefusalAnswer | null | undefined,
): string | undefined {
  const refusal = authSessionRefusal(error);
  if (refusal === 'organization') {
    return i18n.t('errors.organizationSessionRestricted', { ns: 'common' });
  }
  if (refusal === 'account') {
    return i18n.t('errors.accountIdentityRequired', { ns: 'common' });
  }
  return undefined;
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
  return new Error(authSessionRefusalMessage(error) ?? error.message ?? '', {
    cause: error,
  });
}

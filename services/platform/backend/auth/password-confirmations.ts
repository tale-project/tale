import { APIError } from 'better-auth/api';

import { getString, isRecord } from '../../lib/utils/type-utils.ts';
import type { PasswordCheck } from './password-attempts.ts';

/**
 * Better Auth's endpoints where a signed-in person confirms their own
 * password before changing their account: turning two-factor on or off, new
 * backup codes, the authenticator's secret, and a new password — which the
 * app's own `/api/app/users/update-password` reaches through
 * `auth.api.changePassword`, since a server-side call runs the same hooks.
 * Anyone holding the session cookie reaches them, so each check is a
 * password guess like a sign-in: the auth hooks hold it to the sign-in lock
 * and book its outcome (`password-attempts.ts`). `field` is where the body
 * carries the password. The re-authentication door runs the throttle itself.
 */
const PASSWORD_CONFIRMATIONS: ReadonlyMap<
  string,
  { check: PasswordCheck; field: string }
> = new Map([
  ['/two-factor/enable', { check: 'two_factor_enable', field: 'password' }],
  ['/two-factor/disable', { check: 'two_factor_disable', field: 'password' }],
  [
    '/two-factor/generate-backup-codes',
    { check: 'backup_codes', field: 'password' },
  ],
  ['/two-factor/get-totp-uri', { check: 'totp_uri', field: 'password' }],
  ['/change-password', { check: 'change_password', field: 'currentPassword' }],
]);

/**
 * The password confirmation a request makes, or null: another path, or a
 * body without the password, which the endpoint refuses before it checks
 * anything.
 */
export function passwordConfirmationOf(
  path: string,
  body: unknown,
): PasswordCheck | null {
  const confirmation = PASSWORD_CONFIRMATIONS.get(path);
  if (confirmation === undefined || !isRecord(body)) return null;
  const password = getString(body, confirmation.field);
  return password !== undefined && password.length > 0
    ? confirmation.check
    : null;
}

/**
 * How a confirmation's password check came out, read off the endpoint's
 * answer: Better Auth's `INVALID_PASSWORD` refusal is a wrong password; any
 * other refusal never decided on it (no session, a new password too short,
 * two-factor already on), so it counts neither way; an answer is a right one.
 */
export function confirmationOutcome(
  returned: unknown,
): 'success' | 'failure' | 'not-attempted' {
  if (returned instanceof APIError) {
    return isRecord(returned.body) &&
      getString(returned.body, 'code') === 'INVALID_PASSWORD'
      ? 'failure'
      : 'not-attempted';
  }
  return 'success';
}

/**
 * A password check's refusal as the app words it: a wrong password, or the
 * sign-in lock — too many wrong passwords on the account, typed here or at
 * the sign-in form. Better Auth's password confirmations (turning two-factor
 * on or off, new backup codes, a new password) and the re-authentication
 * door answer the same pair: 400 `INVALID_PASSWORD`, and 429 carrying
 * `retryAfter` in seconds (`backend/auth/password-attempts.ts`).
 */
export type PasswordRefusal =
  | { reason: 'wrong-password' }
  | { reason: 'locked'; retryAfterSec: number | undefined };

/** A wait in seconds, read off whatever a refusal carried. */
export function retryAfterSeconds(value: unknown): number | undefined {
  const seconds = typeof value === 'string' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? seconds
    : undefined;
}

/** The refusal a Better Auth client error is, or null for any other. */
export function readPasswordRefusal(
  error: { status: number; code?: string | undefined } | null | undefined,
): PasswordRefusal | null {
  if (!error) return null;
  if (error.status === 429) {
    return {
      reason: 'locked',
      retryAfterSec: retryAfterSeconds(
        'retryAfter' in error ? error.retryAfter : undefined,
      ),
    };
  }
  return error.code === 'INVALID_PASSWORD'
    ? { reason: 'wrong-password' }
    : null;
}

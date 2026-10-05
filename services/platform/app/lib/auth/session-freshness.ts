import { isLapsedAuthClientAnswer } from '@/app/lib/auth/auth-client-error';
import {
  holdSessionLapseRedirects,
  reportSessionLapsed,
} from '@/app/lib/auth/session-lapse';
import { authClient } from '@/lib/auth-client';
import {
  PASSWORD_NOT_SET_CODE,
  REAUTHENTICATE_PATH,
  SESSION_FRESH_AGE_SECONDS,
} from '@/lib/shared/constants/session-freshness';

/**
 * Time a passkey registration needs on a session that is fresh when it
 * starts: both registration calls check freshness and the browser's prompt
 * sits between them. A session closer than this to going stale confirms the
 * password first, so the ceremony never fails after the person has already
 * touched their authenticator.
 */
export const PASSKEY_CEREMONY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Whether a session created at `createdAt` is still fresh at `nowMs`, with
 * `marginMs` to spare — Better Auth's own test (`freshSessionMiddleware`)
 * against the age the server is configured with. An unreadable date is not
 * fresh.
 */
export function isSessionFresh(
  createdAt: Date | string | number,
  nowMs: number,
  marginMs = 0,
): boolean {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return false;
  return nowMs + marginMs < created + SESSION_FRESH_AGE_SECONDS * 1000;
}

export type ReauthenticationResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-password' | 'no-password' | 'failed' }
  | { ok: false; reason: 'locked'; retryAfterSec: number | undefined };

function retryAfterSeconds(value: unknown): number | undefined {
  const seconds = typeof value === 'string' ? Number(value) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? seconds
    : undefined;
}

/**
 * Confirm the signed-in person's password (`POST /api/auth/reauthenticate`).
 * Success replaces the session with a fresh one: the old token is deleted
 * before the answer installs the new cookie, so a background request can
 * meet a 401 in between — the lapse redirect is held until the answer lands.
 */
export async function reauthenticate(
  password: string,
): Promise<ReauthenticationResult> {
  const resumeLapseRedirects = holdSessionLapseRedirects();
  try {
    const { error } = await authClient.$fetch<
      { status: boolean },
      { code?: string; retryAfter?: unknown }
    >(REAUTHENTICATE_PATH, { method: 'POST', body: { password } });
    if (!error) return { ok: true };
    if (error.status === 429) {
      return {
        ok: false,
        reason: 'locked',
        retryAfterSec: retryAfterSeconds(error.retryAfter),
      };
    }
    if (error.code === 'INVALID_PASSWORD') {
      return { ok: false, reason: 'wrong-password' };
    }
    if (error.code === PASSWORD_NOT_SET_CODE) {
      return { ok: false, reason: 'no-password' };
    }
    // The session ended under the open dialog (signed out elsewhere,
    // revoked): the recovery flow takes the tab to sign-in once the hold
    // below is released.
    if (isLapsedAuthClientAnswer(error)) reportSessionLapsed();
    else console.warn('[auth] Confirming the password was refused', error);
    return { ok: false, reason: 'failed' };
  } catch (error) {
    console.warn('[auth] Confirming the password failed', error);
    return { ok: false, reason: 'failed' };
  } finally {
    resumeLapseRedirects();
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_FRESH_AGE_SECONDS } from '@/lib/shared/constants/session-freshness';

const h = vi.hoisted(() => ({ reauthenticate: vi.fn() }));

vi.mock('@/lib/auth-client', () => ({
  authClient: { $fetch: h.reauthenticate },
}));

import {
  isSessionFresh,
  PASSKEY_CEREMONY_MARGIN_MS,
  reauthenticate,
} from './session-freshness';
import { onSessionLapsed, sessionLapseCheckVersion } from './session-lapse';

const FRESH_AGE_MS = SESSION_FRESH_AGE_SECONDS * 1000;
const CREATED = Date.UTC(2026, 9, 5, 8, 0, 0);

describe('isSessionFresh', () => {
  it('holds while the session is younger than the fresh age — the server test', () => {
    expect(isSessionFresh(new Date(CREATED), CREATED + FRESH_AGE_MS - 1)).toBe(
      true,
    );
    // Better Auth refuses from `now - createdAt >= freshAge` on.
    expect(isSessionFresh(new Date(CREATED), CREATED + FRESH_AGE_MS)).toBe(
      false,
    );
  });

  it('keeps the margin a registration needs to finish', () => {
    const almostStale = CREATED + FRESH_AGE_MS - PASSKEY_CEREMONY_MARGIN_MS;
    expect(
      isSessionFresh(
        new Date(CREATED),
        almostStale - 1,
        PASSKEY_CEREMONY_MARGIN_MS,
      ),
    ).toBe(true);
    expect(
      isSessionFresh(
        new Date(CREATED),
        almostStale,
        PASSKEY_CEREMONY_MARGIN_MS,
      ),
    ).toBe(false);
  });

  it('reads a serialized date, and treats an unreadable one as not fresh', () => {
    expect(isSessionFresh(new Date(CREATED).toISOString(), CREATED + 1)).toBe(
      true,
    );
    expect(isSessionFresh('not a date', CREATED)).toBe(false);
  });
});

describe('reauthenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  const refusal = (error: Record<string, unknown>) =>
    h.reauthenticate.mockResolvedValue({
      data: null,
      error: { statusText: '', ...error },
    });

  it('answers ok when the password is confirmed', async () => {
    h.reauthenticate.mockResolvedValue({ data: { status: true }, error: null });

    await expect(reauthenticate('secret')).resolves.toEqual({ ok: true });
    expect(h.reauthenticate).toHaveBeenCalledWith('/reauthenticate', {
      method: 'POST',
      body: { password: 'secret' },
    });
  });

  it('names a wrong password, a locked account and a missing password', async () => {
    refusal({ status: 400, code: 'INVALID_PASSWORD' });
    await expect(reauthenticate('x')).resolves.toEqual({
      ok: false,
      reason: 'wrong-password',
    });

    refusal({ status: 429, retryAfter: 90 });
    await expect(reauthenticate('x')).resolves.toEqual({
      ok: false,
      reason: 'locked',
      retryAfterSec: 90,
    });

    refusal({ status: 429 });
    await expect(reauthenticate('x')).resolves.toEqual({
      ok: false,
      reason: 'locked',
      retryAfterSec: undefined,
    });

    refusal({ status: 400, code: 'PASSWORD_NOT_SET' });
    await expect(reauthenticate('x')).resolves.toEqual({
      ok: false,
      reason: 'no-password',
    });
  });

  it('hands a lapsed session to the recovery flow once its hold is released', async () => {
    const heard = vi.fn();
    const stop = onSessionLapsed(heard);
    let heardDuringCall = -1;
    h.reauthenticate.mockImplementation(() => {
      heardDuringCall = heard.mock.calls.length;
      return Promise.resolve({
        data: null,
        error: { status: 401, statusText: '', code: 'UNAUTHORIZED' },
      });
    });
    try {
      await expect(reauthenticate('x')).resolves.toEqual({
        ok: false,
        reason: 'failed',
      });
    } finally {
      stop();
    }
    // Held while the call ran, reported after: a rotation's stray 401s
    // never reach the redirect while the new cookie is still on its way.
    expect(heardDuringCall).toBe(0);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(sessionLapseCheckVersion()).not.toBeNull();
  });

  it('reports any other refusal or a thrown call as a failure', async () => {
    refusal({ status: 500 });
    await expect(reauthenticate('x')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });

    h.reauthenticate.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(reauthenticate('x')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(sessionLapseCheckVersion()).not.toBeNull();
  });
});

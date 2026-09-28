// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { requireSession } from '@/backend/auth/session';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';

import {
  isLapsedSessionAnswer,
  onSessionLapsed,
  reportSessionLapsed,
} from './session-lapse';

/** What the real session door answers once the session is gone. */
async function sessionDoorAnswer(): Promise<Response> {
  const app = new Hono();
  const auth = { api: { getSession: async () => null } };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the guard reads only getSession
  app.use(requireSession(auth as never));
  app.get('/users/me', (c) => c.json({ user: null }));
  return app.request('http://localhost/users/me');
}

describe('isLapsedSessionAnswer', () => {
  it("reads the session door's own answer as a lapsed session", async () => {
    const res = await sessionDoorAnswer();
    const body: unknown = await res.json();
    expect(
      isLapsedSessionAnswer(
        res.status,
        (body as { code?: string } | null)?.code,
      ),
    ).toBe(true);
    // The fixture the surface tests feed their error handlers IS that
    // answer, so they prove the app's reading of the real door.
    expect({ status: res.status, body }).toEqual(LAPSED_SESSION_ANSWER);
  });

  it('is false for every other refusal', () => {
    expect(isLapsedSessionAnswer(401, 'INVALID_API_KEY')).toBe(false);
    expect(isLapsedSessionAnswer(401, undefined)).toBe(false);
    expect(isLapsedSessionAnswer(403, 'UNAUTHORIZED')).toBe(false);
    expect(isLapsedSessionAnswer(403, 'RBAC_FORBIDDEN')).toBe(false);
  });
});

describe('the lapsed-session signal', () => {
  it('reaches every listener, and none after it unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = onSessionLapsed(first);
    const stopSecond = onSessionLapsed(second);

    reportSessionLapsed();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    stopFirst();
    reportSessionLapsed();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });
});

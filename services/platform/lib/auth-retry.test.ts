// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { shouldRetryAuthRequest } from './auth-retry.ts';

/**
 * Which failed auth requests the browser's client replays
 * (`lib/auth-client.ts`).
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('shouldRetryAuthRequest', () => {
  it('replays a request the backend never answered', async () => {
    expect(await shouldRetryAuthRequest(null)).toBe(true);
  });

  it('replays a 5xx: a cold start, a restarting database', async () => {
    expect(
      await shouldRetryAuthRequest(json(503, { code: 'DATABASE_UNAVAILABLE' })),
    ).toBe(true);
    expect(await shouldRetryAuthRequest(json(500, { code: 'X' }))).toBe(true);
    expect(
      await shouldRetryAuthRequest(
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    ).toBe(true);
    expect(
      await shouldRetryAuthRequest(
        new Response('<html>Unavailable</html>', {
          status: 503,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    ).toBe(true);
  });

  it('never replays a 4xx', async () => {
    expect(await shouldRetryAuthRequest(json(401, { code: 'X' }))).toBe(false);
    expect(await shouldRetryAuthRequest(json(429, { code: 'X' }))).toBe(false);
  });

  it('does not replay the refusal of a password check: the server asked for a wait', async () => {
    const refusal = json(503, { code: 'PASSWORD_CHECK_BUSY' });

    expect(await shouldRetryAuthRequest(refusal)).toBe(false);
    // The body stays readable for the client that made the request.
    expect(await refusal.json()).toEqual({ code: 'PASSWORD_CHECK_BUSY' });
  });

  it('replays a 503 whose JSON cannot be read, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const torn = new Response('{"code":', {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });

    expect(await shouldRetryAuthRequest(torn)).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HttpCtx } from './helpers';
import { authenticateRequest, httpStatusForConvexCode } from './helpers';

// `authenticateRequest` resolves identity through Better Auth; stub `createAuth`
// so the tests drive the session result directly without the real auth stack.
const getSession = vi.fn();
vi.mock('../../auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession } })),
}));

function bearerRequest(token: string): Request {
  return new Request('https://app.example.com/api/v1/agents', {
    headers: { authorization: `Bearer ${token}` },
  });
}

function ctxWith(runMutation: ReturnType<typeof vi.fn>): HttpCtx {
  return { runMutation } as unknown as HttpCtx;
}

/**
 * The REST wrapper (`withRestAuth`) maps typed `ConvexError` codes to HTTP
 * statuses via `httpStatusForConvexCode`; any code resolving to a 4xx is
 * forwarded to the client, everything else falls through to a generic 500.
 *
 * `validateProductFields` throws `ConvexError({ code: 'too_long' })` on the
 * REST product write paths (`POST`/`PATCH /api/v1/products`), so `too_long`
 * must map to 400 — otherwise an over-length client input surfaces as a 500
 * (server error) instead of a 400 (client error).
 */
describe('httpStatusForConvexCode', () => {
  it('maps over-length input (too_long) to 400, not 500', () => {
    expect(httpStatusForConvexCode('too_long')).toBe(400);
  });

  it.each([
    ['unauthenticated', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['validation', 400],
  ])('maps %s to %i', (code, status) => {
    expect(httpStatusForConvexCode(code)).toBe(status);
  });

  it.each([[undefined], ['something_unrecognized']])(
    'falls through to 500 for unrecognized code %s',
    (code) => {
      expect(httpStatusForConvexCode(code)).toBe(500);
    },
  );
});

/**
 * Regression for #2317: a successful REST api-key authentication must stamp the
 * key's `lastRequest`, otherwise the Settings → API table forever reads
 * "Never used". Better Auth's own session-hook write is a no-op in this HTTP
 * action context, so the helper writes the field directly on the component row.
 */
describe('authenticateRequest — records api-key last-used (#2317)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stamps lastRequest on the authenticated api-key row', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user_1', email: 'a@b.com', name: 'A' },
      session: { id: 'apikey_123' },
    });
    const runMutation = vi.fn().mockResolvedValue(undefined);

    const user = await authenticateRequest(
      ctxWith(runMutation),
      bearerRequest('tale_secret'),
    );

    expect(user).toEqual({ userId: 'user_1', email: 'a@b.com', name: 'A' });
    expect(runMutation).toHaveBeenCalledTimes(1);
    const [, args] = runMutation.mock.calls[0];
    expect(args.input.model).toBe('apikey');
    expect(args.input.where).toEqual([
      { field: '_id', value: 'apikey_123', operator: 'eq' },
    ]);
    expect(typeof args.input.update.lastRequest).toBe('number');
  });

  it('still authenticates when the last-used stamp fails (best-effort)', async () => {
    getSession.mockResolvedValue({
      user: { id: 'user_1', email: 'a@b.com', name: 'A' },
      session: { id: 'apikey_123' },
    });
    const runMutation = vi.fn().mockRejectedValue(new Error('write blocked'));

    const user = await authenticateRequest(
      ctxWith(runMutation),
      bearerRequest('tale_secret'),
    );

    expect(user.userId).toBe('user_1');
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid key and never stamps', async () => {
    getSession.mockResolvedValue(null);
    const runMutation = vi.fn();

    await expect(
      authenticateRequest(ctxWith(runMutation), bearerRequest('tale_bad')),
    ).rejects.toThrow('Invalid API key or session');
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('rejects a request without a Bearer token', async () => {
    const runMutation = vi.fn();
    const request = new Request('https://app.example.com/api/v1/agents');

    await expect(
      authenticateRequest(ctxWith(runMutation), request),
    ).rejects.toThrow('Missing or invalid Authorization header');
    expect(runMutation).not.toHaveBeenCalled();
  });
});

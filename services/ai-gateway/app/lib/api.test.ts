import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, gatewayApi, isSignedOut } from './api';

const fetchMock = vi.fn<typeof fetch>();

/**
 * What a browser hands `fetch` for a redirect it was told to hold: an opaque
 * answer with status 0 and nothing readable in it. No `Response` constructor
 * builds one, so a plain answer is dressed as one.
 */
function heldRedirect(): Response {
  const response = new Response(null, { status: 200 });
  Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
  Object.defineProperty(response, 'status', { value: 0 });
  return response;
}

async function failureOf(call: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await call.then(
    () => null,
    (cause: unknown) => cause,
  );
  if (!(error instanceof ApiError)) {
    throw new Error(`expected an ApiError, got ${String(error)}`);
  }
  return error;
}

describe('gatewayApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('holds redirects instead of following them', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ accounts: [] }));
    await gatewayApi.accounts();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/accounts',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('names a redirect the browser held as a session that ran out', async () => {
    // What the fleet's sign-in gate answers once its session is gone: a
    // redirect towards the identity provider, which `fetch` would otherwise
    // follow to another origin and fail on like a dropped connection.
    fetchMock.mockResolvedValueOnce(heldRedirect());
    const error = await failureOf(gatewayApi.accounts());
    expect(error.code).toBe('signed_out');
    expect(isSignedOut(error)).toBe(true);
  });

  it('names a redirect it can see the same way', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: '/oauth2/start?rd=%2Fapi%2Faccounts' },
      }),
    );
    expect((await failureOf(gatewayApi.accounts())).code).toBe('signed_out');
  });

  it('reads a 401 without the gateway envelope as a gate refusing', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>Sign in</html>', { status: 401 }),
    );
    expect((await failureOf(gatewayApi.accounts())).code).toBe('signed_out');
  });

  it('keeps the gateway’s own code on a 401 that carries one', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'invalid_api_key',
            message: 'Invalid or missing API key.',
          },
        },
        { status: 401 },
      ),
    );
    const error = await failureOf(gatewayApi.accounts());
    expect(error.code).toBe('invalid_api_key');
    expect(isSignedOut(error)).toBe(false);
  });

  it('tells a dropped connection apart from a session that ran out', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await failureOf(gatewayApi.accounts());
    expect(error.code).toBe('unreachable');
    expect(isSignedOut(error)).toBe(false);
  });

  it('keeps the gateway’s code on any other failure', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: { code: 'unknown_account', message: 'No such account.' } },
        { status: 404 },
      ),
    );
    const error = await failureOf(gatewayApi.command('gone'));
    expect(error.code).toBe('unknown_account');
    expect(error.status).toBe(404);
  });
});

describe('isSignedOut', () => {
  it('holds only for the panel’s own code, on an ApiError', () => {
    expect(isSignedOut(new ApiError('signed_out', 'gone', 0))).toBe(true);
    expect(isSignedOut(new ApiError('unreachable', 'Failed to fetch', 0))).toBe(
      false,
    );
    expect(isSignedOut(new Error('signed_out'))).toBe(false);
    expect(isSignedOut(null)).toBe(false);
  });
});

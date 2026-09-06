// @vitest-environment node

/**
 * The token exchange in isolation: what it sends, what it accepts, and — the
 * point of the module — what it refuses to carry back out.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  exchangeAuthorizationCode,
  refreshAccessToken,
} from './token_exchange';

const PARAMS = {
  tokenUrl: 'https://vendor.example/oauth/token',
  code: 'auth-code-1',
  redirectUri: 'https://tale.example/api/connectors/oauth2/callback',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  codeVerifier: 'verifier-0123456789',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('exchangeAuthorizationCode', () => {
  it('posts the grant as a form body and normalizes the result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'mail.read mail.send',
      }),
    );

    const before = Date.now();
    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toMatchObject({
      ok: true,
      tokens: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        scopes: ['mail.read', 'mail.send'],
      },
    });
    if (!result.ok) return;
    expect(result.tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(PARAMS.tokenUrl);
    expect(init.method).toBe('POST');
    const sent = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(sent)).toEqual({
      grant_type: 'authorization_code',
      code: PARAMS.code,
      redirect_uri: PARAMS.redirectUri,
      client_id: PARAMS.clientId,
      client_secret: PARAMS.clientSecret,
      code_verifier: PARAMS.codeVerifier,
    });
  });

  it('splits comma-separated scopes and surfaces the Slack team id and name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        access_token: 'xoxb-1',
        scope: 'chat:write,channels:read',
        team: { id: 'T0EXCHANGE', name: 'Workspace' },
      }),
    );

    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toEqual({
      ok: true,
      tokens: {
        accessToken: 'xoxb-1',
        refreshToken: undefined,
        expiresAt: undefined,
        scopes: ['chat:write', 'channels:read'],
        teamId: 'T0EXCHANGE',
        // Labels a second workspace's credential (`Slack (Workspace)`).
        teamName: 'Workspace',
      },
    });
  });

  it('treats a Slack-style 200 with ok:false as a rejection', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: false, error: 'invalid_code' }));

    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toEqual({
      ok: false,
      reason: 'vendor_rejected',
      code: 'invalid_code',
    });
  });

  it('drops an error code that is not a short symbolic value', async () => {
    // A hostile endpoint cannot smuggle a token (or a novel) into our logs
    // through the `error` field.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: `xoxb-secret ${'a'.repeat(200)}` }, 400),
      );

    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toEqual({ ok: false, reason: 'vendor_rejected' });
  });

  it('refuses a 2xx that carries no access token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ token_type: 'bearer' }));

    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toEqual({ ok: false, reason: 'malformed_response' });
  });

  it('refuses a non-JSON success body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>maintenance</html>'));

    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toEqual({ ok: false, reason: 'malformed_response' });
  });

  it('reports a transport failure without the vendor response', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket hang up'));

    const result = await exchangeAuthorizationCode(PARAMS, fetchImpl);

    expect(result).toEqual({ ok: false, reason: 'vendor_unreachable' });
  });

  it('refuses a plaintext token endpoint without contacting it', async () => {
    const fetchImpl = vi.fn();

    const result = await exchangeAuthorizationCode(
      { ...PARAMS, tokenUrl: 'http://vendor.example/oauth/token' },
      fetchImpl,
    );

    expect(result).toEqual({ ok: false, reason: 'vendor_unreachable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('refreshAccessToken', () => {
  const REFRESH = {
    tokenUrl: 'https://vendor.example/oauth/token',
    refreshToken: 'refresh-1',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };

  it('posts the refresh grant as a form body and normalizes the result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'access-2',
        expires_in: 3600,
        scope: 'mail.read',
      }),
    );

    const before = Date.now();
    const result = await refreshAccessToken(REFRESH, fetchImpl);

    // No refresh_token in the answer: the caller keeps the one it holds.
    expect(result).toMatchObject({
      ok: true,
      tokens: { accessToken: 'access-2', scopes: ['mail.read'] },
    });
    if (!result.ok) return;
    expect(result.tokens.refreshToken).toBeUndefined();
    expect(result.tokens.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(REFRESH.tokenUrl);
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'client-id',
      client_secret: 'client-secret',
    });
  });

  it('carries a rotated refresh token back', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2' }),
      );
    const result = await refreshAccessToken(REFRESH, fetchImpl);
    expect(result).toMatchObject({
      ok: true,
      tokens: { accessToken: 'access-2', refreshToken: 'refresh-2' },
    });
  });

  it('reports a dead grant as vendor_rejected with the symbolic code only', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked. secret-echo',
        },
        400,
      ),
    );
    const result = await refreshAccessToken(REFRESH, fetchImpl);
    expect(result).toEqual({
      ok: false,
      reason: 'vendor_rejected',
      code: 'invalid_grant',
    });
    expect(JSON.stringify(result)).not.toContain('secret-echo');
  });

  it('refuses a plaintext token endpoint without contacting it', async () => {
    const fetchImpl = vi.fn();
    const result = await refreshAccessToken(
      { ...REFRESH, tokenUrl: 'http://vendor.example/oauth/token' },
      fetchImpl,
    );
    expect(result).toEqual({ ok: false, reason: 'vendor_unreachable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// @vitest-environment node

/**
 * A refresh failure must say whether the GRANT is dead (only a new consent
 * fixes `invalid_grant`) or the token endpoint was merely unavailable (a
 * 429/5xx, a malformed answer). The resolver marks needs-reauth on the
 * first kind only — reading every non-OK as "dead" turned one vendor blip
 * during a cron sync into a state only the user could clear.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyRefreshFailure,
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
} from './token_refresh';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('classifyRefreshFailure', () => {
  it('reads invalid_grant on a 400 as a dead grant', () => {
    const result = classifyRefreshFailure(
      400,
      JSON.stringify({
        error: 'invalid_grant',
        error_description: 'AADSTS70008: The refresh token has expired.',
      }),
    );
    expect(result.kind).toBe('dead_grant');
    expect(result.detail).toContain('invalid_grant');
    expect(result.detail).toContain('AADSTS70008');
  });

  it('reads a consent/interaction demand as a dead grant', () => {
    expect(
      classifyRefreshFailure(400, JSON.stringify({ error: 'consent_required' }))
        .kind,
    ).toBe('dead_grant');
    expect(
      classifyRefreshFailure(
        401,
        JSON.stringify({ error: 'interaction_required' }),
      ).kind,
    ).toBe('dead_grant');
  });

  it('reads a throttle or an outage as unavailable', () => {
    expect(classifyRefreshFailure(429, '').kind).toBe('unavailable');
    expect(
      classifyRefreshFailure(503, JSON.stringify({ error: 'server_error' })),
    ).toMatchObject({ kind: 'unavailable', status: 503 });
    expect(
      classifyRefreshFailure(502, '<html>bad gateway</html>'),
    ).toMatchObject({ kind: 'unavailable', status: 502 });
  });

  it('reads a client misconfiguration as unavailable — reconnecting cannot fix it', () => {
    const result = classifyRefreshFailure(
      401,
      JSON.stringify({ error: 'invalid_client' }),
    );
    expect(result.kind).toBe('unavailable');
    expect(result.detail).toContain('invalid_client');
  });

  it('never treats invalid_grant on a 5xx as a verdict on the grant', () => {
    expect(
      classifyRefreshFailure(500, JSON.stringify({ error: 'invalid_grant' }))
        .kind,
    ).toBe('unavailable');
  });
});

describe('refreshMicrosoftAccessToken / refreshGoogleAccessToken', () => {
  const args = {
    refreshToken: 'rt',
    clientId: 'cid',
    clientSecret: 'sec',
  };

  it('returns the parsed tokens on a 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 },
            200,
          ),
        ),
    );
    const result = await refreshMicrosoftAccessToken({
      ...args,
      tenantId: 'tenant',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tokens.accessToken).toBe('at-2');
      expect(result.tokens.refreshToken).toBe('rt-2');
      expect(result.tokens.expiresAt).toBeGreaterThan(Date.now());
    }
  });

  it('classifies a 400 invalid_grant from Google as a dead grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: 'invalid_grant', error_description: 'Token revoked' },
            400,
          ),
        ),
    );
    const result = await refreshGoogleAccessToken(args);
    expect(result).toMatchObject({
      ok: false,
      kind: 'dead_grant',
      status: 400,
    });
  });

  it('classifies a 503 as unavailable, not as a dead grant', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })),
    );
    const result = await refreshMicrosoftAccessToken({
      ...args,
      tenantId: 'tenant',
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'unavailable',
      status: 503,
    });
  });

  it('treats a 200 without an access_token as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ token_type: 'Bearer' }, 200)),
    );
    const result = await refreshGoogleAccessToken(args);
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
  });
});

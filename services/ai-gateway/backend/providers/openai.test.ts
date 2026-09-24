import { describe, expect, it } from 'vitest';

import {
  createOpenAiProvider,
  identityFromIdToken,
  parseOpenAiUsage,
} from './openai';
import { stubFetch, jsonResponse as json } from './testing';
import { ProviderError } from './types';

function idToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

describe('beginAuthorization', () => {
  it('asks for a device code by default, the way codex login --device-auth does', async () => {
    // The answer OpenAI gave on 2026-09-24, with its handle shortened.
    const { fetchImpl, calls } = stubFetch(() =>
      json({
        device_auth_id: 'deviceauth_1',
        user_code: 'VNT9-KLUL5',
        interval: '5',
        expires_at: '2026-09-24T16:58:57.478963+00:00',
      }),
    );
    const request = await createOpenAiProvider({
      clientId: 'app_test',
      fetchImpl,
    }).beginAuthorization('state-1', {
      loopbackRedirectUri: null,
      preferBrowser: false,
    });

    expect(calls[0]?.url).toBe(
      'https://auth.openai.com/api/accounts/deviceauth/usercode',
    );
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ client_id: 'app_test' });
    expect(request).toEqual({
      flow: 'device',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'VNT9-KLUL5',
      deviceAuthId: 'deviceauth_1',
      intervalSeconds: 5,
      expiresAt: '2026-09-24T16:58:57.478Z',
    });
  });

  it('reports a device sign-in it could not start', async () => {
    const { fetchImpl } = stubFetch(() => json({}, 404));
    await expect(
      createOpenAiProvider({ fetchImpl }).beginAuthorization('state-1', {
        loopbackRedirectUri: null,
        preferBrowser: false,
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('builds the Codex loopback authorize URL when the browser flow is asked for', async () => {
    const provider = createOpenAiProvider({ clientId: 'app_test' });
    const request = await provider.beginAuthorization('state-1', {
      loopbackRedirectUri: 'http://localhost:3004/callback',
      preferBrowser: true,
    });
    if (request.flow === 'device') throw new Error('asked for the browser');
    const { authorizeUrl, redirectUri } = request;
    const url = new URL(authorizeUrl);

    // Codex's client redirects to its own loopback, whatever this gateway's
    // is, so the address bar still comes back by hand.
    expect(request.flow).toBe('paste');
    expect(request.pasteStyle).toBe('redirect-url');

    expect(url.origin + url.pathname).toBe(
      'https://auth.openai.com/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('app_test');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access',
    );
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(redirectUri).toBe('http://localhost:1455/auth/callback');
  });
});

describe('pollDeviceAuthorization', () => {
  const device = { deviceAuthId: 'deviceauth_1', userCode: 'VNT9-KLUL5' };

  it('reads 403 as a code nobody has approved yet', async () => {
    // What OpenAI answers until the person approves.
    const { fetchImpl, calls } = stubFetch(() =>
      json(
        {
          error: {
            message: 'Device authorization is pending. Please try again.',
            code: 'deviceauth_authorization_pending',
          },
        },
        403,
      ),
    );
    const poll = await createOpenAiProvider({
      fetchImpl,
    }).pollDeviceAuthorization?.(device);
    expect(poll).toEqual({ status: 'pending' });
    expect(calls[0]?.url).toBe(
      'https://auth.openai.com/api/accounts/deviceauth/token',
    );
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      device_auth_id: 'deviceauth_1',
      user_code: 'VNT9-KLUL5',
    });
  });

  it('answers the code to exchange once the person approved it', async () => {
    const { fetchImpl } = stubFetch(() =>
      json({
        authorization_code: 'code-1',
        code_challenge: 'challenge-1',
        code_verifier: 'verifier-1',
      }),
    );
    const poll = await createOpenAiProvider({
      fetchImpl,
    }).pollDeviceAuthorization?.(device);
    expect(poll).toEqual({
      status: 'approved',
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://auth.openai.com/deviceauth/callback',
    });
  });

  it('reads any other answer as a refusal', async () => {
    const { fetchImpl } = stubFetch(() => json({}, 400));
    expect(
      await createOpenAiProvider({ fetchImpl }).pollDeviceAuthorization?.(
        device,
      ),
    ).toEqual({ status: 'refused' });
  });

  it('keeps waiting through a poll that could not reach OpenAI', async () => {
    const provider = createOpenAiProvider({
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    expect(await provider.pollDeviceAuthorization?.(device)).toEqual({
      status: 'pending',
    });
  });
});

describe('exchangeCode', () => {
  it('posts a form body and reads identity out of the id_token', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        id_token: idToken({
          email: 'you@example.com',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct-1',
            chatgpt_plan_type: 'pro',
          },
        }),
      }),
    );
    const provider = createOpenAiProvider({
      clientId: 'app_test',
      fetchImpl,
    });

    const exchange = await provider.exchangeCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://localhost:1455/auth/callback',
      state: 'state-1',
    });

    expect(calls[0]?.url).toBe('https://auth.openai.com/oauth/token');
    const headers = calls[0]?.headers ?? new Headers();
    expect(headers.get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(calls[0]?.body ?? '');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(exchange.identity).toEqual({
      email: 'you@example.com',
      accountId: 'acct-1',
      subscription: { plan: 'pro', tier: null },
    });
  });

  it('reports a refused grant', async () => {
    const { fetchImpl } = stubFetch(() => json({}, 401));
    await expect(
      createOpenAiProvider({ fetchImpl }).exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'http://localhost:1455/auth/callback',
        state: 'state-1',
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('fetchUsage', () => {
  it('carries the account handle the backend keys the plan by', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      json({
        rate_limit: {
          primary_window: { used_percent: 12, limit_window_seconds: 18_000 },
        },
      }),
    );
    await createOpenAiProvider({ fetchImpl }).fetchUsage({
      accessToken: 'access-1',
      accountId: 'acct-1',
    });
    expect(calls[0]?.url).toBe('https://chatgpt.com/backend-api/codex/usage');
    expect(calls[0]?.headers.get('chatgpt-account-id')).toBe('acct-1');
  });

  it('answers the plan the reading is measured against', async () => {
    const { fetchImpl } = stubFetch(() =>
      json({
        plan_type: 'prolite',
        rate_limit: {
          primary_window: { used_percent: 7, limit_window_seconds: 604_800 },
          secondary_window: null,
        },
      }),
    );
    const reading = await createOpenAiProvider({ fetchImpl }).fetchUsage({
      accessToken: 'access-1',
      accountId: 'acct-1',
    });
    expect(reading.subscription).toEqual({ plan: 'prolite', tier: null });
    expect(reading.windows.map((window) => window.kind)).toEqual(['weekly']);
  });

  it('answers no plan when the reading names none', async () => {
    const { fetchImpl } = stubFetch(() => json({}));
    const reading = await createOpenAiProvider({ fetchImpl }).fetchUsage({
      accessToken: 'access-1',
      accountId: null,
    });
    expect(reading.subscription).toBeNull();
  });

  it('omits the header when no handle is known yet', async () => {
    const { fetchImpl, calls } = stubFetch(() => json({}));
    await createOpenAiProvider({ fetchImpl }).fetchUsage({
      accessToken: 'access-1',
      accountId: null,
    });
    expect(calls[0]?.headers.has('chatgpt-account-id')).toBe(false);
  });
});

describe('identityFromIdToken', () => {
  it('answers nulls when the token carries no claims it knows', () => {
    expect(identityFromIdToken(idToken({}))).toEqual({
      email: null,
      accountId: null,
      subscription: null,
    });
  });
});

describe('parseOpenAiUsage', () => {
  const now = new Date('2026-09-21T10:00:00.000Z');

  it('reads the answer the usage endpoint actually sends', () => {
    // Captured from a live ChatGPT Pro Lite account, trimmed to the keys this
    // parser reads: one weekly window, and its rollover as epoch seconds.
    expect(
      parseOpenAiUsage(
        {
          plan_type: 'prolite',
          rate_limit: {
            allowed: true,
            limit_reached: false,
            primary_window: {
              used_percent: 36,
              limit_window_seconds: 604_800,
              reset_after_seconds: 582_629,
              reset_at: 1_790_688_140,
            },
            secondary_window: null,
          },
          additional_rate_limits: null,
        },
        now,
      ),
    ).toEqual([
      {
        kind: 'weekly',
        label: null,
        utilization: 36,
        resetsAt: '2026-09-29T13:22:20.000Z',
        windowSeconds: 604_800,
      },
    ]);
  });

  it('reads the short window as the session cap and the long one as weekly', () => {
    expect(
      parseOpenAiUsage(
        {
          rate_limit: {
            primary_window: {
              used_percent: 20,
              limit_window_seconds: 18_000,
              reset_after_seconds: 1_800,
            },
            secondary_window: {
              used_percent: 55,
              limit_window_seconds: 604_800,
              reset_at: 1_790_294_400,
            },
          },
        },
        now,
      ),
    ).toEqual([
      {
        kind: 'session',
        label: null,
        utilization: 20,
        resetsAt: '2026-09-21T10:30:00.000Z',
        windowSeconds: 18_000,
      },
      {
        kind: 'weekly',
        label: null,
        utilization: 55,
        resetsAt: '2026-09-25T00:00:00.000Z',
        windowSeconds: 604_800,
      },
    ]);
  });

  it('orders by window length, not by the name the vendor used', () => {
    const windows = parseOpenAiUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 55, limit_window_seconds: 604_800 },
          secondary_window: { used_percent: 20, limit_window_seconds: 18_000 },
        },
      },
      now,
    );
    expect(windows.map((window) => window.kind)).toEqual(['session', 'weekly']);
    expect(windows[0]?.utilization).toBe(20);
  });

  it('leaves a window the vendor did not measure unmeasured', () => {
    const windows = parseOpenAiUsage(
      { rate_limit: { primary_window: { used_percent: 7 } } },
      now,
    );
    expect(windows[0]?.windowSeconds).toBeNull();
    expect(windows[0]?.kind).toBe('weekly');
  });

  it('calls a lone multi-day window weekly', () => {
    const windows = parseOpenAiUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 7, limit_window_seconds: 604_800 },
        },
      },
      now,
    );
    expect(windows[0]?.kind).toBe('weekly');
  });

  it('answers no windows for a payload it does not recognize', () => {
    expect(parseOpenAiUsage({}, now)).toEqual([]);
    expect(parseOpenAiUsage({ rate_limit: null }, now)).toEqual([]);
  });
});

describe('cliCommand', () => {
  it('exports the token Codex reads', () => {
    expect(createOpenAiProvider().cliCommand('access-1')).toBe(
      'CODEX_ACCESS_TOKEN=access-1 codex',
    );
  });
});

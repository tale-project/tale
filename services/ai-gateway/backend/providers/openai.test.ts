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
  it('builds the Codex loopback authorize URL', () => {
    const provider = createOpenAiProvider({ clientId: 'app_test' });
    const { authorizeUrl, redirectUri } =
      provider.beginAuthorization('state-1');
    const url = new URL(authorizeUrl);

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
      plan: 'pro',
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
        rate_limits: { primary: { used_percent: 12, window_minutes: 300 } },
      }),
    );
    await createOpenAiProvider({ fetchImpl }).fetchUsage({
      accessToken: 'access-1',
      accountId: 'acct-1',
    });
    expect(calls[0]?.url).toBe('https://chatgpt.com/backend-api/codex/usage');
    expect(calls[0]?.headers.get('chatgpt-account-id')).toBe('acct-1');
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
      plan: null,
    });
  });
});

describe('parseOpenAiUsage', () => {
  const now = new Date('2026-09-21T10:00:00.000Z');

  it('reads the short window as the session cap and the long one as weekly', () => {
    expect(
      parseOpenAiUsage(
        {
          rate_limits: {
            primary: {
              used_percent: 20,
              window_minutes: 300,
              resets_in_seconds: 1800,
            },
            secondary: {
              used_percent: 55,
              window_minutes: 10_080,
              resets_at: '2026-09-27T00:00:00Z',
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
      },
      {
        kind: 'weekly',
        label: null,
        utilization: 55,
        resetsAt: '2026-09-27T00:00:00.000Z',
      },
    ]);
  });

  it('orders by window length, not by the name the vendor used', () => {
    const windows = parseOpenAiUsage(
      {
        rate_limits: {
          primary: { used_percent: 55, window_minutes: 10_080 },
          secondary: { used_percent: 20, window_minutes: 300 },
        },
      },
      now,
    );
    expect(windows.map((window) => window.kind)).toEqual(['session', 'weekly']);
    expect(windows[0]?.utilization).toBe(20);
  });

  it('reads a payload that puts the windows at the top level', () => {
    expect(
      parseOpenAiUsage(
        { primary: { used_percent: 7, window_minutes: 300 } },
        now,
      ),
    ).toEqual([
      { kind: 'session', label: null, utilization: 7, resetsAt: null },
    ]);
  });

  it('calls a lone multi-day window weekly', () => {
    const windows = parseOpenAiUsage(
      { rate_limits: { primary: { used_percent: 7, window_minutes: 10_080 } } },
      now,
    );
    expect(windows[0]?.kind).toBe('weekly');
  });

  it('answers no windows for a payload it does not recognize', () => {
    expect(parseOpenAiUsage({}, now)).toEqual([]);
  });
});

describe('cliCommand', () => {
  it('exports the token Codex reads', () => {
    expect(createOpenAiProvider().cliCommand('access-1')).toBe(
      'CODEX_ACCESS_TOKEN=access-1 codex',
    );
  });
});

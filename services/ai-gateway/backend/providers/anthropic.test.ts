import { describe, expect, it } from 'vitest';

import { createAnthropicProvider, parseAnthropicUsage } from './anthropic';
import { stubFetch, jsonResponse as json } from './testing';
import { ProviderError } from './types';

describe('beginAuthorization', () => {
  it('builds the console copy-the-code authorize URL', () => {
    const provider = createAnthropicProvider({ clientId: 'client-1' });
    const { authorizeUrl, redirectUri, codeVerifier } =
      provider.beginAuthorization('state-1');
    const url = new URL(authorizeUrl);

    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code')).toBe('true');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('scope')).toBe(
      'org:create_api_key user:profile user:inference',
    );
    expect(redirectUri).toBe(
      'https://console.anthropic.com/oauth/code/callback',
    );
    expect(codeVerifier).not.toBe('');
  });
});

describe('exchangeCode', () => {
  it('sends the grant and normalizes the answer', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      json({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: 'user:inference',
        account: { email_address: 'you@example.com' },
        organization: { name: 'Acme' },
      }),
    );
    const provider = createAnthropicProvider({
      clientId: 'client-1',
      fetchImpl,
    });

    const exchange = await provider.exchangeCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'https://console.anthropic.com/oauth/code/callback',
      state: 'state-1',
    });

    expect(calls[0]?.url).toBe('https://console.anthropic.com/v1/oauth/token');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client-1',
      code: 'code-1',
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
      code_verifier: 'verifier-1',
      state: 'state-1',
    });
    expect(exchange.tokens.accessToken).toBe('access-1');
    expect(exchange.tokens.refreshToken).toBe('refresh-1');
    expect(exchange.tokens.expiresAt).not.toBeNull();
    expect(exchange.identity).toEqual({
      email: 'you@example.com',
      accountId: null,
      plan: 'Acme',
    });
  });

  it('reports a refused grant rather than answering a half token', async () => {
    const { fetchImpl } = stubFetch(() =>
      json({ error: 'invalid_grant' }, 400),
    );
    const provider = createAnthropicProvider({ fetchImpl });
    await expect(
      provider.exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'https://console.anthropic.com/oauth/code/callback',
        state: 'state-1',
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('reports a response that carries no access token', async () => {
    const { fetchImpl } = stubFetch(() => json({ refresh_token: 'only' }));
    const provider = createAnthropicProvider({ fetchImpl });
    await expect(
      provider.exchangeCode({
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'https://console.anthropic.com/oauth/code/callback',
        state: 'state-1',
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('refresh', () => {
  it('keeps the old refresh token when the answer omits a new one', async () => {
    const { fetchImpl } = stubFetch(() =>
      json({ access_token: 'access-2', expires_in: 3600 }),
    );
    const provider = createAnthropicProvider({ fetchImpl });
    const exchange = await provider.refresh('refresh-1');
    expect(exchange.tokens.refreshToken).toBe('refresh-1');
  });
});

describe('fetchIdentity', () => {
  it('asks the profile endpoint with the claude-code user agent', async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      json({
        account: { email: 'you@example.com' },
        organization: { name: 'Acme' },
      }),
    );
    const provider = createAnthropicProvider({
      claudeCodeVersion: '9.9.9',
      fetchImpl,
    });

    const identity = await provider.fetchIdentity?.({
      accessToken: 'access-1',
      accountId: null,
    });

    expect(calls[0]?.url).toBe('https://api.anthropic.com/api/oauth/profile');
    const headers = calls[0]?.headers ?? new Headers();
    expect(headers.get('user-agent')).toBe('claude-code/9.9.9');
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(headers.get('authorization')).toBe('Bearer access-1');
    expect(identity).toEqual({
      email: 'you@example.com',
      accountId: null,
      plan: 'Acme',
    });
  });
});

describe('fetchUsage', () => {
  it('reports an unreachable endpoint as a provider failure', async () => {
    const { fetchImpl } = stubFetch(() => json({}, 429));
    const provider = createAnthropicProvider({ fetchImpl });
    await expect(
      provider.fetchUsage({ accessToken: 'access-1', accountId: null }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('parseAnthropicUsage', () => {
  it('maps the two general windows, each with the length its key names', () => {
    expect(
      parseAnthropicUsage({
        five_hour: { utilization: 42, resets_at: '2026-09-21T15:00:00Z' },
        seven_day: { utilization: 8, resets_at: '2026-09-27T00:00:00Z' },
      }),
    ).toEqual([
      {
        kind: 'session',
        label: null,
        utilization: 42,
        resetsAt: '2026-09-21T15:00:00.000Z',
        windowSeconds: 18_000,
      },
      {
        kind: 'weekly',
        label: null,
        utilization: 8,
        resetsAt: '2026-09-27T00:00:00.000Z',
        windowSeconds: 604_800,
      },
    ]);
  });

  it('maps a per-model cap out of the limits array', () => {
    const windows = parseAnthropicUsage({
      limits: [
        {
          scope: { model: { display_name: 'Fable' } },
          group: 'weekly',
          kind: 'weekly_scoped',
          percent: 61,
        },
        { scope: {}, percent: 5 },
      ],
    });
    expect(windows).toEqual([
      {
        kind: 'scoped',
        label: 'Fable',
        utilization: 61,
        resetsAt: null,
        windowSeconds: 604_800,
      },
    ]);
  });

  it('leaves a per-model cap unmeasured when it names no family', () => {
    const windows = parseAnthropicUsage({
      limits: [{ scope: { model: { display_name: 'Fable' } }, percent: 61 }],
    });
    expect(windows[0]?.windowSeconds).toBeNull();
  });

  it('answers no windows for a payload it does not recognize', () => {
    expect(parseAnthropicUsage({})).toEqual([]);
    expect(parseAnthropicUsage({ limits: 'not an array' })).toEqual([]);
  });
});

describe('cliCommand', () => {
  it('exports the token Claude Code reads', () => {
    expect(createAnthropicProvider().cliCommand('access-1')).toBe(
      'ANTHROPIC_AUTH_TOKEN=access-1 claude',
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  createAnthropicProvider,
  parseAnthropicUsage,
  subscriptionFromOrganization,
} from './anthropic';
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
    // The token answer names the organization, which is not a plan: the
    // plan column once showed "Acme" (or "you@example.com's Organization").
    expect(exchange.identity).toEqual({
      email: 'you@example.com',
      accountId: null,
      subscription: null,
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
  it('names a refused grant apart from a refresh that merely failed', async () => {
    for (const [status, code] of [
      [400, 'refresh_rejected'],
      [401, 'refresh_rejected'],
      [429, 'refresh_failed'],
      [503, 'refresh_failed'],
    ] as const) {
      const { fetchImpl } = stubFetch(() => json({}, status));
      await expect(
        createAnthropicProvider({ fetchImpl }).refresh('refresh-1'),
      ).rejects.toMatchObject({ code });
    }
  });

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
      // The fields the profile endpoint answers with for a Max account.
      json({
        account: { email: 'you@example.com', has_claude_max: true },
        organization: {
          name: "you@example.com's Organization",
          organization_type: 'claude_max',
          rate_limit_tier: 'default_claude_max_20x',
          subscription_status: 'active',
        },
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
      subscription: { plan: 'max', tier: '20x' },
    });
  });
});

describe('subscriptionFromOrganization', () => {
  it('reads the plan without the product prefix, and the multiple it is sold at', () => {
    expect(
      subscriptionFromOrganization({
        organization_type: 'claude_max',
        rate_limit_tier: 'default_claude_max_5x',
      }),
    ).toEqual({ plan: 'max', tier: '5x' });
  });

  it('reads no multiple from a tier that names none', () => {
    expect(
      subscriptionFromOrganization({
        organization_type: 'claude_pro',
        rate_limit_tier: 'default_claude_ai',
      }),
    ).toEqual({ plan: 'pro', tier: null });
    expect(
      subscriptionFromOrganization({ organization_type: 'claude_team' }),
    ).toEqual({ plan: 'team', tier: null });
  });

  it('keeps a plan it has no name for, rather than dropping it', () => {
    expect(
      subscriptionFromOrganization({ organization_type: 'claude_edu_plus' }),
    ).toEqual({ plan: 'edu_plus', tier: null });
  });

  it('answers null when the profile names no plan at all', () => {
    expect(subscriptionFromOrganization({ name: 'Acme' })).toBeNull();
    expect(subscriptionFromOrganization(null)).toBeNull();
  });
});

describe('fetchUsage', () => {
  it('answers the windows, and no plan — the usage answer carries none', async () => {
    const { fetchImpl } = stubFetch(() =>
      json({ five_hour: { utilization: 42, resets_at: null } }),
    );
    const provider = createAnthropicProvider({ fetchImpl });
    const reading = await provider.fetchUsage({
      accessToken: 'access-1',
      accountId: null,
    });
    expect(reading.windows.map((window) => window.kind)).toEqual(['session']);
    expect(reading.subscription).toBeNull();
  });

  it('treats a 200 that carries no reading as a failed read', async () => {
    // A rate-limited read can arrive as a 200 with an error body and no
    // window; mapped as it stood, it replaced a good reading with nothing.
    const { fetchImpl } = stubFetch(() =>
      json({
        error: { type: 'rate_limit_error', message: 'Rate limited.' },
      }),
    );
    const provider = createAnthropicProvider({ fetchImpl });
    await expect(
      provider.fetchUsage({ accessToken: 'access-1', accountId: null }),
    ).rejects.toMatchObject({ code: 'usage_failed' });
  });

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

  it('draws a per-model row only from a weekly_scoped limit', () => {
    // Claude Code classifies a row on its `kind`, never on its label: an
    // entry of another kind naming the same model must not become a second
    // "Fable" beside the weekly one.
    const windows = parseAnthropicUsage({
      limits: [
        {
          kind: 'session_scoped',
          group: 'session',
          percent: 40,
          scope: { model: { display_name: 'Fable' } },
        },
        { scope: { model: { display_name: 'Fable' } }, percent: 61 },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 82,
          scope: { model: { display_name: 'Fable' } },
        },
      ],
    });
    expect(windows).toEqual([
      {
        kind: 'scoped',
        label: 'Fable',
        utilization: 82,
        resetsAt: null,
        windowSeconds: 604_800,
      },
    ]);
  });

  it('reads the answer Claude Code renders as its /usage the same way', () => {
    // Captured from a live Max account on 2026-09-24, trimmed to the keys
    // this mapping reads plus the ones it must pass over. `/usage` showed
    // "Current session 79%", "Current week (all models) 57%" and
    // "Current week (Fable) 82%" for it.
    const windows = parseAnthropicUsage({
      five_hour: {
        utilization: 79,
        resets_at: '2026-09-24T20:39:59.978700+00:00',
      },
      seven_day: {
        utilization: 57,
        resets_at: '2026-09-26T16:59:59.978719+00:00',
      },
      seven_day_opus: null,
      seven_day_sonnet: null,
      nimbus_quill: { utilization: 0, resets_at: null },
      extra_usage: { is_enabled: false, utilization: null },
      limits: [
        { kind: 'session', group: 'session', percent: 79, scope: null },
        { kind: 'weekly_all', group: 'weekly', percent: 57, scope: null },
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: 82,
          resets_at: '2026-09-26T16:59:59.978933+00:00',
          scope: { model: { id: null, display_name: 'Fable' }, surface: null },
          is_active: true,
        },
      ],
    });
    expect(
      windows.map(({ kind, label, utilization }) => [kind, label, utilization]),
    ).toEqual([
      ['session', null, 79],
      ['weekly', null, 57],
      ['scoped', 'Fable', 82],
    ]);
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

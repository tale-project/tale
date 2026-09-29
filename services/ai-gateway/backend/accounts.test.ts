import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountError,
  createAccountService,
  loopbackRedirectUri,
  refreshStaggerShare,
} from './accounts';
import { createTokenCipher } from './crypto';
import {
  ProviderError,
  type AuthorizationRequest,
  type BeginAuthorizationOptions,
  type DevicePoll,
  type Provider,
  type Subscription,
  type UsageWindow,
} from './providers/types';
import {
  createMemoryAccountStore,
  type AccountStore,
  type StoredAccount,
} from './store';

const cipher = createTokenCipher(randomBytes(32));

/** A provider that answers from memory and records what it was asked. */
/** How a refresh fails: the vendor refusing the grant, or a passing fault. */
type RefreshRefusal = 'rejected' | 'failed';

/**
 * Holds a call open until the test lets it go, so two passes can be made to
 * overlap exactly where a real race would.
 */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => undefined as void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function fakeProvider(id: 'anthropic' | 'openai'): Provider & {
  usage: UsageWindow[];
  usagePlan: Subscription | null;
  refusals: { refresh?: RefreshRefusal; usage?: boolean; exchange?: boolean };
  gates: { refresh?: Promise<void>; usage?: Promise<void> };
  refreshCount: number;
  refreshedExpiresAt: string;
  usageCount: number;
  identityCount: number;
  offersDevice: boolean;
  devicePoll: DevicePoll;
  pollCount: number;
} {
  const state = {
    usage: [
      {
        kind: 'session',
        label: null,
        utilization: 10,
        resetsAt: null,
        windowSeconds: null,
      },
    ] as UsageWindow[],
    /** The plan a usage answer names, as ChatGPT's does; null like Claude's. */
    usagePlan: null as Subscription | null,
    refusals: {} as {
      refresh?: RefreshRefusal;
      usage?: boolean;
      exchange?: boolean;
    },
    gates: {} as { refresh?: Promise<void>; usage?: Promise<void> },
    refreshCount: 0,
    /** The expiry a refreshed token comes back with. */
    refreshedExpiresAt: '2026-09-21T12:00:00.000Z',
    usageCount: 0,
    identityCount: 0,
    /** Whether this vendor signs in with a device code, as OpenAI's does. */
    offersDevice: false,
    /** What the vendor answers the next device poll with. */
    devicePoll: { status: 'pending' } as DevicePoll,
    pollCount: 0,
  };

  return Object.assign(state, {
    id,
    cliCommand: (accessToken: string) => `FAKE_TOKEN=${accessToken} fake`,
    beginAuthorization: (
      stateValue: string,
      options: BeginAuthorizationOptions,
    ): Promise<AuthorizationRequest> => {
      if (state.offersDevice && !options.preferBrowser) {
        return Promise.resolve({
          flow: 'device',
          verificationUrl: 'https://example.test/device',
          userCode: 'ABCD-EFGH',
          deviceAuthId: 'device-1',
          intervalSeconds: 5,
          expiresAt: '2026-09-21T10:15:00.000Z',
        });
      }
      return Promise.resolve({
        flow: options.loopbackRedirectUri ? 'redirect' : 'paste',
        authorizeUrl: `https://example.test/authorize?state=${stateValue}`,
        codeVerifier: 'verifier',
        redirectUri:
          options.loopbackRedirectUri ?? 'https://example.test/callback',
        pasteStyle: 'code',
      });
    },
    pollDeviceAuthorization: () => {
      state.pollCount += 1;
      return Promise.resolve(state.devicePoll);
    },
    parseCallback: (pasted: string) => ({
      code: pasted.split('#')[0] ?? '',
      state: pasted.split('#')[1] ?? null,
    }),
    exchangeCode: () => {
      if (state.refusals.exchange) {
        throw new ProviderError(id, 'authorization_failed', 'refused');
      }
      return Promise.resolve({
        tokens: {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          expiresAt: '2026-09-21T11:00:00.000Z',
          scopes: 'scope',
        },
        identity: {
          email: 'you@example.com',
          accountId: null,
          subscription: null,
        },
      });
    },
    refresh: async () => {
      state.refreshCount += 1;
      const count = state.refreshCount;
      await state.gates.refresh;
      if (state.refusals.refresh) {
        throw new ProviderError(
          id,
          state.refusals.refresh === 'rejected'
            ? 'refresh_rejected'
            : 'refresh_failed',
          'refused',
        );
      }
      return {
        tokens: {
          accessToken: `access-${count + 1}`,
          refreshToken: `refresh-${count + 1}`,
          expiresAt: state.refreshedExpiresAt,
          scopes: 'scope',
        },
        identity: null,
      };
    },
    fetchIdentity: () => {
      state.identityCount += 1;
      return Promise.resolve({
        email: 'you@example.com',
        accountId: null,
        subscription: { plan: 'max', tier: '20x' },
      });
    },
    fetchUsage: async () => {
      state.usageCount += 1;
      await state.gates.usage;
      if (state.refusals.usage) {
        throw new ProviderError(id, 'usage_failed', 'refused');
      }
      return { windows: state.usage, subscription: state.usagePlan };
    },
  });
}

describe('createAccountService', () => {
  let store: AccountStore;
  let anthropic: ReturnType<typeof fakeProvider>;
  let openai: ReturnType<typeof fakeProvider>;
  let now: Date;
  let service: ReturnType<typeof createAccountService>;

  beforeEach(() => {
    store = createMemoryAccountStore();
    anthropic = fakeProvider('anthropic');
    openai = fakeProvider('openai');
    now = new Date('2026-09-21T10:00:00.000Z');
    service = createAccountService({
      store,
      providers: { anthropic, openai },
      cipher,
      tokenRefreshSkewSeconds: 300,
      // The lifecycle below runs on the skew alone; the stagger and the
      // hand-out floor have their own block.
      tokenMinHandoutSeconds: 0,
      usageMinIntervalSeconds: 180,
      now: () => now,
      refreshStagger: () => 0,
    });
  });

  async function connectFor(
    provider: 'anthropic' | 'openai',
    pasted = 'code-1',
  ) {
    const { state } = await service.beginAuthorization({ provider });
    return service.completeAuthorization({ state, pasted });
  }

  async function connect(pasted = 'code-1') {
    return connectFor('anthropic', pasted);
  }

  it('connects an account and labels it from the provider identity', async () => {
    const account = await connect();
    expect(account.label).toBe('you@example.com');
    expect(account.provider).toBe('anthropic');
    expect(account.status).toBe('active');
    expect(account.usage?.windows).toHaveLength(1);
  });

  it('never lets a stored credential reach the panel view', async () => {
    const account = await connect();
    expect(Object.keys(account)).not.toContain('accessToken');
    const stored = await store.getAccount(account.id);
    expect(stored?.accessToken).not.toBe('access-1');
    expect(cipher.open(stored?.accessToken ?? '')).toBe('access-1');
  });

  it('takes a name given at the start over the provider identity', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
      label: '  work account  ',
    });
    const account = await service.completeAuthorization({
      state,
      pasted: 'code-1',
    });
    expect(account.label).toBe('work account');
  });

  it('consumes an authorization so a replayed paste cannot reuse it', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    await service.completeAuthorization({ state, pasted: 'code-1' });
    await expect(
      service.completeAuthorization({ state, pasted: 'code-1' }),
    ).rejects.toMatchObject({ code: 'unknown_state' });
  });

  it('refuses a paste that carries a different authorization state', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    await expect(
      service.completeAuthorization({ state, pasted: 'code-1#other-state' }),
    ).rejects.toMatchObject({ code: 'state_mismatch' });
  });

  it('refuses a paste with no code in it', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    await expect(
      service.completeAuthorization({ state, pasted: '#only-state' }),
    ).rejects.toMatchObject({ code: 'missing_code' });
  });

  it('reports a provider that refuses the code', async () => {
    anthropic.refusals.exchange = true;
    await expect(connect()).rejects.toMatchObject({ code: 'exchange_failed' });
  });

  it('re-authenticates onto the existing row instead of adding a second', async () => {
    const first = await connect();
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
      accountId: first.id,
    });
    const again = await service.completeAuthorization({
      state,
      pasted: 'code-2',
    });
    expect(again.id).toBe(first.id);
    expect(await service.list()).toHaveLength(1);
  });

  it('refuses to re-authenticate an account that is gone', async () => {
    await expect(
      service.beginAuthorization({ provider: 'anthropic', accountId: 'gone' }),
    ).rejects.toBeInstanceOf(AccountError);
  });

  it('refuses to put another vendor credential on an existing account', async () => {
    const account = await connect();
    await expect(
      service.beginAuthorization({ provider: 'openai', accountId: account.id }),
    ).rejects.toMatchObject({ code: 'unknown_account' });
    expect((await store.getAccount(account.id))?.provider).toBe('anthropic');
  });

  it('clears the former account identity and quota when reauthorizing', async () => {
    const account = await connectFor('openai');
    await store.updateAccount(account.id, (row) => {
      row.accountId = 'former-chatgpt-account';
      row.usage = {
        checkedAt: now.toISOString(),
        windows: [
          {
            kind: 'weekly',
            label: null,
            utilization: 100,
            resetsAt: null,
            windowSeconds: 604_800,
          },
        ],
      };
    });
    openai.refusals.usage = true;
    const { state } = await service.beginAuthorization({
      provider: 'openai',
      accountId: account.id,
    });
    await service.completeAuthorization({ state, pasted: 'new-grant' });
    const updated = await store.getAccount(account.id);
    expect(updated?.accountId).toBeNull();
    expect(updated?.usage).toBeNull();
  });

  it.each([undefined, 'rejected', 'failed'] as const)(
    'does not let a late refresh (%s) overwrite a newly authorized grant',
    async (refusal) => {
      const account = await connect();
      now = new Date('2026-09-21T10:56:00.000Z');
      const held = gate();
      anthropic.gates.refresh = held.wait;
      anthropic.refusals.refresh = refusal;
      const handouts = service.handOutTokens();
      await vi.waitFor(() => expect(anthropic.refreshCount).toBe(1));
      vi.spyOn(anthropic, 'exchangeCode').mockResolvedValue({
        tokens: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresAt: '2026-09-21T12:00:00.000Z',
          scopes: 'scope',
        },
        identity: null,
      });
      const { state } = await service.beginAuthorization({
        provider: 'anthropic',
        accountId: account.id,
      });
      await service.completeAuthorization({ state, pasted: 'new-grant' });
      held.open();
      await handouts;
      expect(
        cipher.open((await store.getAccount(account.id))!.refreshToken),
      ).toBe('new-refresh');
      expect((await store.getAccount(account.id))!.status).toBe('active');
    },
  );

  it('hands out a decrypted token', async () => {
    await connect();
    const [handout] = await service.handOutTokens();
    expect(handout?.accessToken).toBe('access-1');
    expect(handout?.provider).toBe('anthropic');
  });

  it('keeps the gateway account id and vendor identity through a token rotation', async () => {
    const account = await connectFor('openai');
    await store.updateAccount(account.id, (row) => {
      row.accountId = 'chatgpt-account-1';
    });
    now = new Date('2026-09-21T10:56:00.000Z');
    const [handout] = await service.handOutTokens('openai');
    expect(handout).toMatchObject({
      id: account.id,
      accountId: 'chatgpt-account-1',
      accessToken: 'access-2',
      available: true,
      availableAt: null,
      hold: null,
      usage: { checkedAt: now.toISOString() },
    });
  });

  it('reports a fresh exhausted general window without retiring the account', async () => {
    anthropic.usage = [
      {
        kind: 'session',
        label: null,
        utilization: 100,
        resetsAt: '2026-09-21T10:05:00.000Z',
        windowSeconds: 18_000,
      },
      {
        kind: 'weekly',
        label: null,
        utilization: 100,
        resetsAt: '2026-09-23T10:00:00.000Z',
        windowSeconds: 604_800,
      },
    ];
    await connect();
    const [handout] = await service.handOutTokens('anthropic');
    expect(handout).toMatchObject({
      status: 'active',
      available: false,
      availableAt: '2026-09-23T10:00:00.000Z',
      hold: 'quota',
      usage: { checkedAt: now.toISOString(), windows: anthropic.usage },
    });
  });

  it('does not block the whole account for a model-specific cap', async () => {
    anthropic.usage = [
      {
        kind: 'scoped',
        label: 'Model A',
        utilization: 100,
        resetsAt: '2026-09-23T10:00:00.000Z',
        windowSeconds: 604_800,
      },
    ];
    await connect();
    const [handout] = await service.handOutTokens();
    expect(handout?.available).toBe(true);
    expect(handout?.availableAt).toBeNull();
  });

  it.each([
    { windows: [] },
    {
      windows: [
        {
          kind: 'session',
          label: null,
          utilization: 99.9,
          resetsAt: '2026-09-21T11:00:00.000Z',
          windowSeconds: 18_000,
        },
      ],
    },
  ] satisfies { windows: UsageWindow[] }[])(
    'honors an explicit quota limit without fabricating full windows: %j',
    async ({ windows }) => {
      const account = await connectFor('openai');
      await store.updateAccount(account.id, (row) => {
        row.usage = { checkedAt: now.toISOString(), windows, limited: true };
      });
      expect((await service.handOutTokens('openai'))[0]).toMatchObject({
        available: false,
        availableAt: null,
        hold: 'quota',
      });
    },
  );

  it('ignores an old explicit quota limit after the observed full window resets', async () => {
    const account = await connectFor('openai');
    await store.updateAccount(account.id, (row) => {
      row.usage = {
        checkedAt: now.toISOString(),
        windows: [
          {
            kind: 'session',
            label: null,
            utilization: 100,
            resetsAt: '2026-09-21T10:01:00.000Z',
            windowSeconds: 18_000,
          },
        ],
        limited: true,
      };
    });
    now = new Date('2026-09-21T10:01:00.000Z');
    expect((await service.handOutTokens('openai'))[0]?.available).toBe(true);
  });

  it('releases an exhausted account when its window resets inside the usage polling floor', async () => {
    anthropic.usage = [
      {
        kind: 'session',
        label: null,
        utilization: 100,
        resetsAt: '2026-09-21T10:01:00.000Z',
        windowSeconds: 18_000,
      },
    ];
    await connect();
    expect((await service.handOutTokens())[0]?.available).toBe(false);
    now = new Date('2026-09-21T10:01:00.000Z');
    expect((await service.handOutTokens())[0]?.available).toBe(true);
    expect(anthropic.usageCount).toBe(1);
  });

  it('does not let stale or future usage timestamps block an account', async () => {
    anthropic.usage = [
      {
        kind: 'weekly',
        label: null,
        utilization: 100,
        resetsAt: '2026-09-23T10:00:00.000Z',
        windowSeconds: 604_800,
      },
    ];
    const account = await connect();
    anthropic.refusals.usage = true;
    now = new Date('2026-09-21T10:15:00.000Z');
    expect((await service.handOutTokens())[0]?.available).toBe(true);
    await store.updateAccount(account.id, (row) => {
      if (row.usage) row.usage.checkedAt = '2026-09-21T11:00:00.000Z';
    });
    expect((await service.handOutTokens())[0]?.available).toBe(true);
  });

  it('treats an exhausted window with no reset as unavailable only while the reading is fresh', async () => {
    anthropic.usage[0].utilization = 100;
    await connect();
    expect((await service.handOutTokens())[0]).toMatchObject({
      available: false,
      availableAt: null,
    });
    anthropic.refusals.usage = true;
    now = new Date('2026-09-21T10:15:00.000Z');
    expect((await service.handOutTokens())[0]?.available).toBe(true);
  });

  it('rereads usage on hand-out after the polling floor', async () => {
    await connect();
    anthropic.usage[0].utilization = 100;
    now = new Date('2026-09-21T10:04:00.000Z');
    const [handout] = await service.handOutTokens();
    expect(anthropic.usageCount).toBe(2);
    expect(handout?.available).toBe(false);
  });

  it('narrows the pool to one vendor when asked for one', async () => {
    await connectFor('anthropic');
    await connectFor('openai', 'code-2');

    expect((await service.handOutTokens()).map((h) => h.provider)).toEqual([
      'anthropic',
      'openai',
    ]);
    expect(
      (await service.handOutTokens('anthropic')).map((h) => h.provider),
    ).toEqual(['anthropic']);
    expect(
      (await service.handOutTokens('openai')).map((h) => h.provider),
    ).toEqual(['openai']);
  });

  it('refreshes only the vendor it was asked for', async () => {
    await connectFor('anthropic');
    await connectFor('openai', 'code-2');
    // Both tokens expire at 11:00 and the skew is five minutes, so an
    // unnarrowed pass would refresh both.
    now = new Date('2026-09-21T10:56:00.000Z');

    await service.handOutTokens('openai');

    expect(openai.refreshCount).toBe(1);
    expect(anthropic.refreshCount).toBe(0);
  });

  it('refreshes a token that is inside the skew window before handing it out', async () => {
    await connect();
    // The token expires at 11:00 and the skew is five minutes.
    now = new Date('2026-09-21T10:56:00.000Z');
    const [handout] = await service.handOutTokens();
    expect(anthropic.refreshCount).toBe(1);
    expect(handout?.accessToken).toBe('access-2');
  });

  it('leaves a token that is still comfortably valid alone', async () => {
    await connect();
    now = new Date('2026-09-21T10:30:00.000Z');
    await service.handOutTokens();
    expect(anthropic.refreshCount).toBe(0);
  });

  it('marks an account expired when the vendor refuses its refresh token', async () => {
    await connect();
    anthropic.refusals.refresh = 'rejected';
    now = new Date('2026-09-21T11:30:00.000Z');
    const [handout] = await service.handOutTokens();
    expect(handout?.status).toBe('expired');
    // Still listed, so the panel can offer re-authentication.
    expect(await service.list()).toHaveLength(1);
  });

  it('marks an account errored — not expired — when a refresh fails for a passing reason', async () => {
    await connect();
    anthropic.refusals.refresh = 'failed';
    now = new Date('2026-09-21T11:30:00.000Z');
    const [handout] = await service.handOutTokens();
    // A rate limit or an outage: the refresh token is still good.
    expect(handout?.status).toBe('error');
  });

  it('marks an account expired when its stored refresh token no longer opens', async () => {
    const account = await connect();
    // What a replaced AI_GATEWAY_ENCRYPTION_KEY leaves behind: a sealed value
    // this process cannot open, which no retry will change.
    await store.updateAccount(account.id, (row) => {
      row.refreshToken = createTokenCipher(randomBytes(32)).seal('refresh-1');
    });
    now = new Date('2026-09-21T11:30:00.000Z');
    const [handout] = await service.handOutTokens();
    expect(handout?.status).toBe('expired');
    expect(anthropic.refreshCount).toBe(0);
  });

  it('pauses before trying a refresh that failed for a passing reason again', async () => {
    await connect();
    anthropic.refusals.refresh = 'failed';
    now = new Date('2026-09-21T11:30:00.000Z');
    await service.handOutTokens();
    await service.handOutTokens();
    expect(anthropic.refreshCount).toBe(1);

    anthropic.refusals.refresh = undefined;
    now = new Date('2026-09-21T11:31:30.000Z');
    const [handout] = await service.handOutTokens();
    expect(anthropic.refreshCount).toBe(2);
    expect(handout?.status).toBe('active');
  });

  it('shares one refresh between callers that arrive together', async () => {
    await connect();
    now = new Date('2026-09-21T10:56:00.000Z');
    const held = gate();
    anthropic.gates.refresh = held.wait;

    // A hand-out, the panel's poll and a second hand-out, all at once.
    const calls = Promise.all([
      service.handOutTokens(),
      service.list(),
      service.handOutTokens(),
    ]);
    await vi.waitFor(() => expect(anthropic.refreshCount).toBe(1));
    held.open();
    const [first, , third] = await calls;

    // Both vendors rotate the refresh token, so a second refresh would have
    // spent one the first had already retired.
    expect(anthropic.refreshCount).toBe(1);
    expect(first[0]?.accessToken).toBe('access-2');
    expect(third[0]?.accessToken).toBe('access-2');
  });

  it('shares one usage read between hand-outs, panel polls and the background pass', async () => {
    await connect();
    now = new Date('2026-09-21T10:10:00.000Z');
    const held = gate();
    anthropic.gates.usage = held.wait;
    const calls = Promise.all([
      service.handOutTokens(),
      service.list(),
      service.refreshAll(),
      service.handOutTokens(),
    ]);
    await vi.waitFor(() => expect(anthropic.usageCount).toBeGreaterThan(1));
    held.open();
    await calls;
    expect(anthropic.usageCount).toBe(2);
  });

  it('refreshes different accounts concurrently while preserving pool order', async () => {
    await connectFor('anthropic');
    await connectFor('openai');
    now = new Date('2026-09-21T10:56:00.000Z');
    const held = gate();
    anthropic.gates.refresh = held.wait;
    const handouts = service.handOutTokens();
    try {
      await vi.waitFor(() => expect(openai.refreshCount).toBe(1));
    } finally {
      held.open();
    }
    expect((await handouts).map((row) => row.provider)).toEqual([
      'anthropic',
      'openai',
    ]);
  });

  it('keeps serving other accounts when one stored access token is unreadable', async () => {
    const broken = await connect();
    const healthy = await connectFor('openai');
    await store.updateAccount(broken.id, (row) => {
      row.accessToken = createTokenCipher(randomBytes(32)).seal('access-1');
    });
    expect((await service.handOutTokens()).map((row) => row.id)).toEqual([
      healthy.id,
    ]);
    expect((await store.getAccount(broken.id))?.status).toBe('expired');
  });

  it('does not hand out an account removed during a refresh', async () => {
    const account = await connect();
    now = new Date('2026-09-21T10:56:00.000Z');
    const held = gate();
    anthropic.gates.refresh = held.wait;
    const handouts = service.handOutTokens();
    await vi.waitFor(() => expect(anthropic.refreshCount).toBe(1));
    await service.remove(account.id);
    held.open();
    expect(await handouts).toEqual([]);
  });

  it('keeps a refresh token rotated while a usage read was in flight', async () => {
    const account = await connect();
    // A read starts from the row as it stood — refresh-1 — and hangs.
    now = new Date('2026-09-21T10:10:00.000Z');
    const held = gate();
    anthropic.gates.usage = held.wait;
    const reading = service.list();
    await vi.waitFor(() => expect(anthropic.usageCount).toBe(2));

    // Meanwhile the token nears its expiry and a hand-out refreshes it.
    now = new Date('2026-09-21T10:56:00.000Z');
    const handouts = service.handOutTokens();
    await vi.waitFor(() => expect(anthropic.refreshCount).toBe(1));
    held.open();
    await Promise.all([reading, handouts]);
    // The read wrote its own fields only; the rotated grant survives it.
    const stored = await store.getAccount(account.id);
    expect(cipher.open(stored?.refreshToken ?? '')).toBe('refresh-2');
    expect(cipher.open(stored?.accessToken ?? '')).toBe('access-2');
  });

  it('keeps the last reading, and when it was read, through a failed read', async () => {
    await connect();
    anthropic.refusals.usage = true;
    now = new Date('2026-09-21T10:10:00.000Z');
    const [row] = await service.list();
    expect(row?.status).toBe('active');
    expect(row?.usage?.windows).toHaveLength(1);
    // The figures are from 10:00, and the row still says so.
    expect(row?.usage?.checkedAt).toBe('2026-09-21T10:00:00.000Z');

    // The floor counts from the failed attempt, not from the old reading.
    now = new Date('2026-09-21T10:12:00.000Z');
    await service.list();
    expect(anthropic.usageCount).toBe(2);
    now = new Date('2026-09-21T10:14:00.000Z');
    await service.list();
    expect(anthropic.usageCount).toBe(3);
  });

  it('does not bring back an account removed while it was being read', async () => {
    const account = await connect();
    now = new Date('2026-09-21T10:10:00.000Z');
    const held = gate();
    anthropic.gates.usage = held.wait;
    const pass = service.refreshAll();
    await vi.waitFor(() => expect(anthropic.usageCount).toBe(2));

    await service.remove(account.id);
    held.open();
    await pass;
    expect(await service.list()).toEqual([]);
  });

  it('keeps valid credentials eligible when only the usage call fails', async () => {
    await connect();
    anthropic.refusals.usage = true;
    now = new Date('2026-09-21T10:10:00.000Z');
    const [account] = await service.list();
    expect(account?.status).toBe('active');
  });

  it('serves a cached usage reading inside the polling floor', async () => {
    await connect();
    const spy = vi.spyOn(anthropic, 'fetchUsage');
    now = new Date('2026-09-21T10:02:00.000Z');
    await service.list();
    expect(spy).not.toHaveBeenCalled();

    now = new Date('2026-09-21T10:04:00.000Z');
    await service.list();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('asks for the account identity only until it knows it', async () => {
    await connect();
    const before = anthropic.identityCount;
    now = new Date('2026-09-21T10:10:00.000Z');
    await service.list();
    expect(anthropic.identityCount).toBe(before);
  });

  it('reads the plan from the profile, not from the token answer', async () => {
    // The fake's token answer names no plan, the way Anthropic's names only
    // the organization; the profile is what says "max" and its multiple.
    const account = await connect();
    expect(account.subscription).toEqual({ plan: 'max', tier: '20x' });
  });

  it('asks again once what it knows about the plan has aged', async () => {
    await connect();
    const before = anthropic.identityCount;
    // Seven hours on: past the six the answer stands for. The token is
    // refreshed on the way, which the identity read does not depend on.
    now = new Date('2026-09-21T17:00:00.000Z');
    await service.list();
    expect(anthropic.identityCount).toBe(before + 1);
  });

  it('takes the plan a usage answer names over what it knew', async () => {
    await connectFor('openai');

    // The subscription changed since it was last read — ChatGPT's usage
    // answer names the plan it measures against, and that is the fresher.
    openai.usagePlan = { plan: 'prolite', tier: null };
    now = new Date('2026-09-21T10:10:00.000Z');
    const [row] = await service.list();
    expect(row?.subscription).toEqual({ plan: 'prolite', tier: null });
  });

  it('builds the CLI command from a freshly refreshed token', async () => {
    const account = await connect();
    now = new Date('2026-09-21T10:56:00.000Z');
    expect(await service.cliCommand(account.id)).toBe(
      'FAKE_TOKEN=access-2 fake',
    );
  });

  it('answers null for a CLI command nobody has an account for', async () => {
    expect(await service.cliCommand('gone')).toBeNull();
  });

  it('removes an account and says whether it found one', async () => {
    const account = await connect();
    expect(await service.remove(account.id)).toBe(true);
    expect(await service.remove(account.id)).toBe(false);
    expect(await service.list()).toEqual([]);
  });

  it('pools both providers side by side', async () => {
    await connect();
    const { state } = await service.beginAuthorization({ provider: 'openai' });
    await service.completeAuthorization({ state, pasted: 'code-3' });
    expect((await service.list()).map((row) => row.provider)).toEqual([
      'anthropic',
      'openai',
    ]);
  });

  it('drops an authorization nobody completed within the lifetime', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    now = new Date('2026-09-21T11:00:00.000Z');
    await service.refreshAll();
    await expect(
      service.completeAuthorization({ state, pasted: 'code-1' }),
    ).rejects.toMatchObject({ code: 'unknown_state' });
  });
  it('leaves the attempt open after a paste with no code in it', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    await expect(
      service.completeAuthorization({ state, pasted: '#only-state' }),
    ).rejects.toMatchObject({ code: 'missing_code' });
    // The wrong thing was copied; the right thing still connects.
    const account = await service.completeAuthorization({
      state,
      pasted: 'code-1',
    });
    expect(account.status).toBe('active');
  });

  it('reports a finished paste to a panel asking after it', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    const account = await service.completeAuthorization({
      state,
      pasted: 'code-1',
    });
    expect(await service.authorizationStatus(state)).toEqual({
      status: 'connected',
      account,
    });
  });

  describe('the device flow', () => {
    beforeEach(() => {
      openai.offersDevice = true;
    });

    it('connects the account once the vendor says it was approved, with no paste', async () => {
      const start = await service.beginAuthorization({
        provider: 'openai',
        label: 'team seat',
      });
      expect(start).toMatchObject({
        flow: 'device',
        userCode: 'ABCD-EFGH',
        verificationUrl: 'https://example.test/device',
        pollIntervalSeconds: 5,
      });
      // The vendor's handle is a secret while it lives: never in the answer.
      expect(JSON.stringify(start)).not.toContain('device-1');
      expect(await service.authorizationStatus(start.state)).toEqual({
        status: 'pending',
      });

      openai.devicePoll = {
        status: 'approved',
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'https://example.test/device/callback',
      };
      now = new Date('2026-09-21T10:00:06.000Z');
      const status = await service.authorizationStatus(start.state);
      expect(status).toMatchObject({
        status: 'connected',
        account: { label: 'team seat', provider: 'openai', status: 'active' },
      });
      expect(await service.list()).toHaveLength(1);
    });

    it('asks the vendor no more often than it asked to be asked', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'openai',
      });
      await service.authorizationStatus(state);
      now = new Date('2026-09-21T10:00:02.000Z');
      await service.authorizationStatus(state);
      expect(openai.pollCount).toBe(1);

      now = new Date('2026-09-21T10:00:05.000Z');
      await service.authorizationStatus(state);
      expect(openai.pollCount).toBe(2);
    });

    it('mints one account when two panels ask the moment it is approved', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'openai',
      });
      openai.devicePoll = {
        status: 'approved',
        code: 'code-1',
        codeVerifier: 'verifier-1',
        redirectUri: 'https://example.test/device/callback',
      };
      const [first, second] = await Promise.all([
        service.authorizationStatus(state),
        service.authorizationStatus(state),
      ]);
      expect(first.status).toBe('connected');
      expect(second.status).toBe('connected');
      expect(await service.list()).toHaveLength(1);
    });

    it('fails a code that ran out before anybody approved it', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'openai',
      });
      now = new Date('2026-09-21T10:15:00.000Z');
      expect(await service.authorizationStatus(state)).toEqual({
        status: 'failed',
        code: 'expired',
      });
      expect(openai.pollCount).toBe(0);
    });

    it('fails a code the vendor refused', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'openai',
      });
      openai.devicePoll = { status: 'refused' };
      expect(await service.authorizationStatus(state)).toEqual({
        status: 'failed',
        code: 'denied',
      });
    });

    it('takes no paste for a code that finishes on its own', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'openai',
      });
      await expect(
        service.completeAuthorization({ state, pasted: 'code-1' }),
      ).rejects.toMatchObject({ code: 'unknown_state' });
    });

    it('offers the browser flow when it is asked for', async () => {
      const start = await service.beginAuthorization({
        provider: 'openai',
        preferBrowser: true,
      });
      expect(start.flow).toBe('paste');
    });
  });

  describe('the redirect flow', () => {
    it('comes back to this gateway when the browser reaches it on loopback', async () => {
      const start = await service.beginAuthorization({
        provider: 'anthropic',
        loopbackOrigin: 'http://localhost:3004',
      });
      expect(start.flow).toBe('redirect');

      const done = await service.completeRedirect({
        state: start.state,
        code: 'code-1',
        error: null,
      });
      expect(done).toMatchObject({ status: 'connected' });
      // The panel that started it reads the same outcome.
      expect(await service.authorizationStatus(start.state)).toEqual(done);
      expect(await service.list()).toHaveLength(1);
    });

    it('never offers it to a browser that reaches the gateway anywhere else', async () => {
      const start = await service.beginAuthorization({
        provider: 'anthropic',
        loopbackOrigin: 'https://ai.tale.dev',
      });
      expect(start.flow).toBe('paste');
    });

    it('records a consent the person declined at the vendor', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'anthropic',
        loopbackOrigin: 'http://localhost:3004',
      });
      expect(
        await service.completeRedirect({
          state,
          code: null,
          error: 'access_denied',
        }),
      ).toEqual({ status: 'failed', code: 'denied' });
    });

    it('answers a reload of the callback with the outcome it already had', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'anthropic',
        loopbackOrigin: 'http://localhost:3004',
      });
      await service.completeRedirect({ state, code: 'code-1', error: null });
      await service.completeRedirect({ state, code: 'code-1', error: null });
      expect(await service.list()).toHaveLength(1);
    });

    it('still takes the address bar by hand, for a browser the redirect did not reach', async () => {
      const { state } = await service.beginAuthorization({
        provider: 'anthropic',
        loopbackOrigin: 'http://127.0.0.1:3004',
      });
      const account = await service.completeAuthorization({
        state,
        pasted: 'code-1',
      });
      expect(account.status).toBe('active');
    });
  });
});

/**
 * Observed live (2026-09-28): every Anthropic account was refreshed at
 * 11:00:58 with an eight-hour token, so all of them were due — and revoked —
 * at the same instant; a turn cut two minutes after a refresh failed with
 * "401 OAuth access token has been revoked". These run on the real stagger
 * and a one-hour floor, over that pool.
 */
describe('staggered refreshes and the hand-out floor', () => {
  const ISSUED = '2026-09-28T11:00:58.000Z';
  const EXPIRES = '2026-09-28T19:00:58.000Z';
  const HOUR = 60 * 60 * 1000;
  /** The skew point: five minutes before the vendor's expiry. */
  const SKEW_POINT = Date.parse(EXPIRES) - 5 * 60 * 1000;
  /** Half the window between the token's issue and the skew point. */
  const SPREAD = (SKEW_POINT - Date.parse(ISSUED)) / 2;
  const plannedRefresh = (id: string) =>
    new Date(SKEW_POINT - SPREAD * refreshStaggerShare(id)).toISOString();

  let store: AccountStore;
  let anthropic: ReturnType<typeof fakeProvider>;
  let now: Date;

  /** Two accounts refreshed together, as the incident's pool was. `early`
   * and `late` are ids whose stagger shares sit near either end. */
  async function alignedPool() {
    for (const id of ['early', 'late']) {
      await store.putAccount(storedAccount(id));
    }
  }

  function storedAccount(
    id: string,
    overrides: Partial<StoredAccount> = {},
  ): StoredAccount {
    return {
      id,
      provider: 'anthropic',
      label: id,
      accountEmail: `${id}@example.com`,
      accountId: null,
      plan: null,
      subscription: { plan: 'max', tier: '20x' },
      identityCheckedAt: ISSUED,
      accessToken: cipher.seal(`${id}-access`),
      refreshToken: cipher.seal(`${id}-refresh`),
      expiresAt: EXPIRES,
      scopes: 'user:inference',
      status: 'active',
      createdAt: ISSUED,
      lastRefreshedAt: ISSUED,
      usage: null,
      usageAttemptedAt: null,
      ...overrides,
    };
  }

  function service(tokenMinHandoutSeconds = 3600) {
    return createAccountService({
      store,
      providers: { anthropic, openai: fakeProvider('openai') },
      cipher,
      tokenRefreshSkewSeconds: 300,
      tokenMinHandoutSeconds,
      usageMinIntervalSeconds: 180,
      now: () => now,
    });
  }

  beforeEach(() => {
    store = createMemoryAccountStore();
    anthropic = fakeProvider('anthropic');
    now = new Date(ISSUED);
  });

  it('plans a different refresh for each of two accounts that expire together', async () => {
    await alignedPool();
    const handouts = await service().handOutTokens('anthropic');
    const refreshAt = Object.fromEntries(
      handouts.map((handout) => [handout.id, handout.refreshAt]),
    );
    expect(refreshAt).toEqual({
      early: plannedRefresh('early'),
      late: plannedRefresh('late'),
    });
    // Hours apart, not seconds: the pool is never revoked all at once.
    expect(
      Date.parse(plannedRefresh('late')) - Date.parse(plannedRefresh('early')),
    ).toBeGreaterThan(3 * HOUR);
    // Neither is later than the skew alone would have it.
    for (const at of Object.values(refreshAt)) {
      expect(Date.parse(at ?? '')).toBeLessThanOrEqual(SKEW_POINT);
    }
  });

  it('refreshes on a hand-out only the account that is due under its own threshold', async () => {
    await alignedPool();
    anthropic.refreshedExpiresAt = '2026-09-29T00:00:00.000Z';
    // Past the early account's planned refresh, well before the late one's.
    now = new Date(Date.parse(plannedRefresh('early')) + 60_000);
    expect(now.getTime()).toBeLessThan(Date.parse(plannedRefresh('late')));

    const handouts = await service().handOutTokens('anthropic');

    expect(anthropic.refreshCount).toBe(1);
    const byId = Object.fromEntries(handouts.map((h) => [h.id, h]));
    expect(byId.early?.accessToken).toBe('access-2');
    expect(byId.late?.accessToken).toBe('late-access');
    // The refresh restarts the early account's own cycle from now on.
    expect((await store.getAccount('early'))?.lastRefreshedAt).toBe(
      now.toISOString(),
    );
  });

  it('never refreshes two accounts refreshed together in one pass, over a month of passes', async () => {
    await alignedPool();
    const gateway = service();
    const refreshedAt: Record<string, string[]> = { early: [], late: [] };
    // A background pass every five minutes for thirty days, each refresh
    // handing out a fresh eight-hour token. Cycles of different lengths
    // meet now and then; the spacing keeps them in different passes.
    for (let at = Date.parse(ISSUED); at < Date.parse(ISSUED) + 720 * HOUR;) {
      at += 5 * 60 * 1000;
      now = new Date(at);
      anthropic.refreshedExpiresAt = new Date(at + 8 * HOUR).toISOString();
      await gateway.refreshAll();
      for (const id of ['early', 'late']) {
        const stored = await store.getAccount(id);
        const last = stored?.lastRefreshedAt ?? '';
        if (last !== ISSUED && !refreshedAt[id]?.includes(last)) {
          refreshedAt[id]?.push(last);
        }
      }
    }
    expect(refreshedAt.early?.length).toBeGreaterThan(50);
    expect(refreshedAt.late?.length).toBeGreaterThan(50);
    // No pass refreshed both: one refresh never cuts the runs of the pool.
    const both = refreshedAt.early?.filter((at) =>
      refreshedAt.late?.includes(at),
    );
    expect(both).toEqual([]);
  });

  it('refreshes two due accounts of one vendor ten minutes apart', async () => {
    // `account-a` plans its refresh at about 15:02, `early` at about 15:10.
    await store.putAccount(storedAccount('early'));
    await store.putAccount(storedAccount('account-a'));
    anthropic.refreshedExpiresAt = '2026-09-29T00:00:00.000Z';
    const gateway = service();
    const tokens = async () =>
      Object.fromEntries(
        (await gateway.handOutTokens('anthropic')).map((h) => [
          h.id,
          h.accessToken,
        ]),
      );

    now = new Date('2026-09-28T15:10:00.000Z');
    const first = await tokens();
    expect(anthropic.refreshCount).toBe(1);
    // One of the two waits for its turn, still on its own token.
    expect(
      [first.early, first['account-a']].filter((token) =>
        token?.endsWith('-access'),
      ),
    ).toHaveLength(1);

    now = new Date('2026-09-28T15:15:00.000Z');
    await tokens();
    expect(anthropic.refreshCount).toBe(1);

    now = new Date('2026-09-28T15:20:01.000Z');
    const later = await tokens();
    expect(anthropic.refreshCount).toBe(2);
    expect(Object.values(later).some((t) => t.endsWith('-access'))).toBe(false);
  });

  it('refreshes a token at its skew point even inside the spacing', async () => {
    await alignedPool();
    anthropic.refreshedExpiresAt = '2026-09-29T03:00:00.000Z';
    // Past both skew points (18:55:58): neither token can wait any longer.
    now = new Date('2026-09-28T18:56:30.000Z');
    await service().handOutTokens('anthropic');
    expect(anthropic.refreshCount).toBe(2);
  });

  it('serves an account inside the floor as unavailable until its planned refresh', async () => {
    await alignedPool();
    // Forty minutes before the early account's planned refresh.
    now = new Date(Date.parse(plannedRefresh('early')) - 40 * 60 * 1000);

    const handouts = await service().handOutTokens('anthropic');

    const byId = Object.fromEntries(handouts.map((h) => [h.id, h]));
    expect(byId.early).toMatchObject({
      status: 'active',
      accessToken: 'early-access',
      available: false,
      availableAt: plannedRefresh('early'),
      // Only the floor holds it: a consumer with no other account may use it.
      hold: 'refresh',
      refreshAt: plannedRefresh('early'),
      // The vendor's expiry is still reported, and still later.
      expiresAt: EXPIRES,
    });
    expect(byId.late).toMatchObject({
      available: true,
      availableAt: null,
      hold: null,
    });
    expect(anthropic.refreshCount).toBe(0);
  });

  it('names what holds each account back, so a consumer can tell the hold it may fall back to', async () => {
    // Forty minutes before the early account's planned refresh.
    now = new Date(Date.parse(plannedRefresh('early')) - 40 * 60 * 1000);
    const read = new Date(now.getTime() - 60_000).toISOString();
    await store.putAccount(storedAccount('early'));
    await store.putAccount(storedAccount('late'));
    await store.putAccount(
      storedAccount('spent', {
        usage: {
          checkedAt: read,
          windows: [
            {
              kind: 'session',
              label: null,
              utilization: 100,
              resetsAt: new Date(now.getTime() + 2 * HOUR).toISOString(),
              windowSeconds: 18_000,
            },
          ],
          limited: null,
        },
        usageAttemptedAt: read,
      }),
    );

    const handouts = await service().handOutTokens('anthropic');

    // `late` can take the work as this gateway sees the pool, so the floor
    // holds `early` back. A consumer that cannot use `late` — a cooldown
    // after a rate limit, a vendor account id it requires — may still start
    // on `early`, as the gateway itself would with nothing else left; never
    // on `spent`, whose quota is gone.
    expect(
      Object.fromEntries(
        handouts.map((h) => [h.id, { available: h.available, hold: h.hold }]),
      ),
    ).toEqual({
      early: { available: false, hold: 'refresh' },
      late: { available: true, hold: null },
      spent: { available: false, hold: 'quota' },
    });
  });

  it('hands the account out again once its planned refresh has renewed the token', async () => {
    await alignedPool();
    now = new Date(Date.parse(plannedRefresh('early')) + 1_000);
    anthropic.refreshedExpiresAt = new Date(
      now.getTime() + 8 * HOUR,
    ).toISOString();

    const early = (await service().handOutTokens('anthropic')).find(
      (handout) => handout.id === 'early',
    );

    expect(early).toMatchObject({
      accessToken: 'access-2',
      available: true,
      availableAt: null,
    });
    expect(Date.parse(early?.refreshAt ?? '')).toBeGreaterThan(
      now.getTime() + HOUR,
    );
  });

  it('holds back a token whose planned refresh is overdue while the refresh keeps failing', async () => {
    await alignedPool();
    anthropic.refusals.refresh = 'failed';
    now = new Date(Date.parse(plannedRefresh('early')) + 1_000);
    const gateway = service();

    const early = (await gateway.handOutTokens('anthropic')).find(
      (handout) => handout.id === 'early',
    );

    // The token still works — the usage read says so — but the retried
    // refresh may end it any minute, so no time can be promised.
    expect(anthropic.refreshCount).toBe(1);
    expect(early).toMatchObject({
      status: 'active',
      accessToken: 'early-access',
      available: false,
      availableAt: null,
      hold: 'refresh',
      refreshAt: plannedRefresh('early'),
    });

    // A minute on, the retry fails too and no usage read is due: the
    // account reads `error`, and is still held back.
    now = new Date(Date.parse(plannedRefresh('early')) + 62_000);
    const retried = (await gateway.handOutTokens('anthropic')).find(
      (handout) => handout.id === 'early',
    );
    expect(anthropic.refreshCount).toBe(2);
    // The hold stays the floor's; the status is the consumer's own check.
    expect(retried).toMatchObject({
      status: 'error',
      available: false,
      hold: 'refresh',
    });
  });

  it('leaves an account the vendor refused to its status, not the floor', async () => {
    await alignedPool();
    anthropic.refusals.refresh = 'rejected';
    now = new Date(Date.parse(plannedRefresh('early')) + 1_000);

    const early = (await service().handOutTokens('anthropic')).find(
      (handout) => handout.id === 'early',
    );

    // The consumer's status check says why; `available` stays the quota's.
    expect(early).toMatchObject({
      status: 'expired',
      available: true,
      hold: null,
    });
  });

  it('never holds back a vendor’s only account', async () => {
    // A pool of one: refusing all work for the hour before each refresh
    // would fail every start in it. The turn may be cut by the refresh and
    // resume on a fresh token instead.
    await store.putAccount(storedAccount('early'));
    now = new Date(Date.parse(plannedRefresh('early')) - 40 * 60 * 1000);
    const [early] = await service().handOutTokens('anthropic');
    expect(early).toMatchObject({
      available: true,
      availableAt: null,
      hold: null,
    });
  });

  it('hands out the account with the most life left when every one is inside the floor', async () => {
    // `account-a` plans its refresh at about 15:02, `early` at about 15:10.
    await store.putAccount(storedAccount('early'));
    await store.putAccount(storedAccount('account-a'));
    now = new Date('2026-09-28T14:30:00.000Z');
    const byId = Object.fromEntries(
      (await service().handOutTokens('anthropic')).map((h) => [h.id, h]),
    );
    expect(byId.early).toMatchObject({
      available: true,
      availableAt: null,
      hold: null,
    });
    expect(byId['account-a']).toMatchObject({
      available: false,
      availableAt: new Date(
        SKEW_POINT - SPREAD * refreshStaggerShare('account-a'),
      ).toISOString(),
      hold: 'refresh',
    });
  });

  it('counts only an account with quota left as one that can take the work', async () => {
    await store.putAccount(storedAccount('early'));
    // `late` is outside its floor, but a fresh reading shows its session
    // window spent, so it cannot take the work either.
    await store.putAccount(
      storedAccount('late', {
        usage: {
          checkedAt: '2026-09-28T14:29:00.000Z',
          windows: [
            {
              kind: 'session',
              label: null,
              utilization: 100,
              resetsAt: '2026-09-28T16:00:00.000Z',
              windowSeconds: 18_000,
            },
          ],
          limited: null,
        },
        usageAttemptedAt: '2026-09-28T14:29:00.000Z',
      }),
    );
    now = new Date(Date.parse(plannedRefresh('early')) - 40 * 60 * 1000);
    const byId = Object.fromEntries(
      (await service().handOutTokens('anthropic')).map((h) => [h.id, h]),
    );
    expect(byId.late).toMatchObject({ available: false, hold: 'quota' });
    expect(byId.early).toMatchObject({
      available: true,
      availableAt: null,
      hold: null,
    });
  });

  it('hands out every token when the floor is off', async () => {
    await alignedPool();
    now = new Date(Date.parse(plannedRefresh('early')) - 40 * 60 * 1000);
    const handouts = await service(0).handOutTokens('anthropic');
    expect(handouts.map((handout) => handout.available)).toEqual([true, true]);
  });

  it('does not hold back a token whose whole planned life is shorter than the floor', async () => {
    // A one-hour token: the next one would be no longer.
    await store.putAccount(
      storedAccount('early', { expiresAt: '2026-09-28T12:00:58.000Z' }),
    );
    // Twenty minutes before its planned refresh, inside the hour.
    now = new Date('2026-09-28T11:10:00.000Z');
    const [handout] = await service().handOutTokens('anthropic');
    expect(anthropic.refreshCount).toBe(0);
    expect(handout).toMatchObject({ available: true, availableAt: null });
  });

  it('holds an overdue short-lived token while a healthy account can serve', async () => {
    await store.putAccount(
      storedAccount('early', { expiresAt: '2026-09-28T12:00:58.000Z' }),
    );
    await store.putAccount(storedAccount('late'));
    const gateway = service();
    const [fresh] = await gateway.handOutTokens('anthropic');
    expect(fresh?.available).toBe(true);
    now = new Date(Date.parse(fresh?.refreshAt ?? '') + 1_000);
    anthropic.refusals.refresh = 'failed';

    const overdue = (await gateway.handOutTokens('anthropic')).find(
      (handout) => handout.id === 'early',
    );

    expect(anthropic.refreshCount).toBe(1);
    expect(overdue).toMatchObject({
      status: 'active',
      accessToken: 'early-access',
      available: false,
      availableAt: null,
    });
  });

  it.each([
    ['a quota reset before the refresh', '2026-09-28T14:45:00.000Z', 'refresh'],
    ['a quota reset after the refresh', '2026-09-28T20:00:00.000Z', 'quota'],
  ] as const)(
    'names the later release when %s also blocks',
    async (_label, resetsAt, later) => {
      anthropic.usage = [
        {
          kind: 'session',
          label: null,
          utilization: 100,
          resetsAt,
          windowSeconds: 18_000,
        },
      ];
      await alignedPool();
      now = new Date(Date.parse(plannedRefresh('early')) - 40 * 60 * 1000);
      const early = (await service().handOutTokens('anthropic')).find(
        (handout) => handout.id === 'early',
      );
      expect(early).toMatchObject({
        available: false,
        availableAt: later === 'quota' ? resetsAt : plannedRefresh('early'),
        // Whichever lifts later, a spent quota is never a hold to fall
        // back to.
        hold: 'quota',
      });
    },
  );
});

describe('loopbackRedirectUri', () => {
  it.each([
    ['http://localhost:3004', 'http://localhost:3004/callback'],
    ['http://127.0.0.1:8080', 'http://localhost:8080/callback'],
    ['http://[::1]:3000', 'http://localhost:3000/callback'],
    ['http://localhost', 'http://localhost/callback'],
  ])('sends %s back to its own /callback', (origin, redirect) => {
    expect(loopbackRedirectUri(origin)).toBe(redirect);
  });

  it.each([
    'https://ai.tale.dev',
    'http://gateway.example.com:3004',
    'https://localhost:3004',
    'http://localhost:3004/somewhere',
    'http://user@localhost:3004',
    'not a url',
  ])('offers no redirect to %s', (origin) => {
    expect(loopbackRedirectUri(origin)).toBeNull();
  });

  it('offers none when the browser sent no origin', () => {
    expect(loopbackRedirectUri(null)).toBeNull();
  });
});

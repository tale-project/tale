import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AccountError,
  createAccountService,
  loopbackRedirectUri,
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
import { createMemoryAccountStore, type AccountStore } from './store';

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
          expiresAt: '2026-09-21T12:00:00.000Z',
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
      usageMinIntervalSeconds: 180,
      now: () => now,
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

  it('hands out a decrypted token', async () => {
    await connect();
    const [handout] = await service.handOutTokens();
    expect(handout?.accessToken).toBe('access-1');
    expect(handout?.provider).toBe('anthropic');
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
    await service.handOutTokens();
    expect(anthropic.refreshCount).toBe(1);

    held.open();
    await reading;
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
    expect(row?.status).toBe('error');
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

  it('marks an account errored — not expired — when only the usage call fails', async () => {
    await connect();
    anthropic.refusals.usage = true;
    now = new Date('2026-09-21T10:10:00.000Z');
    const [account] = await service.list();
    expect(account?.status).toBe('error');
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

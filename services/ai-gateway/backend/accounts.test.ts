import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountError, createAccountService } from './accounts';
import { createTokenCipher } from './crypto';
import {
  ProviderError,
  type Provider,
  type UsageWindow,
} from './providers/types';
import { createMemoryAccountStore, type AccountStore } from './store';

const cipher = createTokenCipher(randomBytes(32));

/** A provider that answers from memory and records what it was asked. */
function fakeProvider(id: 'anthropic' | 'openai'): Provider & {
  usage: UsageWindow[];
  refusals: { refresh?: boolean; usage?: boolean; exchange?: boolean };
  refreshCount: number;
  identityCount: number;
} {
  const state = {
    usage: [
      { kind: 'session', label: null, utilization: 10, resetsAt: null },
    ] as UsageWindow[],
    refusals: {} as { refresh?: boolean; usage?: boolean; exchange?: boolean },
    refreshCount: 0,
    identityCount: 0,
  };

  return Object.assign(state, {
    id,
    callbackStyle: 'code' as const,
    cliTokenEnvVar: 'FAKE_TOKEN',
    cliCommand: (accessToken: string) => `FAKE_TOKEN=${accessToken} fake`,
    beginAuthorization: (stateValue: string) => ({
      authorizeUrl: `https://example.test/authorize?state=${stateValue}`,
      codeVerifier: 'verifier',
      redirectUri: 'https://example.test/callback',
    }),
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
        identity: { email: 'you@example.com', accountId: null, plan: null },
      });
    },
    refresh: () => {
      state.refreshCount += 1;
      if (state.refusals.refresh) {
        return Promise.reject(
          new ProviderError(id, 'refresh_failed', 'refused'),
        );
      }
      return Promise.resolve({
        tokens: {
          accessToken: `access-${state.refreshCount + 1}`,
          refreshToken: `refresh-${state.refreshCount + 1}`,
          expiresAt: '2026-09-21T12:00:00.000Z',
          scopes: 'scope',
        },
        identity: null,
      });
    },
    fetchIdentity: () => {
      state.identityCount += 1;
      return Promise.resolve({
        email: 'you@example.com',
        accountId: null,
        plan: 'Max',
      });
    },
    fetchUsage: () => {
      if (state.refusals.usage) {
        return Promise.reject(new ProviderError(id, 'usage_failed', 'refused'));
      }
      return Promise.resolve(state.usage);
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

  async function connect(pasted = 'code-1') {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    return service.completeAuthorization({ state, pasted });
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

  it('takes an explicit label over the provider identity', async () => {
    const { state } = await service.beginAuthorization({
      provider: 'anthropic',
    });
    const account = await service.completeAuthorization({
      state,
      pasted: 'code-1',
      label: '  work account  ',
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

  it('hands out a decrypted token and the variable its CLI reads', async () => {
    await connect();
    const [handout] = await service.handOutTokens();
    expect(handout?.accessToken).toBe('access-1');
    expect(handout?.envVar).toBe('FAKE_TOKEN');
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

  it('marks an account expired when its refresh token stops working', async () => {
    await connect();
    anthropic.refusals.refresh = true;
    now = new Date('2026-09-21T11:30:00.000Z');
    const [handout] = await service.handOutTokens();
    expect(handout?.status).toBe('expired');
    // Still listed, so the panel can offer re-authentication.
    expect(await service.list()).toHaveLength(1);
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
});

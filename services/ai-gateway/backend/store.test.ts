import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createFileAccountStore,
  createMemoryAccountStore,
  StoreError,
  toAccountView,
  type AccountStore,
  type PendingAuthorization,
  type StoredAccount,
} from './store';

function account(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    id: 'account-1',
    provider: 'anthropic',
    label: 'you@example.com',
    accountEmail: 'you@example.com',
    accountId: null,
    plan: null,
    subscription: null,
    identityCheckedAt: null,
    accessToken: 'v1.sealed.access',
    refreshToken: 'v1.sealed.refresh',
    expiresAt: '2026-09-22T10:00:00.000Z',
    scopes: 'user:inference',
    status: 'active',
    createdAt: '2026-09-21T10:00:00.000Z',
    lastRefreshedAt: null,
    usage: null,
    usageAttemptedAt: null,
    ...overrides,
  };
}

function pending(
  overrides: Partial<PendingAuthorization> = {},
): PendingAuthorization {
  return {
    state: 'state-1',
    provider: 'openai',
    targetAccountId: null,
    createdAt: '2026-09-21T10:00:00.000Z',
    flow: 'paste',
    label: null,
    codeVerifier: 'verifier',
    redirectUri: 'http://localhost:1455/auth/callback',
    deviceAuthId: null,
    userCode: null,
    pollIntervalSeconds: null,
    expiresAt: null,
    phase: 'open',
    accountId: null,
    failure: null,
    ...overrides,
  };
}

describe('createMemoryAccountStore', () => {
  it('behaves like the file store without touching disk', async () => {
    const store = createMemoryAccountStore();
    expect(await store.listAccounts()).toEqual([]);

    await store.putAccount(account());
    await store.putAccount(account({ label: 'renamed' }));
    expect(await store.listAccounts()).toHaveLength(1);
    expect((await store.getAccount('account-1'))?.label).toBe('renamed');

    await store.addPending(pending());
    expect(await store.claimPending('state-1')).not.toBeNull();
    expect(await store.claimPending('state-1')).toBeNull();

    expect(await store.deleteAccount('account-1')).toBe(true);
    expect(await store.deleteAccount('account-1')).toBe(false);
  });
});

describe('createFileAccountStore', () => {
  let dir: string;
  let store: AccountStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-gateway-store-'));
    store = createFileAccountStore({ dataDir: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads an empty pool before the document exists', async () => {
    expect(await store.listAccounts()).toEqual([]);
    expect(await store.getAccount('account-1')).toBeNull();
  });

  it('round-trips an account through the document', async () => {
    await store.putAccount(account());
    expect(await store.getAccount('account-1')).toEqual(account());
  });

  it('replaces an account rather than appending a second row', async () => {
    await store.putAccount(account());
    await store.putAccount(account({ label: 'renamed' }));
    const accounts = await store.listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.label).toBe('renamed');
  });

  it('orders the pool by when each account arrived', async () => {
    await store.putAccount(
      account({ id: 'second', createdAt: '2026-09-21T12:00:00.000Z' }),
    );
    await store.putAccount(
      account({ id: 'first', createdAt: '2026-09-21T08:00:00.000Z' }),
    );
    expect((await store.listAccounts()).map((row) => row.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('serializes concurrent writes instead of losing one', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_value, index) =>
        store.putAccount(account({ id: `account-${index}` })),
      ),
    );
    expect(await store.listAccounts()).toHaveLength(12);
  });

  it('reports whether a delete found anything', async () => {
    await store.putAccount(account());
    expect(await store.deleteAccount('account-1')).toBe(true);
    expect(await store.deleteAccount('account-1')).toBe(false);
  });

  it('hands a pending authorization out for completion exactly once', async () => {
    await store.addPending(pending());
    const [first, second] = await Promise.all([
      store.claimPending('state-1'),
      store.claimPending('state-1'),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await store.getPending('state-1'))?.phase).toBe('claimed');
  });

  it('keeps how an authorization ended, for the panel asking after it', async () => {
    await store.addPending(pending());
    await store.claimPending('state-1');
    await store.settlePending('state-1', {
      phase: 'connected',
      accountId: 'account-1',
    });
    expect(await store.getPending('state-1')).toMatchObject({
      phase: 'connected',
      accountId: 'account-1',
    });
    // Finished is not open again: nothing can claim it a second time.
    expect(await store.claimPending('state-1')).toBeNull();
  });

  it('reads an authorization from before the automatic flows as a paste one', async () => {
    const legacy = {
      state: 'state-1',
      provider: 'anthropic',
      codeVerifier: 'verifier',
      redirectUri: 'https://console.anthropic.com/oauth/code/callback',
      targetAccountId: null,
      createdAt: '2026-09-21T10:00:00.000Z',
    };
    await writeFile(
      join(dir, 'accounts.json'),
      JSON.stringify({ version: 1, accounts: [], pending: [legacy] }),
      'utf8',
    );
    expect(await store.getPending('state-1')).toMatchObject({
      flow: 'paste',
      phase: 'open',
      label: null,
    });
  });

  it('prunes only the authorizations that aged out', async () => {
    const now = new Date('2026-09-21T11:00:00.000Z');
    for (const [state, createdAt] of [
      ['stale', '2026-09-21T10:00:00.000Z'],
      ['fresh', '2026-09-21T10:55:00.000Z'],
    ] as const) {
      await store.addPending(pending({ state, createdAt }));
    }
    expect(await store.prunePending(30 * 60 * 1000, now)).toBe(1);
    expect(await store.getPending('stale')).toBeNull();
    expect(await store.getPending('fresh')).not.toBeNull();
  });

  it('keeps the file readable and owner-only', async () => {
    await store.putAccount(account());
    const raw = await readFile(join(dir, 'accounts.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('reads a document from before the plan had its own field', async () => {
    // What an Anthropic row looked like then: the organization's name in
    // `plan`, and no subscription, identity clock or countdown length.
    const legacy = {
      ...account(),
      plan: "you@example.com's Organization",
      subscription: undefined,
      identityCheckedAt: undefined,
      usage: {
        checkedAt: '2026-09-21T10:00:00.000Z',
        windows: [
          { kind: 'weekly', label: null, utilization: 57, resetsAt: null },
        ],
      },
    };
    await writeFile(
      join(dir, 'accounts.json'),
      JSON.stringify({ version: 1, accounts: [legacy], pending: [] }),
      'utf8',
    );

    const [read] = await store.listAccounts();
    expect(read?.plan).toBeNull();
    expect(read?.subscription).toBeNull();
    expect(read?.identityCheckedAt).toBeNull();
    expect(read?.usage?.windows[0]?.windowSeconds).toBeNull();

    // The next write leaves no trace of the organization's name behind.
    await store.putAccount(read ?? account());
    const raw = await readFile(join(dir, 'accounts.json'), 'utf8');
    expect(raw).not.toContain('Organization');
  });

  it('refuses a document that is not the shape it wrote', async () => {
    await writeFile(join(dir, 'accounts.json'), '{"version":2}', 'utf8');
    await expect(store.listAccounts()).rejects.toThrow(StoreError);
  });

  it('refuses a document that is not JSON at all', async () => {
    await writeFile(join(dir, 'accounts.json'), 'not json', 'utf8');
    await expect(store.listAccounts()).rejects.toThrow(StoreError);
  });
});

describe('toAccountView', () => {
  it('drops both credentials', () => {
    const view = toAccountView(account());
    expect(view).not.toHaveProperty('accessToken');
    expect(view).not.toHaveProperty('refreshToken');
    expect(view.label).toBe('you@example.com');
  });

  const reading = {
    windows: [],
    checkedAt: '2026-09-21T10:00:00.000Z',
  };

  it('calls a reading current when the latest try at it succeeded', () => {
    const view = toAccountView(
      account({ usage: reading, usageAttemptedAt: reading.checkedAt }),
    );
    expect(view.usage?.stale).toBe(false);
  });

  it('calls a reading stale when a later try at it failed', () => {
    const view = toAccountView(
      account({
        status: 'error',
        usage: reading,
        usageAttemptedAt: '2026-09-21T13:00:00.000Z',
      }),
    );
    expect(view.usage).toMatchObject({
      checkedAt: '2026-09-21T10:00:00.000Z',
      stale: true,
    });
  });

  it('calls an expired account’s reading stale, since nothing reads it', () => {
    const view = toAccountView(account({ status: 'expired', usage: reading }));
    expect(view.usage?.stale).toBe(true);
  });
});

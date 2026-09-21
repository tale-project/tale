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
    accessToken: 'v1.sealed.access',
    refreshToken: 'v1.sealed.refresh',
    expiresAt: '2026-09-22T10:00:00.000Z',
    scopes: 'user:inference',
    status: 'active',
    createdAt: '2026-09-21T10:00:00.000Z',
    lastRefreshedAt: null,
    usage: null,
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

    await store.addPending({
      state: 'state-1',
      provider: 'openai',
      codeVerifier: 'verifier',
      redirectUri: 'http://localhost:1455/auth/callback',
      targetAccountId: null,
      createdAt: '2026-09-21T10:00:00.000Z',
    });
    expect(await store.takePending('state-1')).not.toBeNull();
    expect(await store.takePending('state-1')).toBeNull();

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

  it('hands a pending authorization out exactly once', async () => {
    await store.addPending({
      state: 'state-1',
      provider: 'openai',
      codeVerifier: 'verifier',
      redirectUri: 'http://localhost:1455/auth/callback',
      targetAccountId: null,
      createdAt: '2026-09-21T10:00:00.000Z',
    });
    expect(await store.takePending('state-1')).not.toBeNull();
    expect(await store.takePending('state-1')).toBeNull();
  });

  it('prunes only the authorizations that aged out', async () => {
    const now = new Date('2026-09-21T11:00:00.000Z');
    for (const [state, createdAt] of [
      ['stale', '2026-09-21T10:00:00.000Z'],
      ['fresh', '2026-09-21T10:55:00.000Z'],
    ] as const) {
      await store.addPending({
        state,
        provider: 'anthropic',
        codeVerifier: 'verifier',
        redirectUri: 'https://console.anthropic.com/oauth/code/callback',
        targetAccountId: null,
        createdAt,
      });
    }
    expect(await store.prunePending(30 * 60 * 1000, now)).toBe(1);
    expect(await store.takePending('stale')).toBeNull();
    expect(await store.takePending('fresh')).not.toBeNull();
  });

  it('keeps the file readable and owner-only', async () => {
    await store.putAccount(account());
    const raw = await readFile(join(dir, 'accounts.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
    expect(raw.endsWith('\n')).toBe(true);
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
});

import { describe, expect, it } from 'vitest';

import { compareAccounts } from '@/app/lib/account-order';
import type { AccountView, ProviderId } from '@/app/lib/api';

const base: AccountView = {
  id: 'base',
  provider: 'anthropic',
  label: 'base',
  accountEmail: null,
  subscription: null,
  status: 'active',
  state: 'available',
  limitedUntil: null,
  expiresAt: null,
  scopes: null,
  createdAt: '2026-09-24T10:00:00.000Z',
  lastRefreshedAt: null,
  usage: null,
};

function account(
  name: string,
  overrides: Partial<AccountView> = {},
): AccountView {
  return { ...base, id: name, label: name, ...overrides };
}

const PROVIDERS: ProviderId[] = ['anthropic', 'openai'];

function order(accounts: AccountView[], providers = PROVIDERS, locale = 'en') {
  return accounts
    .toSorted(compareAccounts(providers, locale))
    .map((row) => row.id);
}

describe('compareAccounts', () => {
  it('keeps a vendor’s accounts together, vendors in the catalog’s order', () => {
    expect(
      order([
        account('gpt-1', { provider: 'openai' }),
        account('claude-1'),
        account('gpt-2', { provider: 'openai' }),
        account('claude-2'),
      ]),
    ).toEqual(['claude-1', 'claude-2', 'gpt-1', 'gpt-2']);
  });

  it('parks a vendor the catalog no longer offers after the ones it does', () => {
    expect(
      order(
        [account('claude-1'), account('gpt-1', { provider: 'openai' })],
        ['openai'],
      ),
    ).toEqual(['gpt-1', 'claude-1']);
  });

  it('groups by state inside a vendor, best first', () => {
    expect(
      order([
        account('broken', { status: 'error', state: 'error' }),
        account('lapsed', { status: 'expired', state: 'expired' }),
        account('spent', {
          state: 'limited',
          limitedUntil: '2026-09-25T10:00:00.000Z',
        }),
        account('ready'),
      ]),
    ).toEqual(['ready', 'spent', 'lapsed', 'broken']);
  });

  it('puts the state before the address — a state is a group, not a tiebreak', () => {
    expect(
      order([
        account('a-limited', {
          state: 'limited',
          limitedUntil: '2026-09-25T10:00:00.000Z',
        }),
        account('z-available'),
      ]),
    ).toEqual(['z-available', 'a-limited']);
  });

  it('lists the accounts that are back soonest first, and those with no known return last', () => {
    expect(
      order([
        account('in-3-days', {
          state: 'limited',
          limitedUntil: '2026-09-25T10:00:00.000Z',
        }),
        account('unknown', { state: 'limited', limitedUntil: null }),
        account('in-5-minutes', {
          state: 'limited',
          limitedUntil: '2026-09-22T10:05:00.000Z',
        }),
        account('in-a-day', {
          state: 'limited',
          limitedUntil: '2026-09-23T10:00:00.000Z',
        }),
      ]),
    ).toEqual(['in-5-minutes', 'in-a-day', 'in-3-days', 'unknown']);
  });

  it('orders what a state leaves tied by address rather than label', () => {
    expect(
      order([
        account('Zed', { accountEmail: 'alex@example.com' }),
        account('Alex', { accountEmail: 'zoe@example.com' }),
      ]),
    ).toEqual(['Zed', 'Alex']);
  });

  it('reads an umlaut where the reader’s own alphabet puts it', () => {
    const rows = [
      account('z', { accountEmail: 'zoe@example.com' }),
      account('a', { accountEmail: 'ärger@example.com' }),
      account('b', { accountEmail: 'bea@example.com' }),
    ];
    expect(order(rows, PROVIDERS, 'de')).toEqual(['a', 'b', 'z']);
  });
});

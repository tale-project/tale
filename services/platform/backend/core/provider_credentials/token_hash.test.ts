import { describe, expect, it } from 'vitest';

import { hashBrokerAccount, hashBrokerToken } from './token_hash';

describe('hashBrokerToken', () => {
  it('is deterministic 64-char sha256 hex', () => {
    const hash = hashBrokerToken('sk-pool-account-1');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBrokerToken('sk-pool-account-1')).toBe(hash);
    expect(hashBrokerToken('sk-pool-account-2')).not.toBe(hash);
  });
});

describe('hashBrokerAccount', () => {
  it('falls back to the legacy token hash when no stable id is supplied', () => {
    expect(hashBrokerAccount('cred-a', { token: 'synthetic-token' })).toBe(
      hashBrokerToken('synthetic-token'),
    );
  });

  it('keeps the same identity after refresh, scoped to the broker credential', () => {
    const account = { id: 'account-a', token: 'old-token' };
    const hash = hashBrokerAccount('cred-a', account);
    expect(
      hashBrokerAccount('cred-a', { ...account, token: 'new-token' }),
    ).toBe(hash);
    expect(hashBrokerAccount('cred-b', account)).not.toBe(hash);
    expect(
      hashBrokerAccount('cred-a', { ...account, id: 'account-b' }),
    ).not.toBe(hash);
    expect(hashBrokerAccount('a:b', { id: 'c', token: 't' })).not.toBe(
      hashBrokerAccount('a', { id: 'b:c', token: 't' }),
    );
  });
});

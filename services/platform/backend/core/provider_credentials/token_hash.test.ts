import { describe, expect, it } from 'vitest';

import { filterBrokerTokensByHash, hashBrokerToken } from './token_hash';

describe('hashBrokerToken', () => {
  it('is deterministic 64-char sha256 hex', () => {
    const hash = hashBrokerToken('sk-pool-account-1');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBrokerToken('sk-pool-account-1')).toBe(hash);
    expect(hashBrokerToken('sk-pool-account-2')).not.toBe(hash);
  });
});

describe('filterBrokerTokensByHash', () => {
  const POOL = ['tok-a', 'tok-b', 'tok-c'];

  it('passes the pool through untouched with no exclusions', () => {
    expect(filterBrokerTokensByHash(POOL, new Set())).toEqual({
      candidates: POOL,
      fellBack: false,
    });
  });

  it('drops exactly the tokens whose hash is excluded', () => {
    const excluded = new Set([hashBrokerToken('tok-b')]);
    expect(filterBrokerTokensByHash(POOL, excluded)).toEqual({
      candidates: ['tok-a', 'tok-c'],
      fellBack: false,
    });
  });

  it('falls back to the FULL pool when every token is excluded', () => {
    // A one-account deployment must retry on its only account rather than
    // starve on its own bookkeeping.
    const excluded = new Set(POOL.map((token) => hashBrokerToken(token)));
    expect(filterBrokerTokensByHash(POOL, excluded)).toEqual({
      candidates: POOL,
      fellBack: true,
    });
  });

  it('an unknown hash excludes nothing', () => {
    const excluded = new Set([hashBrokerToken('tok-not-in-pool')]);
    expect(filterBrokerTokensByHash(POOL, excluded)).toEqual({
      candidates: POOL,
      fellBack: false,
    });
  });
});

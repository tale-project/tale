// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  runIdempotencyRequestHash,
  runIdempotencyScopeKey,
} from './run_idempotency.ts';

const HEX_64 = /^[0-9a-f]{64}$/;

describe('runIdempotencyScopeKey', () => {
  it('is one caller’s key for one automation in one scope', async () => {
    const base = { projectId: undefined, name: 'billing/dunning', key: 'k-1' };
    const org = await runIdempotencyScopeKey(base);
    expect(org).toMatch(HEX_64);
    expect(await runIdempotencyScopeKey(base)).toBe(org);
    expect(
      await runIdempotencyScopeKey({ ...base, projectId: 'p-1' }),
    ).not.toBe(org);
    expect(
      await runIdempotencyScopeKey({ ...base, name: 'billing/reminders' }),
    ).not.toBe(org);
    expect(await runIdempotencyScopeKey({ ...base, key: 'k-2' })).not.toBe(org);
  });

  it('stays bounded however long the key', async () => {
    expect(
      await runIdempotencyScopeKey({
        projectId: undefined,
        name: 'a',
        key: 'x'.repeat(50_000),
      }),
    ).toMatch(HEX_64);
  });
});

describe('runIdempotencyRequestHash', () => {
  it('agrees for two spellings of the same request', async () => {
    const one = await runIdempotencyRequestHash({
      input: { b: 1, a: { d: [1, 2], c: 'x' } },
      mode: 'live',
      version: undefined,
    });
    const other = await runIdempotencyRequestHash({
      input: { a: { c: 'x', d: [1, 2] }, b: 1 },
      mode: 'live',
      version: undefined,
    });
    expect(one).toMatch(HEX_64);
    expect(other).toBe(one);
  });

  it('tells a changed input, mode or version apart', async () => {
    const base = { input: { n: 1 }, mode: 'live' as const, version: undefined };
    const hash = await runIdempotencyRequestHash(base);
    expect(
      await runIdempotencyRequestHash({ ...base, input: { n: 2 } }),
    ).not.toBe(hash);
    expect(await runIdempotencyRequestHash({ ...base, mode: 'mock' })).not.toBe(
      hash,
    );
    expect(await runIdempotencyRequestHash({ ...base, version: 1 })).not.toBe(
      hash,
    );
    // Array order is semantic and stays part of the request.
    expect(
      await runIdempotencyRequestHash({ ...base, input: { n: [1, 2] } }),
    ).not.toBe(
      await runIdempotencyRequestHash({ ...base, input: { n: [2, 1] } }),
    );
  });

  it('reads an absent input and an empty one as the same start', async () => {
    // The door defaults an absent input to `{}` before hashing; a null is
    // the caller's value and hashes as itself.
    const empty = await runIdempotencyRequestHash({
      input: {},
      mode: 'live',
      version: undefined,
    });
    expect(
      await runIdempotencyRequestHash({
        input: null,
        mode: 'live',
        version: undefined,
      }),
    ).not.toBe(empty);
  });
});

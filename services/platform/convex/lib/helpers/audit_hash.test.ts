import { describe, expect, it } from 'vitest';

import { canonicalizeForTest, computeAuditHash } from './audit_hash';

describe('canonicalize', () => {
  it('sorts object keys alphabetically', () => {
    const result = canonicalizeForTest({ b: 2, a: 1, c: 3 });
    expect(result).toBe('{"a":1,"b":2,"c":3}');
  });

  it('sorts nested object keys', () => {
    const result = canonicalizeForTest({ z: { b: 1, a: 2 }, a: 'x' });
    expect(result).toBe('{"a":"x","z":{"a":2,"b":1}}');
  });

  it('handles arrays without reordering', () => {
    const result = canonicalizeForTest({ items: [3, 1, 2] });
    expect(result).toBe('{"items":[3,1,2]}');
  });

  it('excludes integrityHash and previousHash fields', () => {
    const result = canonicalizeForTest({
      action: 'test',
      integrityHash: 'abc',
      previousHash: 'def',
    });
    expect(result).toBe('{"action":"test"}');
  });

  it('handles null and undefined', () => {
    expect(canonicalizeForTest(null)).toBe('null');
    expect(canonicalizeForTest(undefined)).toBe('undefined');
  });

  it('handles primitives', () => {
    expect(canonicalizeForTest('hello')).toBe('"hello"');
    expect(canonicalizeForTest(42)).toBe('42');
    expect(canonicalizeForTest(true)).toBe('true');
  });

  it('skips object keys whose value is undefined', () => {
    // Writer-shape: optional fields listed literally as `args.X` enter
    // as `undefined`. Verifier-shape: those keys are absent because
    // Convex drops undefined values before storage. Both must hash the
    // same.
    const writerShape = {
      action: 'login',
      actorId: 'u1',
      actorEmail: undefined,
      actorEmailHash: 'abc123',
      organizationId: 'org1',
      timestamp: 100,
    };
    const verifierShape = {
      action: 'login',
      actorId: 'u1',
      actorEmailHash: 'abc123',
      organizationId: 'org1',
      timestamp: 100,
    };
    expect(canonicalizeForTest(writerShape)).toBe(
      canonicalizeForTest(verifierShape),
    );
  });
});

describe('computeAuditHash', () => {
  it('produces a 64-character hex string', async () => {
    const hash = await computeAuditHash('', { action: 'test' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same hash for identical inputs', async () => {
    const record = { action: 'member.added', category: 'member' };
    const hash1 = await computeAuditHash('prev123', record);
    const hash2 = await computeAuditHash('prev123', record);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different previousHash values', async () => {
    const record = { action: 'member.added' };
    const hash1 = await computeAuditHash('aaa', record);
    const hash2 = await computeAuditHash('bbb', record);
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different records', async () => {
    const hash1 = await computeAuditHash('', { action: 'member.added' });
    const hash2 = await computeAuditHash('', { action: 'member.removed' });
    expect(hash1).not.toBe(hash2);
  });

  it('ignores integrityHash and previousHash in record', async () => {
    const record = { action: 'test', integrityHash: 'x', previousHash: 'y' };
    const clean = { action: 'test' };
    const hash1 = await computeAuditHash('prev', record);
    const hash2 = await computeAuditHash('prev', clean);
    expect(hash1).toBe(hash2);
  });

  it('is deterministic regardless of field order', async () => {
    const record1 = { category: 'auth', action: 'login' };
    const record2 = { action: 'login', category: 'auth' };
    const hash1 = await computeAuditHash('', record1);
    const hash2 = await computeAuditHash('', record2);
    expect(hash1).toBe(hash2);
  });

  it('produces the same hash for writer-shape (undefined fields) and verifier-shape (omitted)', async () => {
    // Regression: prior canonicalize emitted `"key":undefined` for
    // undefined-valued keys, so a writer that listed every optional field
    // (audit_logs/helpers.ts:165) signed a hash that the verifier — which
    // rebuilds canonical from the stored row where Convex has dropped
    // those keys — could never reproduce.
    const writer = {
      action: 'login',
      actorId: 'u1',
      actorEmail: undefined,
      actorEmailHash: 'abc123',
      ipAddress: undefined,
      actorIpHash: undefined,
      organizationId: 'org1',
      timestamp: 100,
    };
    const verifier = {
      action: 'login',
      actorId: 'u1',
      actorEmailHash: 'abc123',
      organizationId: 'org1',
      timestamp: 100,
    };
    const writerHash = await computeAuditHash('prev', writer);
    const verifierHash = await computeAuditHash('prev', verifier);
    expect(writerHash).toBe(verifierHash);
  });

  it('forms a verifiable chain', async () => {
    // Entry 1: no previous hash
    const entry1 = { action: 'first', timestamp: 1000 };
    const hash1 = await computeAuditHash('', entry1);

    // Entry 2: chains from entry 1
    const entry2 = { action: 'second', timestamp: 2000 };
    const hash2 = await computeAuditHash(hash1, entry2);

    // Entry 3: chains from entry 2
    const entry3 = { action: 'third', timestamp: 3000 };
    const hash3 = await computeAuditHash(hash2, entry3);

    // Verify chain: recomputing hash2 with hash1 gives same result
    const recomputed = await computeAuditHash(hash1, entry2);
    expect(recomputed).toBe(hash2);

    // Tampering: modifying entry2 breaks the chain from hash2 onward
    const tampered = { action: 'tampered', timestamp: 2000 };
    const tamperedHash = await computeAuditHash(hash1, tampered);
    expect(tamperedHash).not.toBe(hash2);

    // And the downstream hash3 no longer verifies
    const brokenHash3 = await computeAuditHash(tamperedHash, entry3);
    expect(brokenHash3).not.toBe(hash3);
  });
});

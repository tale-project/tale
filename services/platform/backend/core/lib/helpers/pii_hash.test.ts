import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expandIPv6,
  hashEmailForAudit,
  hashIpForAudit,
  splitEmailForAudit,
  splitIpForAudit,
} from './pii_hash';

const PEPPER = 'unit-test-pepper-very-long-secret';

describe('expandIPv6', () => {
  it('returns 8 groups for a fully-expanded address', () => {
    expect(expandIPv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual([
      '2001',
      '0db8',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0001',
    ]);
  });

  it('expands :: at the start', () => {
    expect(expandIPv6('::1')).toEqual(['0', '0', '0', '0', '0', '0', '0', '1']);
  });

  it('expands :: in the middle', () => {
    expect(expandIPv6('2001:db8::1')).toEqual([
      '2001',
      'db8',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
    ]);
  });

  it('expands :: at the end', () => {
    expect(expandIPv6('2001:db8::')).toEqual([
      '2001',
      'db8',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
    ]);
  });

  it('strips zone id', () => {
    expect(expandIPv6('fe80::1%eth0')).toEqual([
      'fe80',
      '0',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
    ]);
  });

  it('strips brackets', () => {
    expect(expandIPv6('[2001:db8::1]')).toEqual([
      '2001',
      'db8',
      '0',
      '0',
      '0',
      '0',
      '0',
      '1',
    ]);
  });

  it('rejects multiple :: shorthands', () => {
    expect(expandIPv6('1::2::3')).toBeNull();
  });

  it('rejects too few groups when no :: present', () => {
    expect(expandIPv6('2001:db8:1:2')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(expandIPv6('')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(expandIPv6('not-an-ip')).toBeNull();
    expect(expandIPv6('zzzz::1')).toBeNull();
  });
});

describe('hashEmailForAudit', () => {
  beforeEach(() => {
    delete process.env.TALE_AUDIT_PEPPER;
  });
  afterEach(() => {
    delete process.env.TALE_AUDIT_PEPPER;
  });

  it('returns plaintext when pepper is unset', async () => {
    const out = await hashEmailForAudit('User@Example.COM');
    expect(out).toBe('User@Example.COM');
  });

  it('returns plaintext when pepper is too short', async () => {
    process.env.TALE_AUDIT_PEPPER = 'short';
    const out = await hashEmailForAudit('a@b.com');
    expect(out).toBe('a@b.com');
  });

  it('returns sha256-prefixed hash when pepper is configured', async () => {
    process.env.TALE_AUDIT_PEPPER = PEPPER;
    const out = await hashEmailForAudit('a@b.com');
    expect(out).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('lowercases the email before hashing', async () => {
    process.env.TALE_AUDIT_PEPPER = PEPPER;
    const lower = await hashEmailForAudit('a@b.com');
    const mixed = await hashEmailForAudit('A@B.com');
    expect(lower).toBe(mixed);
  });
});

describe('splitEmailForAudit', () => {
  beforeEach(() => {
    delete process.env.TALE_AUDIT_PEPPER;
  });
  afterEach(() => {
    delete process.env.TALE_AUDIT_PEPPER;
  });

  it('returns plaintext only when pepper is unset', async () => {
    const out = await splitEmailForAudit('a@b.com');
    expect(out).toEqual({ plaintext: 'a@b.com' });
  });

  it('returns hash only when pepper is configured', async () => {
    process.env.TALE_AUDIT_PEPPER = PEPPER;
    const out = await splitEmailForAudit('a@b.com');
    expect(out.plaintext).toBeUndefined();
    expect(out.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('hashIpForAudit (IPv4)', () => {
  beforeEach(() => {
    process.env.TALE_AUDIT_PEPPER = PEPPER;
  });
  afterEach(() => {
    delete process.env.TALE_AUDIT_PEPPER;
  });

  it('coarsens to /24 and hashes', async () => {
    const a = await hashIpForAudit('203.0.113.5');
    const b = await hashIpForAudit('203.0.113.99');
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('treats v4-mapped v6 the same as the v4 form', async () => {
    const v4 = await hashIpForAudit('1.2.3.4');
    const mapped = await hashIpForAudit('::ffff:1.2.3.4');
    expect(v4).toBe(mapped);
  });
});

describe('hashIpForAudit (IPv6) — round-2 v04 H3 regression', () => {
  beforeEach(() => {
    process.env.TALE_AUDIT_PEPPER = PEPPER;
  });
  afterEach(() => {
    delete process.env.TALE_AUDIT_PEPPER;
  });

  it('::1 collapses to the canonical /64 prefix', async () => {
    // The compressed `::1` and its expanded form must hash to the same
    // /64 prefix (`0:0:0:0::/64`). The old split(':') path produced
    // `::1::/64` which differed from the expanded form.
    const compressed = await splitIpForAudit('::1');
    const expanded = await splitIpForAudit('0:0:0:0:0:0:0:1');
    expect(compressed.hash).toBe(expanded.hash);
  });

  it('2001:db8::1 maps to the same /64 as 2001:db8:0:0::', async () => {
    const compressed = await splitIpForAudit('2001:db8::1');
    const fullyExpanded = await splitIpForAudit('2001:db8:0:0:0:0:0:1');
    const sameSubnet = await splitIpForAudit('2001:db8::ffff');
    expect(compressed.hash).toBe(fullyExpanded.hash);
    expect(compressed.hash).toBe(sameSubnet.hash);
  });

  it('strips zone id and matches the unzoned form', async () => {
    const zoned = await splitIpForAudit('fe80::1%eth0');
    const unzoned = await splitIpForAudit('fe80::1');
    expect(zoned.hash).toBe(unzoned.hash);
  });

  it('different /64 subnets hash to different prefixes', async () => {
    const a = await splitIpForAudit('2001:db8:1::1');
    const b = await splitIpForAudit('2001:db8:2::1');
    expect(a.hash).not.toBe(b.hash);
  });
});

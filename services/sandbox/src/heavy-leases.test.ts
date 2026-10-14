import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_LEASE_MEMORY_BYTES,
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_PREDICTED_GROWTH_BYTES,
  HeavyLeases,
  parseHeavyLeaseRequest,
  type HeavyLeaseRequest,
} from './heavy-leases.ts';

const GIB = 1024 ** 3;

describe('parseHeavyLeaseRequest', () => {
  test('fills every default beside the organization and the class', () => {
    expect(
      parseHeavyLeaseRequest({ organizationId: 'org_a', class: 'heavy' }),
    ).toEqual({
      ok: true,
      value: {
        organizationId: 'org_a',
        label: null,
        predictedGrowthBytes: DEFAULT_PREDICTED_GROWTH_BYTES,
        memoryBytes: DEFAULT_LEASE_MEMORY_BYTES,
        ttlMs: DEFAULT_LEASE_TTL_MS,
      },
    });
    expect(DEFAULT_PREDICTED_GROWTH_BYTES).toBe(2 * GIB);
    expect(DEFAULT_LEASE_MEMORY_BYTES).toBe(GIB);
    expect(DEFAULT_LEASE_TTL_MS).toBe(1_800_000);
  });

  test('takes what the caller announces', () => {
    expect(
      parseHeavyLeaseRequest({
        organizationId: 'org_a',
        class: 'heavy',
        label: 'npm ci',
        predictedGrowthBytes: 0,
        memoryBytes: 3 * GIB,
        ttlMs: 60_000,
      }),
    ).toEqual({
      ok: true,
      value: {
        organizationId: 'org_a',
        label: 'npm ci',
        predictedGrowthBytes: 0,
        memoryBytes: 3 * GIB,
        ttlMs: 60_000,
      },
    });
    expect(
      parseHeavyLeaseRequest({
        organizationId: 'org_a',
        class: 'heavy',
        label: 'é'.repeat(120),
        ttlMs: 7_200_000,
      }).ok,
    ).toBe(true);
  });

  test.each([
    ['a body that is no object', ['org_a']],
    ['no organization', { class: 'heavy' }],
    ['a malformed organization', { organizationId: 'org/a', class: 'heavy' }],
    ['no class', { organizationId: 'org_a' }],
    ['another class', { organizationId: 'org_a', class: 'light' }],
    [
      'a label over 120 characters',
      { organizationId: 'org_a', class: 'heavy', label: 'x'.repeat(121) },
    ],
    [
      'a label that is no string',
      { organizationId: 'org_a', class: 'heavy', label: 7 },
    ],
    [
      'negative growth',
      { organizationId: 'org_a', class: 'heavy', predictedGrowthBytes: -1 },
    ],
    [
      'fractional memory',
      { organizationId: 'org_a', class: 'heavy', memoryBytes: 1.5 },
    ],
    [
      'memory as a string',
      { organizationId: 'org_a', class: 'heavy', memoryBytes: '1g' },
    ],
    [
      'a TTL under a minute',
      { organizationId: 'org_a', class: 'heavy', ttlMs: 59_999 },
    ],
    [
      'a TTL over two hours',
      { organizationId: 'org_a', class: 'heavy', ttlMs: 7_200_001 },
    ],
  ])('refuses %s', (_, body) => {
    expect(parseHeavyLeaseRequest(body).ok).toBe(false);
  });
});

describe('HeavyLeases', () => {
  const request = (
    overrides: Partial<HeavyLeaseRequest> = {},
  ): HeavyLeaseRequest => ({
    organizationId: 'org_a',
    label: null,
    predictedGrowthBytes: 2 * GIB,
    memoryBytes: GIB,
    ttlMs: 60_000,
    ...overrides,
  });

  test('grants a lease bound to its session, until its expiry', () => {
    let now = 1_000;
    const leases = new HeavyLeases(2, () => now);
    const lease = leases.grant('ses-1', request({ label: 'build' }));
    expect(lease).toEqual({
      id: expect.any(String),
      sessionId: 'ses-1',
      organizationId: 'org_a',
      class: 'heavy',
      label: 'build',
      predictedGrowthBytes: 2 * GIB,
      memoryBytes: GIB,
      acquiredAtMs: 1_000,
      expiresAtMs: 61_000,
    });
    expect(leases.summary()).toEqual({ active: 1, max: 2 });
    now = 61_000;
    expect(leases.active()).toEqual([]);
    expect(leases.summary()).toEqual({ active: 0, max: 2 });
  });

  test('sums what the active leases announced', () => {
    let now = 0;
    const leases = new HeavyLeases(4, () => now);
    leases.grant(
      'ses-1',
      request({ predictedGrowthBytes: GIB, ttlMs: 120_000 }),
    );
    leases.grant('ses-2', request({ memoryBytes: 3 * GIB }));
    expect(leases.outstanding()).toEqual({
      count: 2,
      growthBytes: 3 * GIB,
      memoryBytes: 4 * GIB,
    });
    now = 60_000;
    expect(leases.outstanding()).toEqual({
      count: 1,
      growthBytes: GIB,
      memoryBytes: GIB,
    });
  });

  test('releases a lease of its session and organization only', () => {
    const leases = new HeavyLeases(2);
    const lease = leases.grant('ses-1', request());
    expect(leases.release('ses-2', lease.id, 'org_a')).toBe(false);
    expect(leases.release('ses-1', lease.id, 'org_b')).toBe(false);
    expect(leases.release('ses-1', 'no-such-lease', 'org_a')).toBe(false);
    expect(leases.release('ses-1', lease.id, 'org_a')).toBe(true);
    expect(leases.release('ses-1', lease.id, 'org_a')).toBe(false);
  });

  test('an expired lease cannot be released any more', () => {
    let now = 0;
    const leases = new HeavyLeases(2, () => now);
    const lease = leases.grant('ses-1', request());
    now = 60_000;
    expect(leases.release('ses-1', lease.id, 'org_a')).toBe(false);
  });

  test('a session that is gone takes every lease of its own with it', () => {
    const leases = new HeavyLeases(4);
    leases.grant('ses-1', request());
    leases.grant('ses-1', request());
    const other = leases.grant('ses-2', request());
    expect(leases.releaseSession('ses-1')).toBe(2);
    expect(leases.active()).toEqual([other]);
    expect(leases.releaseSession('ses-1')).toBe(0);
  });

  test("lists an organization's leases, of one session when named", () => {
    const leases = new HeavyLeases(4);
    const one = leases.grant('ses-1', request());
    const two = leases.grant('ses-2', request());
    leases.grant('ses-3', request({ organizationId: 'org_b' }));
    expect(leases.list('org_a')).toEqual([one, two]);
    expect(leases.list('org_a', 'ses-2')).toEqual([two]);
    expect(leases.list('org_a', 'ses-3')).toEqual([]);
  });

  test('the sweep drops what expired', () => {
    let now = 0;
    const leases = new HeavyLeases(4, () => now);
    leases.grant('ses-1', request({ ttlMs: 60_000 }));
    leases.grant('ses-2', request({ ttlMs: 120_000 }));
    now = 90_000;
    expect(leases.sweep()).toBe(1);
    expect(leases.sweep()).toBe(0);
    expect(leases.active().map((lease) => lease.sessionId)).toEqual(['ses-2']);
  });
});

import { describe, expect, test } from 'bun:test';

import {
  MEMBER_ROLE_SHARES,
  megaOrganizationIndex,
  memberRoleFor,
  sessionTokenFor,
  userId,
} from '../../src/plan.ts';
import {
  activeOrganizationIndex,
  batches,
  buildAccountRows,
  buildMemberRows,
  buildSessionRows,
  buildUserRows,
  expectedMembershipCount,
  membershipsFor,
  organizationIndexes,
  ownerIndexFor,
  populationFor,
  SESSION_TTL_MS,
} from '../../src/seed/population.ts';

function population(users: number, orgSize: number, megaOrgSize: number) {
  return populationFor({
    runId: 'abcd1234',
    emailDomain: 'load.tale.invalid',
    password: 'Aa1!aaaaaaaaaaaa',
    sessionsMinted: true,
    users,
    orgSize,
    megaOrgSize,
  });
}

describe('role weighting', () => {
  test('roles over 10k block members land within tolerance of the shares', () => {
    const plan = population(10_000, 10_000, 0);
    const counts = { owner: 0, admin: 0, developer: 0, editor: 0, member: 0 };
    for (let index = 0; index < 10_000; index += 1) {
      const role = memberRoleFor(plan, 0, index);
      if (role === null) throw new Error(`user ${index} has no role`);
      counts[role] += 1;
    }
    expect(counts.owner).toBe(1);
    const members = 9_999;
    const tolerance = 0.006;
    expect(
      Math.abs(counts.admin / members - MEMBER_ROLE_SHARES.admin),
    ).toBeLessThan(tolerance);
    expect(
      Math.abs(counts.developer / members - MEMBER_ROLE_SHARES.developer),
    ).toBeLessThan(tolerance);
    expect(
      Math.abs(counts.editor / members - MEMBER_ROLE_SHARES.editor),
    ).toBeLessThan(tolerance * 2);
    const rest =
      1 -
      MEMBER_ROLE_SHARES.admin -
      MEMBER_ROLE_SHARES.developer -
      MEMBER_ROLE_SHARES.editor;
    expect(Math.abs(counts.member / members - rest)).toBeLessThan(
      tolerance * 2,
    );
  });

  test('every block has its first user as owner and no other owner', () => {
    const plan = population(300, 50, 100);
    for (let index = 0; index < 300; index += 1) {
      const block = Math.floor(index / 50);
      const role = memberRoleFor(plan, block, index);
      expect(role === 'owner').toBe(index % 50 === 0);
      // Not a member of a neighbouring block.
      expect(memberRoleFor(plan, (block + 1) % 6, index)).toBeNull();
    }
  });

  test('the mega organization is owned by user 0 and holds the first megaOrgSize users', () => {
    const plan = population(300, 50, 100);
    const mega = megaOrganizationIndex(plan);
    expect(mega).toBe(6);
    if (mega === null) return;
    expect(memberRoleFor(plan, mega, 0)).toBe('owner');
    expect(memberRoleFor(plan, mega, 99)).not.toBeNull();
    expect(memberRoleFor(plan, mega, 99)).not.toBe('owner');
    expect(memberRoleFor(plan, mega, 100)).toBeNull();
  });

  test('a plan without a mega organization reports none', () => {
    expect(megaOrganizationIndex(population(300, 50, 0))).toBeNull();
  });
});

describe('membership layout', () => {
  test('memberships match the expected count and leave owners out', () => {
    const plan = population(300, 50, 100);
    const all = membershipsFor(plan, 0, 300);
    expect(all).toHaveLength(expectedMembershipCount(plan));
    // 300 users - 6 block owners + 99 mega members (user 0 owns it).
    expect(all).toHaveLength(294 + 99);
    expect(all.filter((m) => m.orgIndex === 6)).toHaveLength(99);
    expect(all.some((m) => m.index % 50 === 0 && m.orgIndex < 6)).toBe(false);
  });

  test('a partial last block is still an organization with an owner', () => {
    const plan = population(310, 50, 0);
    expect(plan.organizations.count).toBe(7);
    expect(ownerIndexFor(plan, 6)).toBe(300);
    expect(memberRoleFor(plan, 6, 300)).toBe('owner');
    expect(membershipsFor(plan, 0, 310)).toHaveLength(310 - 7);
    expect(organizationIndexes(plan)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  test('the mega organization is the last index and owned by user 0', () => {
    const plan = population(300, 50, 100);
    expect(organizationIndexes(plan)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ownerIndexFor(plan, 6)).toBe(0);
    expect(ownerIndexFor(plan, 2)).toBe(100);
  });

  test('member rows carry deterministic ids and skip missing organizations', () => {
    const plan = population(300, 50, 100);
    const orgIds = new Map([
      [0, 'org-0'],
      [1, 'org-1'],
      [6, 'org-mega'],
    ]);
    const now = new Date('2026-10-08T00:00:00Z');
    const { rows, skipped } = buildMemberRows(plan, 0, 300, orgIds, now);
    // Blocks 2..5 are missing: 4 × 49 non-owner members skipped.
    expect(skipped).toBe(4 * 49);
    expect(rows).toHaveLength(2 * 49 + 99);
    const first = rows.find(
      (row) =>
        row.userId === userId('abcd1234', 1) && row.organizationId === 'org-0',
    );
    expect(first?.id).toBe('load_abcd1234_m0_1');
    const mega = rows.find(
      (row) =>
        row.userId === userId('abcd1234', 1) &&
        row.organizationId === 'org-mega',
    );
    expect(mega?.id).toBe('load_abcd1234_m6_1');
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  test('active organization is the block, else the mega organization', () => {
    const plan = population(300, 50, 100);
    expect(activeOrganizationIndex(plan, 0)).toBe(0);
    expect(activeOrganizationIndex(plan, 149)).toBe(2);
    expect(activeOrganizationIndex(plan, 299)).toBe(5);
  });
});

describe('identity rows', () => {
  const plan = population(300, 50, 100);
  const now = new Date('2026-10-08T00:00:00Z');

  test('user rows are verified accounts with stable ids and e-mails', () => {
    const rows = buildUserRows(plan, 10, 13, now);
    expect(rows.map((row) => row.id)).toEqual([
      'load_abcd1234_u10',
      'load_abcd1234_u11',
      'load_abcd1234_u12',
    ]);
    expect(rows[0]?.email).toBe('load-abcd1234-u10@load.tale.invalid');
    expect(
      rows.every((row) => row.emailVerified && !row.twoFactorEnabled),
    ).toBe(true);
    expect(buildUserRows(plan, 10, 13, now)).toEqual(rows);
  });

  test('account rows match the platform credential shape and share one hash', () => {
    const rows = buildAccountRows(plan, 0, 3, 'salt:hash', now);
    expect(rows[1]).toEqual({
      id: 'load_abcd1234_a1',
      accountId: 'load_abcd1234_u1',
      providerId: 'credential',
      userId: 'load_abcd1234_u1',
      password: 'salt:hash',
      createdAt: now,
      updatedAt: now,
    });
  });

  test('session rows carry derived tokens, 30-day expiry and synthetic IPs', () => {
    const rows = buildSessionRows(plan, 255, 258, 'secret', now);
    expect(rows[0]?.id).toBe('load_abcd1234_s255');
    expect(rows[0]?.token).toBe(sessionTokenFor('secret', 'abcd1234', 255));
    expect(rows[0]?.expiresAt.getTime()).toBe(now.getTime() + SESSION_TTL_MS);
    expect(rows[0]?.ipAddress).toBe('10.0.0.255');
    expect(rows[1]?.ipAddress).toBe('10.0.1.0');
    expect(rows[0]?.userAgent).toBe('tale-load');
    expect(new Set(rows.map((row) => row.token)).size).toBe(3);
  });

  test('batches cover the range exactly', () => {
    expect(batches(5, 2)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 5 },
    ]);
    expect(batches(0, 2)).toEqual([]);
  });
});

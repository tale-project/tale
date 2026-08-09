// @vitest-environment node

/**
 * Competence records against a real Convex world: admin-only grant/revoke
 * with the legal-hold audit stance (a `security` row per write, a `denied`
 * row per refused attempt), revoke-as-stamp (never a hard delete), and the
 * `holdsAllCompetences` membership check that the review gate consumes —
 * unexpired + unrevoked only.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';
import { holdsAllCompetences } from './competence';

const TEST_DIR_FROM_CONVEX_ROOT = 'governance';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_competence';
const OTHER_ORG = 'org_competence_other';
const ADMIN = 'u_comp_admin';
const MEMBER = 'u_comp_member';
const HOLDER = 'u_comp_holder';

type T = TestConvex<typeof schema>;

async function seedMembers(t: T): Promise<void> {
  await t.run(async (ctx) => {
    const roles: Array<[string, string]> = [
      [ADMIN, 'owner'],
      [MEMBER, 'member'],
      [HOLDER, 'member'],
    ];
    for (const [userId, role] of roles) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}_${ORG}`,
        userId,
        organizationId: ORG,
        role,
        createdAt: 0,
      });
    }
  });
}

const asAdmin = (t: T) =>
  t.withIdentity({ subject: ADMIN, email: 'admin@example.com' });
const asMember = (t: T) =>
  t.withIdentity({ subject: MEMBER, email: 'member@example.com' });

async function auditRows(t: T): Promise<Doc<'auditLogs'>[]> {
  return t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_organizationId_and_category', (q) =>
        q.eq('organizationId', ORG).eq('category', 'security'),
      )
      .collect(),
  );
}

describe('grantCompetence', () => {
  it('an admin grant writes the record and a security audit row with full metadata', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);

    const recordId = await asAdmin(t).mutation(
      api.governance.competence.grantCompetence,
      {
        organizationId: ORG,
        userId: HOLDER,
        competence: 'vat-review',
        evidence: 'https://example.com/cert/vat-review',
      },
    );

    const record = await t.run((ctx) => ctx.db.get(recordId));
    expect(record).toMatchObject({
      organizationId: ORG,
      userId: HOLDER,
      competence: 'vat-review',
      grantedBy: ADMIN,
      evidence: 'https://example.com/cert/vat-review',
    });
    expect(record?.revokedAt).toBeUndefined();

    const audits = await auditRows(t);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'competence_granted',
      category: 'security',
      actorId: ADMIN,
      resourceType: 'competence_record',
      resourceId: String(recordId),
      resourceName: 'vat-review',
      status: 'success',
    });
    expect(audits[0]?.newState).toMatchObject({
      userId: HOLDER,
      competence: 'vat-review',
      grantedBy: ADMIN,
    });
    expect(audits[0]?.metadata).toMatchObject({
      userId: HOLDER,
      competence: 'vat-review',
    });
  });

  it('a non-admin grant and revoke are refused and write nothing', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);

    await expect(
      asMember(t).mutation(api.governance.competence.grantCompetence, {
        organizationId: ORG,
        userId: HOLDER,
        competence: 'vat-review',
      }),
    ).rejects.toThrow(/forbidden/);

    const recordId = await asAdmin(t).mutation(
      api.governance.competence.grantCompetence,
      { organizationId: ORG, userId: HOLDER, competence: 'vat-review' },
    );
    await expect(
      asMember(t).mutation(api.governance.competence.revokeCompetence, {
        organizationId: ORG,
        recordId,
      }),
    ).rejects.toThrow(/forbidden/);

    const records = await t.run((ctx) =>
      ctx.db.query('competenceRecords').collect(),
    );
    // Only the admin's grant landed; the refused writes left nothing behind
    // (a thrown mutation rolls its transaction back — the `denied` audit
    // row, like legal_hold's, aborts with it).
    expect(records).toHaveLength(1);
    expect(records[0]?.revokedAt).toBeUndefined();
  });

  it('refuses granting to a user who is not an org member', async () => {
    // A dangling grant to an arbitrary string is fail-safe but pollutes the
    // qualification ledger — the holder must resolve as an org member.
    const t = convexTest(schema, modules);
    await seedMembers(t);

    await expect(
      asAdmin(t).mutation(api.governance.competence.grantCompetence, {
        organizationId: ORG,
        userId: 'u_ghost_nonmember',
        competence: 'vat-review',
      }),
    ).rejects.toThrow(/COMPETENCE_USER_NOT_MEMBER/);

    const records = await t.run((ctx) =>
      ctx.db.query('competenceRecords').collect(),
    );
    expect(records).toHaveLength(0);
  });

  it('refuses a duplicate ACTIVE grant, a past expiry, and an empty slug', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const admin = asAdmin(t);

    await admin.mutation(api.governance.competence.grantCompetence, {
      organizationId: ORG,
      userId: HOLDER,
      competence: 'vat-review',
    });
    await expect(
      admin.mutation(api.governance.competence.grantCompetence, {
        organizationId: ORG,
        userId: HOLDER,
        competence: 'vat-review',
      }),
    ).rejects.toThrow(/COMPETENCE_ALREADY_GRANTED/);

    await expect(
      admin.mutation(api.governance.competence.grantCompetence, {
        organizationId: ORG,
        userId: HOLDER,
        competence: 'iso-audit',
        expiresAt: Date.now() - 1,
      }),
    ).rejects.toThrow(/COMPETENCE_EXPIRY_IN_PAST/);

    await expect(
      admin.mutation(api.governance.competence.grantCompetence, {
        organizationId: ORG,
        userId: HOLDER,
        competence: '   ',
      }),
    ).rejects.toThrow(/COMPETENCE_INVALID/);
  });
});

describe('revokeCompetence', () => {
  it('revoke stamps the record (never deletes) and writes its audit row; re-grant then works', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const admin = asAdmin(t);
    const recordId = await admin.mutation(
      api.governance.competence.grantCompetence,
      { organizationId: ORG, userId: HOLDER, competence: 'vat-review' },
    );

    await admin.mutation(api.governance.competence.revokeCompetence, {
      organizationId: ORG,
      recordId,
    });

    const record = await t.run((ctx) => ctx.db.get(recordId));
    expect(record).not.toBeNull();
    expect(record?.revokedAt).toBeTypeOf('number');
    expect(record?.revokedBy).toBe(ADMIN);

    const audits = await auditRows(t);
    expect(audits.map((row) => row.action)).toEqual([
      'competence_granted',
      'competence_revoked',
    ]);
    expect(audits[1]?.previousState).toMatchObject({ revokedAt: null });
    expect(audits[1]?.newState).toMatchObject({ revokedBy: ADMIN });

    // The revoked grant no longer blocks a fresh one (the renewal path).
    await admin.mutation(api.governance.competence.grantCompetence, {
      organizationId: ORG,
      userId: HOLDER,
      competence: 'vat-review',
    });

    // Double-revoke is refused; cross-org access is invisible.
    await expect(
      admin.mutation(api.governance.competence.revokeCompetence, {
        organizationId: ORG,
        recordId,
      }),
    ).rejects.toThrow(/COMPETENCE_ALREADY_REVOKED/);
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${ADMIN}_${OTHER_ORG}`,
        userId: ADMIN,
        organizationId: OTHER_ORG,
        role: 'owner',
        createdAt: 0,
      });
    });
    await expect(
      asAdmin(t).mutation(api.governance.competence.revokeCompetence, {
        organizationId: OTHER_ORG,
        recordId,
      }),
    ).rejects.toThrow(/COMPETENCE_NOT_FOUND/);
  });
});

describe('holdsAllCompetences', () => {
  async function insertRecord(
    t: T,
    overrides: Partial<Doc<'competenceRecords'>> = {},
  ): Promise<Id<'competenceRecords'>> {
    return t.run((ctx) =>
      ctx.db.insert('competenceRecords', {
        organizationId: ORG,
        userId: HOLDER,
        competence: 'vat-review',
        grantedBy: ADMIN,
        grantedAt: 0,
        ...overrides,
      }),
    );
  }

  it('holds when every required slug has an unexpired, unrevoked record — and reports the vouching ids', async () => {
    const t = convexTest(schema, modules);
    const vat = await insertRecord(t);
    const iso = await insertRecord(t, { competence: 'iso-audit' });

    const held = await t.run((ctx) =>
      holdsAllCompetences(ctx, ORG, HOLDER, ['vat-review', 'iso-audit']),
    );
    expect(held.holdsAll).toBe(true);
    expect(held.missing).toEqual([]);
    expect([...held.heldRecordIds].sort()).toEqual(
      [String(vat), String(iso)].sort(),
    );
  });

  it('an expired, revoked, or absent record reads as missing; empty required trivially holds', async () => {
    const t = convexTest(schema, modules);
    await insertRecord(t, { expiresAt: Date.now() - 1 });
    await insertRecord(t, {
      competence: 'iso-audit',
      revokedAt: 1,
      revokedBy: ADMIN,
    });

    const held = await t.run((ctx) =>
      holdsAllCompetences(ctx, ORG, HOLDER, [
        'vat-review',
        'iso-audit',
        'never-granted',
      ]),
    );
    expect(held.holdsAll).toBe(false);
    expect([...held.missing].sort()).toEqual([
      'iso-audit',
      'never-granted',
      'vat-review',
    ]);

    const empty = await t.run((ctx) =>
      holdsAllCompetences(ctx, ORG, HOLDER, []),
    );
    expect(empty).toEqual({ holdsAll: true, heldRecordIds: [], missing: [] });
  });

  it('a record in another org never vouches', async () => {
    const t = convexTest(schema, modules);
    await insertRecord(t, { organizationId: OTHER_ORG });
    const held = await t.run((ctx) =>
      holdsAllCompetences(ctx, ORG, HOLDER, ['vat-review']),
    );
    expect(held.holdsAll).toBe(false);
  });
});

describe('competence list queries', () => {
  it('admin lists the org; a member reads their own but not another member', async () => {
    const t = convexTest(schema, modules);
    await seedMembers(t);
    const admin = asAdmin(t);
    await admin.mutation(api.governance.competence.grantCompetence, {
      organizationId: ORG,
      userId: HOLDER,
      competence: 'vat-review',
    });
    await admin.mutation(api.governance.competence.grantCompetence, {
      organizationId: ORG,
      userId: MEMBER,
      competence: 'iso-audit',
    });

    const all = await admin.query(
      api.governance.competence.listOrgCompetences,
      { organizationId: ORG },
    );
    expect(all).toHaveLength(2);

    await expect(
      asMember(t).query(api.governance.competence.listOrgCompetences, {
        organizationId: ORG,
      }),
    ).rejects.toThrow(/forbidden/);

    const own = await asMember(t).query(
      api.governance.competence.listUserCompetences,
      { organizationId: ORG, userId: MEMBER },
    );
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ competence: 'iso-audit' });

    await expect(
      asMember(t).query(api.governance.competence.listUserCompetences, {
        organizationId: ORG,
        userId: HOLDER,
      }),
    ).rejects.toThrow(/forbidden/);
  });
});

import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { migration } from './index';

const DIR = 'migrations/versions/v0_2_48/02_merge_audit_retention';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

// policyType as open string so the legacy 'audit_retention' literal (dropped
// from the union at v0.2.48) still validates in the fixture.
const fixtureSchema = defineSchema({
  governancePolicies: defineTable({
    organizationId: v.string(),
    policyType: v.string(),
    config: v.any(),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index('by_org_policyType', ['organizationId', 'policyType']),
});

async function applyUp(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    for (const d of await ctx.db.query('governancePolicies').collect()) {
      await migration.up(ctx as never, d as never);
    }
  });
}

async function applyDown(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    for (const d of await ctx.db.query('governancePolicies').collect()) {
      await migration.down(ctx as never, d as never);
    }
  });
}

describe('0.2.48/02 merge_audit_retention (reference)', () => {
  it('folds audit_retention into a pre-existing retention_policy and back (round-trip + idempotent)', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert('governancePolicies', {
        organizationId: 'org_1',
        policyType: 'audit_retention',
        config: { retentionDays: 365 },
        enabled: true,
        updatedAt: 1,
      });
      await ctx.db.insert('governancePolicies', {
        organizationId: 'org_1',
        policyType: 'retention_policy',
        config: { enabled: true, retentionDays: 30 },
        enabled: true,
        updatedAt: 1,
      });
    });

    // up: audit_retention folded in + deleted.
    await applyUp(t);
    let rows = await t.run((ctx) =>
      ctx.db.query('governancePolicies').collect(),
    );
    expect(rows.map((r) => r.policyType)).toEqual(['retention_policy']);
    expect(rows[0].config).toMatchObject({
      enabled: true,
      retentionDays: 30,
      auditLogsEnabled: true,
      auditLogRetentionDays: 365,
    });

    // up again is a no-op (no audit_retention row remains).
    await applyUp(t);
    rows = await t.run((ctx) => ctx.db.query('governancePolicies').collect());
    expect(rows).toHaveLength(1);

    // down: audit_retention re-created, retention_policy stripped back.
    await applyDown(t);
    rows = await t.run((ctx) => ctx.db.query('governancePolicies').collect());
    const audit = rows.find((r) => r.policyType === 'audit_retention');
    const retention = rows.find((r) => r.policyType === 'retention_policy');
    expect(audit?.config).toEqual({ retentionDays: 365 });
    expect(retention?.config).toEqual({ enabled: true, retentionDays: 30 });

    // down again is a no-op (the auditLog* marker is gone).
    await applyDown(t);
    rows = await t.run((ctx) => ctx.db.query('governancePolicies').collect());
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.policyType === 'audit_retention')).toHaveLength(
      1,
    );
  });

  it('up creates a minimal retention_policy when the org has none', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('governancePolicies', {
        organizationId: 'org_2',
        policyType: 'audit_retention',
        config: { retentionDays: 180 },
        enabled: true,
        updatedAt: 1,
      }),
    );

    await applyUp(t);
    const rows = await t.run((ctx) =>
      ctx.db.query('governancePolicies').collect(),
    );
    expect(rows.map((r) => r.policyType)).toEqual(['retention_policy']);
    expect(rows[0].config).toMatchObject({
      enabled: false,
      retentionDays: 90,
      auditLogsEnabled: true,
      auditLogRetentionDays: 180,
    });
  });
});

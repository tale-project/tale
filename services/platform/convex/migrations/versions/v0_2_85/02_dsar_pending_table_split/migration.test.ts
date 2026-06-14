import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import {
  buildModules,
  historicalSchema,
} from '../../../framework/test_helpers';
import { meta } from './meta';

const DIR = 'migrations/versions/v0_2_85/02_dsar_pending_table_split';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const ORG = 'org_test_1';

async function seedLegacyRow(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert('governancePolicies', {
      organizationId: ORG,
      policyType: 'dsar_governance',
      config: { coolingOffHours: 48 },
      pendingConfig: { coolingOffHours: 12 },
      pendingEffectiveAt: 1_000,
      pendingProposedBy: 'admin_1',
      pendingProposedByEmail: 'admin@example.com',
      pendingProposedAt: 500,
    });
  });
}

describe('0.2.85/02 dsar_pending_table_split', () => {
  it('up moves pending* fields into dsarPolicyPendingChanges; down folds back', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedLegacyRow(t);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });

    const pending = await t.run((ctx) =>
      ctx.db.query('dsarPolicyPendingChanges').collect(),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      organizationId: ORG,
      effectiveAt: 1_000,
      proposedBy: 'admin_1',
      proposedByEmail: 'admin@example.com',
      proposedAt: 500,
    });
    expect(pending[0].pendingConfig).toEqual({ coolingOffHours: 12 });

    // Idempotent: a second up is a planner-level no-op (already applied).
    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    expect(
      await t.run((ctx) => ctx.db.query('dsarPolicyPendingChanges').collect()),
    ).toHaveLength(1);

    // Down folds the pending row back onto the legacy row and deletes it.
    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.84',
      only: [meta.id],
    });

    expect(
      await t.run((ctx) => ctx.db.query('dsarPolicyPendingChanges').collect()),
    ).toHaveLength(0);

    const legacy = (await t.run((ctx) =>
      // oxlint-disable-next-line typescript/no-explicit-any -- legacy table
      (ctx.db.query('governancePolicies' as any) as any).collect(),
    )) as Array<Record<string, unknown>>;
    expect(legacy[0]).toMatchObject({
      pendingEffectiveAt: 1_000,
      pendingProposedBy: 'admin_1',
      pendingProposedAt: 500,
    });
    expect(legacy[0].pendingConfig).toEqual({ coolingOffHours: 12 });
  });

  it('records the migration in the ledger as applied then rolledBack', async () => {
    const t = convexTest(historicalSchema, modules);
    await seedLegacyRow(t);

    await t.action(internal.migrations.framework.entrypoints.applyUp, {
      only: [meta.id],
    });
    let row = await t.run((ctx) =>
      ctx.db
        .query('migrationLedger')
        .withIndex('by_migrationId', (q) => q.eq('migrationId', meta.id))
        .unique(),
    );
    expect(row?.status).toBe('applied');

    await t.action(internal.migrations.framework.entrypoints.applyDown, {
      to: '0.2.84',
      only: [meta.id],
    });
    row = await t.run((ctx) =>
      ctx.db
        .query('migrationLedger')
        .withIndex('by_migrationId', (q) => q.eq('migrationId', meta.id))
        .unique(),
    );
    expect(row?.status).toBe('rolledBack');
  });
});

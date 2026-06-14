import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import {
  buildModules,
  legacyGovernancePoliciesTable,
} from '../../../framework/test_helpers';
import { migration } from './index';

const DIR =
  'migrations/versions/v0_2_73/03_governance_personalization_policy_split';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const fixtureSchema = defineSchema({
  governancePolicies: legacyGovernancePoliciesTable,
});

const ORG = 'org_1';

describe('0.2.73/03 governance_personalization_policy_split (reference)', () => {
  it('up forks personalization into two policies; down re-merges; idempotent', async () => {
    const t = convexTest(fixtureSchema, modules);

    await t.run((ctx) =>
      ctx.db.insert('governancePolicies', {
        organizationId: ORG,
        policyType: 'personalization',
        config: { enabled: true, mode: 'opt-in' },
        updatedBy: 'admin_1',
        updatedAt: 100,
        effectiveAt: 200,
      }),
    );

    const runUp = () =>
      t.run(async (ctx) => {
        for (const d of await ctx.db.query('governancePolicies').collect()) {
          await migration.up(ctx as never, d as never);
        }
      });
    const runDown = () =>
      t.run(async (ctx) => {
        for (const d of await ctx.db.query('governancePolicies').collect()) {
          await migration.down(ctx as never, d as never);
        }
      });
    const types = async () =>
      (await t.run((ctx) => ctx.db.query('governancePolicies').collect()))
        .map((r) => r.policyType)
        .sort();

    // up: personalization → {custom_instructions, user_memories}
    await runUp();
    expect(await types()).toEqual(['custom_instructions', 'user_memories']);
    const forked = await t.run((ctx) =>
      ctx.db.query('governancePolicies').collect(),
    );
    for (const r of forked) {
      expect(r.config).toEqual({ enabled: true, mode: 'opt-in' });
      expect(r.updatedBy).toBe('admin_1');
      expect(r.effectiveAt).toBe(200);
    }

    // up again is a no-op (forked rows already exist; no personalization rows)
    await runUp();
    expect(await types()).toEqual(['custom_instructions', 'user_memories']);

    // down: re-merge back into a single personalization row
    await runDown();
    expect(await types()).toEqual(['personalization']);
    const merged = await t.run((ctx) =>
      ctx.db.query('governancePolicies').collect(),
    );
    expect(merged[0].config).toEqual({ enabled: true, mode: 'opt-in' });
    expect(merged[0].updatedBy).toBe('admin_1');

    // down again is a no-op
    await runDown();
    expect(await types()).toEqual(['personalization']);
  });
});

// @vitest-environment node

import { expect } from 'vitest';

import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_1/01_automation_pins_to_bindings';

/** The single-pin world the migration expects: the retired store stamped the
 * SAME projectId on every version row of a pinned name (ownership was
 * version-invariant), and org-level automations carried none. */
async function seedPinnedWorld(
  ctx: {
    // oxlint-disable-next-line typescript/no-explicit-any -- convex-test world db, structurally typed by the harness
    db: any;
  },
  organizationId: string,
): Promise<{ projectId: string }> {
  const projectId: string = await ctx.db.insert('projects', {
    organizationId,
    name: 'Getting started',
    createdBy: 'user_seed',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  });
  for (const version of [1, 2]) {
    await ctx.db.insert('automations', {
      organizationId,
      name: 'levy-return-desk',
      version,
      projectId,
      document: { name: 'levy-return-desk', nodes: [] },
      createdBy: 'user_seed',
      createdAt: 1_700_000_000_000 + version,
    });
  }
  await ctx.db.insert('automations', {
    organizationId,
    name: 'org-wide-triage',
    version: 1,
    document: { name: 'org-wide-triage', nodes: [] },
    createdBy: 'user_seed',
    createdAt: 1_700_000_000_000,
  });
  return { projectId };
}

// The harness runs the full ritual automatically: up through the real runner,
// TRUE handler idempotency over migrated state, digest-equal down (the seeded
// world must come back byte-for-byte), ledger transitions, snapshot hygiene,
// and the destructive gate. This file provides DATA + migration-specific truth.
defineMigrationTest({
  id: '0.4.1/01_automation_pins_to_bindings',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),

  async seed(ctx, orgs) {
    const org = orgs[0];
    if (!org) throw new Error('harness seeded no org');
    await seedPinnedWorld(ctx, org.id);
  },

  async expectUp(world) {
    const { bindings, automations } = await world.run(async (ctx) => ({
      bindings: await ctx.db.query('automationProjectBindings').collect(),
      automations: await ctx.db.query('automations').collect(),
    }));
    // One binding per pinned NAME — the two version rows dedupe into it.
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      automationName: 'levy-return-desk',
      boundBy: 'migration:automation_pins_to_bindings',
    });
    // The scalar pin is gone from every version row, org-level included.
    expect(automations).toHaveLength(3);
    for (const row of automations) {
      expect(row.projectId).toBeUndefined();
    }
  },

  cases: {
    // A name bound to SEVERAL projects after the migration cannot round-trip
    // into the single-pin world: down restores one binding per walk step, so
    // the name degrades to a single consistent pin and no binding survives.
    'down degrades a multi-bound name to a single pin': async (world) => {
      await world.applyUpOnly();
      const { extraProjectId, originalProjectId } = await world.run(
        async (ctx) => {
          const binding = await ctx.db
            .query('automationProjectBindings')
            .first();
          if (!binding) throw new Error('up seeded no binding');
          const extra: string = await ctx.db.insert('projects', {
            organizationId: binding.organizationId,
            name: 'Second surface',
            createdBy: 'user_seed',
            createdAt: 1_700_000_000_001,
            updatedAt: 1_700_000_000_001,
          });
          await ctx.db.insert('automationProjectBindings', {
            organizationId: binding.organizationId,
            automationName: binding.automationName,
            projectId: extra,
            boundAt: 1_700_000_000_002,
            boundBy: 'user_seed',
          });
          return {
            extraProjectId: extra,
            originalProjectId: binding.projectId as string,
          };
        },
      );
      await world.applyDownOnly();
      const { bindings, pinned } = await world.run(async (ctx) => ({
        bindings: await ctx.db.query('automationProjectBindings').collect(),
        pinned: (await ctx.db.query('automations').collect()).filter(
          // oxlint-disable-next-line typescript/no-explicit-any -- world rows are untyped by design
          (row: any) => row.name === 'levy-return-desk',
        ),
      }));
      expect(bindings).toHaveLength(0);
      const pins = new Set(
        pinned.map((row: { projectId?: string }) => row.projectId),
      );
      // Every version row carries the SAME pin, and it is one of the two
      // bound projects — which one wins is walk order, not a contract.
      expect(pins.size).toBe(1);
      const [pin] = pins;
      expect([extraProjectId, originalProjectId]).toContain(pin);
    },
  },
});

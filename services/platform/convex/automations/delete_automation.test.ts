// @vitest-environment node

/**
 * Deleting an automation, off the auth gate: the cascade removes every
 * version, the deployment, the triggers and the project bindings in one
 * transaction; a live run blocks it with the reason; run history survives;
 * and the tombstone closes the resurrection loop with the default-pack
 * seeder — a deleted builtin stays deleted across deploys until someone
 * saves the name again. The public mutation only adds
 * `requireOrgAdminOrDeveloper` on top (Better Auth cannot register under
 * convexTest, so the contract is proven at the store seam it lives in).
 */

import { convexTest, type TestConvex } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import type { Automation } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import {
  automationStore,
  bindingsOf,
  deleteAutomationCascade,
  deploymentRow,
  tombstoneRow,
  triggerRow,
  versionsOf,
} from './store';

const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
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

const ORG = 'org_delete_a';
const OTHER_ORG = 'org_delete_b';
const ACTOR = 'user_admin';
type T = TestConvex<typeof schema>;

function automation(name: string): Automation {
  return {
    version: 1,
    name,
    nodes: [{ id: 'shape', type: 'transform', code: 'return 1' }],
    output: '{{ nodes.shape.output }}',
  };
}

/** A fully-furnished automation: two versions, deployed, trigger bound,
 * bound to a project, with one terminal run on record. */
async function seedFurnished(
  t: T,
  organizationId: string,
  name: string,
): Promise<Id<'projects'>> {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId,
      name: 'Desk',
      createdBy: ACTOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const store = automationStore(ctx, {
      organizationId,
      actor: ACTOR,
      projectId,
    });
    await store.save(automation(name));
    await store.save(automation(name));
    await store.deploy(name, 2);
    await store.setTrigger(name, {
      kind: 'schedule',
      cron: '0 */6 * * *',
      timezone: 'UTC',
      enabled: true,
    });
    await ctx.db.insert('automationRuns', {
      organizationId,
      name,
      version: 2,
      status: 'success',
      mode: 'live',
      startedBy: ACTOR,
      input: {},
      startedAt: 1,
      finishedAt: 2,
    });
    return projectId;
  });
}

async function insertRun(
  t: T,
  name: string,
  status: 'queued' | 'running' | 'waiting',
): Promise<Id<'automationRuns'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('automationRuns', {
      organizationId: ORG,
      name,
      version: 2,
      status,
      mode: 'live',
      startedBy: ACTOR,
      input: {},
      startedAt: 3,
    }),
  );
}

describe('deleteAutomationCascade', () => {
  it('removes versions, deployment, trigger and bindings; keeps run history; writes the tombstone', async () => {
    const t = convexTest(schema, modules);
    await seedFurnished(t, ORG, 'desk/prepare');
    // Another organization's same-named automation must be untouched.
    await seedFurnished(t, OTHER_ORG, 'desk/prepare');

    const result = await t.run(async (ctx) =>
      deleteAutomationCascade(ctx, {
        organizationId: ORG,
        name: 'desk/prepare',
        actor: ACTOR,
      }),
    );
    expect(result).toEqual({ name: 'desk/prepare', versions: 2 });

    await t.run(async (ctx) => {
      expect(await versionsOf(ctx, ORG, 'desk/prepare')).toEqual([]);
      expect(await deploymentRow(ctx, ORG, 'desk/prepare')).toBeNull();
      expect(await triggerRow(ctx, ORG, 'desk/prepare')).toBeNull();
      expect(await bindingsOf(ctx, ORG, 'desk/prepare')).toEqual([]);
      const tombstone = await tombstoneRow(ctx, ORG, 'desk/prepare');
      expect(tombstone).toMatchObject({ deletedBy: ACTOR });
      // The terminal run is the audit record — retention owns its lifecycle.
      const runs = await ctx.db
        .query('automationRuns')
        .withIndex('by_org_name', (q) =>
          q.eq('organizationId', ORG).eq('name', 'desk/prepare'),
        )
        .collect();
      expect(runs).toHaveLength(1);
      // The sibling organization keeps everything.
      expect(await versionsOf(ctx, OTHER_ORG, 'desk/prepare')).toHaveLength(2);
      expect(await triggerRow(ctx, OTHER_ORG, 'desk/prepare')).not.toBeNull();
      expect(await tombstoneRow(ctx, OTHER_ORG, 'desk/prepare')).toBeNull();
    });
  });

  it.each(['queued', 'running', 'waiting'] as const)(
    'refuses while a run is %s, naming the state',
    async (status) => {
      const t = convexTest(schema, modules);
      await seedFurnished(t, ORG, 'desk/prepare');
      await insertRun(t, 'desk/prepare', status);

      await expect(
        t.run(async (ctx) =>
          deleteAutomationCascade(ctx, {
            organizationId: ORG,
            name: 'desk/prepare',
            actor: ACTOR,
          }),
        ),
      ).rejects.toThrow(ConvexError);
      // Nothing was half-deleted by the refusal.
      await t.run(async (ctx) => {
        expect(await versionsOf(ctx, ORG, 'desk/prepare')).toHaveLength(2);
        expect(await tombstoneRow(ctx, ORG, 'desk/prepare')).toBeNull();
      });
    },
  );

  it('refuses an unknown name', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) =>
        deleteAutomationCascade(ctx, {
          organizationId: ORG,
          name: 'desk/ghost',
          actor: ACTOR,
        }),
      ),
    ).rejects.toThrow(ConvexError);
  });

  it('keeps a deleted builtin deleted across reseeds, until a save revives the name', async () => {
    const t = convexTest(schema, modules);
    const pack = { document: automation('gmail-triage-inbox') };
    await t.mutation(internal.automations.mutations.seedDefaultPacks, {
      organizationId: ORG,
      packs: [pack],
    });
    await t.run(async (ctx) =>
      deleteAutomationCascade(ctx, {
        organizationId: ORG,
        name: 'gmail-triage-inbox',
        actor: ACTOR,
      }),
    );

    // The next deploy's provisioning must not resurrect the deleted pack.
    const reseed = await t.mutation(
      internal.automations.mutations.seedDefaultPacks,
      { organizationId: ORG, packs: [pack] },
    );
    expect(reseed.provisioned).toEqual([]);
    expect(reseed.skipped).toEqual(['gmail-triage-inbox']);
    await t.run(async (ctx) => {
      expect(await versionsOf(ctx, ORG, 'gmail-triage-inbox')).toEqual([]);
    });

    // Saving the name again clears the tombstone — the name is alive.
    await t.run(async (ctx) => {
      const store = automationStore(ctx, { organizationId: ORG, actor: ACTOR });
      await store.save(automation('gmail-triage-inbox'));
      expect(await tombstoneRow(ctx, ORG, 'gmail-triage-inbox')).toBeNull();
    });

    // A second delete re-records the tombstone (patch path) and the seeder
    // keeps skipping.
    await t.run(async (ctx) =>
      deleteAutomationCascade(ctx, {
        organizationId: ORG,
        name: 'gmail-triage-inbox',
        actor: 'user_other',
      }),
    );
    await t.run(async (ctx) => {
      expect(await tombstoneRow(ctx, ORG, 'gmail-triage-inbox')).toMatchObject({
        deletedBy: 'user_other',
      });
    });
    const reseedAgain = await t.mutation(
      internal.automations.mutations.seedDefaultPacks,
      { organizationId: ORG, packs: [pack] },
    );
    expect(reseedAgain.skipped).toEqual(['gmail-triage-inbox']);
  });
});

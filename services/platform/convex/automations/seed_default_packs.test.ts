// @vitest-environment node

/**
 * The provisioning seed's contract: shipped packs land exactly once per
 * organization, always as drafts, and never over anything the organization
 * already owns — not its versions, not its trigger bindings, not another
 * organization's rows.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Workflow } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import schema from '../schema';
import { automationReadStore, automationStore, triggerRow } from './store';

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

const ORG = 'org_seed_a';
const OTHER_ORG = 'org_seed_b';

type T = TestConvex<typeof schema>;

function workflow(name: string, code: string): Workflow {
  return {
    version: 1,
    name,
    nodes: [{ id: 'shape', type: 'transform', code }],
    output: '{{ nodes.shape.output }}',
  };
}

const SCHEDULE = {
  kind: 'schedule' as const,
  cron: '0 */6 * * *',
  timezone: 'UTC',
};

async function seed(
  t: T,
  organizationId: string,
  packs: Array<{ document: Workflow; trigger?: typeof SCHEDULE }>,
) {
  return await t.mutation(internal.automations.mutations.seedDefaultPacks, {
    organizationId,
    packs,
  });
}

describe('seedDefaultPacks', () => {
  it('seeds fresh packs as undeployed drafts with their trigger bound', async () => {
    const t = convexTest(schema, modules);

    const result = await seed(t, ORG, [
      {
        document: workflow('gmail-triage-inbox', 'return 1'),
        trigger: SCHEDULE,
      },
      { document: workflow('outlook-triage-inbox', 'return 2') },
    ]);

    expect(result.provisioned).toEqual([
      'gmail-triage-inbox',
      'outlook-triage-inbox',
    ]);
    expect(result.skipped).toEqual([]);

    const seen = await t.run(async (ctx) => {
      const store = automationReadStore(ctx, ORG);
      return {
        list: await store.list(),
        deployed: await store.deployedVersion('gmail-triage-inbox'),
        trigger: await triggerRow(ctx, ORG, 'gmail-triage-inbox'),
        untriggered: await triggerRow(ctx, ORG, 'outlook-triage-inbox'),
      };
    });
    expect(seen.list).toEqual([
      { name: 'gmail-triage-inbox', latest: 1 },
      { name: 'outlook-triage-inbox', latest: 1 },
    ]);
    // Draft: seeding never promotes a version to live.
    expect(seen.deployed).toBeNull();
    expect(seen.trigger).toMatchObject({
      kind: 'schedule',
      cron: '0 */6 * * *',
      enabled: true,
      createdBy: 'system:provisioning',
    });
    expect(seen.untriggered).toBeNull();
  });

  it('is idempotent: a re-run skips every seeded name untouched', async () => {
    const t = convexTest(schema, modules);
    const packs = [
      {
        document: workflow('gmail-triage-inbox', 'return 1'),
        trigger: SCHEDULE,
      },
    ];

    await seed(t, ORG, packs);
    const before = await t.run(
      async (ctx) => await triggerRow(ctx, ORG, 'gmail-triage-inbox'),
    );

    const second = await seed(t, ORG, packs);
    expect(second.provisioned).toEqual([]);
    expect(second.skipped).toEqual(['gmail-triage-inbox']);

    const after = await t.run(async (ctx) => ({
      list: await automationReadStore(ctx, ORG).list(),
      trigger: await triggerRow(ctx, ORG, 'gmail-triage-inbox'),
    }));
    // Still exactly one version, and the trigger row was not re-written.
    expect(after.list).toEqual([{ name: 'gmail-triage-inbox', latest: 1 }]);
    expect(after.trigger?.updatedAt).toBe(before?.updatedAt);
  });

  it('never touches a name the organization already saved — and binds it no trigger', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await automationStore(ctx, { organizationId: ORG, actor: 'user_1' }).save(
        workflow('gmail-triage-inbox', 'return "mine"'),
      );
    });

    const result = await seed(t, ORG, [
      {
        document: workflow('gmail-triage-inbox', 'return "pack"'),
        trigger: SCHEDULE,
      },
    ]);

    expect(result.provisioned).toEqual([]);
    expect(result.skipped).toEqual(['gmail-triage-inbox']);
    const seen = await t.run(async (ctx) => ({
      latest: await automationReadStore(ctx, ORG).get('gmail-triage-inbox'),
      trigger: await triggerRow(ctx, ORG, 'gmail-triage-inbox'),
    }));
    expect(seen.latest?.workflow).toMatchObject({
      nodes: [{ code: 'return "mine"' }],
    });
    // The org opted out of a binding by never creating one; seeding must not
    // arm a schedule behind its back.
    expect(seen.trigger).toBeNull();
  });

  it('keeps a pre-existing trigger binding over the pack default', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await automationStore(ctx, {
        organizationId: ORG,
        actor: 'user_1',
      }).setTrigger('gmail-triage-inbox', {
        kind: 'schedule',
        cron: '0 9 * * 1',
        enabled: false,
      });
    });

    const result = await seed(t, ORG, [
      {
        document: workflow('gmail-triage-inbox', 'return 1'),
        trigger: SCHEDULE,
      },
    ]);

    expect(result.provisioned).toEqual(['gmail-triage-inbox']);
    const trigger = await t.run(
      async (ctx) => await triggerRow(ctx, ORG, 'gmail-triage-inbox'),
    );
    expect(trigger).toMatchObject({ cron: '0 9 * * 1', enabled: false });
  });

  it('scopes to one organization', async () => {
    const t = convexTest(schema, modules);
    await seed(t, ORG, [
      {
        document: workflow('gmail-triage-inbox', 'return 1'),
        trigger: SCHEDULE,
      },
    ]);

    const other = await t.run(async (ctx) => ({
      list: await automationReadStore(ctx, OTHER_ORG).list(),
      trigger: await triggerRow(ctx, OTHER_ORG, 'gmail-triage-inbox'),
    }));
    expect(other.list).toEqual([]);
    expect(other.trigger).toBeNull();
  });
});

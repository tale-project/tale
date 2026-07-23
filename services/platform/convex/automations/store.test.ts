// @vitest-environment node

/**
 * The store's contract, against a real Convex world.
 *
 * Two properties carry everything else: a version, once written, never changes
 * and never gets a number twice; and no operation can see or touch a row that
 * belongs to another organization. Both are asserted from both sides — org A
 * cannot reach org B's rows and org B cannot reach org A's — because a scoping
 * bug is usually asymmetric (a missing filter on one path only).
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Workflow } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import schema from '../schema';
import { automationStore, automationReadStore } from './store';

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

const ORG = 'org_store_a';
const OTHER_ORG = 'org_store_b';
const ACTOR = 'user_store_1';

type T = TestConvex<typeof schema>;

function workflow(name: string, code: string): Workflow {
  return {
    version: 1,
    name,
    nodes: [{ id: 'shape', type: 'transform', code }],
    output: '{{ nodes.shape.output }}',
  };
}

async function save(
  t: T,
  organizationId: string,
  wf: Workflow,
  options?: { message?: string; testsPassed?: boolean },
): Promise<{ name: string; version: number }> {
  return await t.run(
    async (ctx) =>
      await automationStore(ctx, { organizationId, actor: ACTOR }).save(
        wf,
        options?.message,
        options?.testsPassed === undefined
          ? undefined
          : { testsPassed: options.testsPassed },
      ),
  );
}

async function deploy(
  t: T,
  organizationId: string,
  name: string,
  version: number,
): Promise<{ name: string; version: number }> {
  return await t.run(
    async (ctx) =>
      await automationStore(ctx, { organizationId, actor: ACTOR }).deploy(
        name,
        version,
      ),
  );
}

describe('automation store — versions', () => {
  it('appends contiguous versions and never rewrites one', async () => {
    const t = convexTest(schema, modules);

    const first = await save(t, ORG, workflow('billing/dunning', 'return 1'));
    const second = await save(t, ORG, workflow('billing/dunning', 'return 2'), {
      message: 'second pass',
    });
    const third = await save(t, ORG, workflow('billing/dunning', 'return 3'));

    expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);

    const stored = await t.run(async (ctx) => {
      const store = automationReadStore(ctx, ORG);
      return {
        v1: await store.get('billing/dunning', 1),
        v2: await store.get('billing/dunning', 2),
        latest: await store.get('billing/dunning'),
        list: await store.list(),
      };
    });

    // Version 1 still holds exactly what was saved as version 1 — saving twice
    // more did not touch it.
    expect(stored.v1?.workflow).toMatchObject({
      nodes: [{ code: 'return 1' }],
    });
    expect(stored.v2?.workflow).toMatchObject({
      nodes: [{ code: 'return 2' }],
    });
    expect(stored.latest?.meta.version).toBe(3);
    expect(stored.list).toEqual([{ name: 'billing/dunning', latest: 3 }]);
  });

  it('numbers each automation independently and reports an unknown one as null', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('one', 'return 1'));
    await save(t, ORG, workflow('one', 'return 1'));
    await save(t, ORG, workflow('two', 'return 2'));

    const seen = await t.run(async (ctx) => {
      const store = automationReadStore(ctx, ORG);
      return {
        list: await store.list(),
        missing: await store.get('nope'),
        pastEnd: await store.get('two', 5),
      };
    });
    expect(seen.list).toEqual([
      { name: 'one', latest: 2 },
      { name: 'two', latest: 1 },
    ]);
    expect(seen.missing).toBeNull();
    expect(seen.pastEnd).toBeNull();
  });

  it('refuses a name that is not a slug path', async () => {
    const t = convexTest(schema, modules);
    await expect(
      save(t, ORG, workflow('Not A Slug', 'return 1')),
    ).rejects.toThrow(/not a valid automation name/);
  });
});

describe('automation store — deploy', () => {
  it('promotes a version and replaces the previous deployment in place', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('reports/weekly', 'return 1'));
    await save(t, ORG, workflow('reports/weekly', 'return 2'));

    await deploy(t, ORG, 'reports/weekly', 1);
    await deploy(t, ORG, 'reports/weekly', 2);

    const state = await t.run(async (ctx) => ({
      deployed: await automationReadStore(ctx, ORG).deployedVersion(
        'reports/weekly',
      ),
      rows: await ctx.db.query('workflowDeployments').collect(),
      history: await ctx.db.query('workflows').collect(),
    }));
    expect(state.deployed).toBe(2);
    // One deployment row, and the history is untouched by promoting.
    expect(state.rows).toHaveLength(1);
    expect(state.history).toHaveLength(2);
  });

  it('refuses an unknown version', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('reports/weekly', 'return 1'));
    await expect(deploy(t, ORG, 'reports/weekly', 7)).rejects.toThrow(
      'cannot deploy unknown version reports/weekly@7',
    );
  });

  it('refuses a version whose tests failed — the deploy gate', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('reports/weekly', 'return 1'), {
      testsPassed: false,
    });
    await expect(deploy(t, ORG, 'reports/weekly', 1)).rejects.toThrow(
      /deploy gate/,
    );

    // The gate is about the RECORDED result: a version saved with passing
    // tests promotes.
    await save(t, ORG, workflow('reports/weekly', 'return 2'), {
      testsPassed: true,
    });
    await expect(deploy(t, ORG, 'reports/weekly', 2)).resolves.toEqual({
      name: 'reports/weekly',
      version: 2,
    });
  });
});

describe('automation store — tenant isolation', () => {
  it('keeps two organizations that use the same automation name apart', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('shared/name', 'return "a"'));
    await save(t, OTHER_ORG, workflow('shared/name', 'return "b1"'));
    await save(t, OTHER_ORG, workflow('shared/name', 'return "b2"'));

    const view = await t.run(async (ctx) => ({
      a: await automationReadStore(ctx, ORG).get('shared/name'),
      b: await automationReadStore(ctx, OTHER_ORG).get('shared/name'),
      aList: await automationReadStore(ctx, ORG).list(),
      bList: await automationReadStore(ctx, OTHER_ORG).list(),
    }));

    // Versions are numbered per organization, and each side reads its own.
    expect(view.a?.meta.version).toBe(1);
    expect(view.b?.meta.version).toBe(2);
    expect(view.a?.workflow).toMatchObject({ nodes: [{ code: 'return "a"' }] });
    expect(view.b?.workflow).toMatchObject({
      nodes: [{ code: 'return "b2"' }],
    });
    expect(view.aList).toEqual([{ name: 'shared/name', latest: 1 }]);
    expect(view.bList).toEqual([{ name: 'shared/name', latest: 2 }]);
  });

  it('cannot deploy or read across the boundary, in either direction', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('a-only', 'return 1'));
    await save(t, OTHER_ORG, workflow('b-only', 'return 1'));

    // B cannot promote A's automation, and A cannot promote B's.
    await expect(deploy(t, OTHER_ORG, 'a-only', 1)).rejects.toThrow(
      'cannot deploy unknown version a-only@1',
    );
    await expect(deploy(t, ORG, 'b-only', 1)).rejects.toThrow(
      'cannot deploy unknown version b-only@1',
    );

    // Neither can read the other's document or deployment.
    await deploy(t, ORG, 'a-only', 1);
    const view = await t.run(async (ctx) => ({
      bReadsA: await automationReadStore(ctx, OTHER_ORG).get('a-only'),
      bSeesADeployment: await automationReadStore(
        ctx,
        OTHER_ORG,
      ).deployedVersion('a-only'),
      aReadsB: await automationReadStore(ctx, ORG).get('b-only'),
    }));
    expect(view.bReadsA).toBeNull();
    expect(view.bSeesADeployment).toBeNull();
    expect(view.aReadsB).toBeNull();
  });

  it('refuses to load another organization run or document through the internal reads', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, workflow('a-only', 'return 1'));
    await deploy(t, ORG, 'a-only', 1);
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert('workflowRuns', {
          organizationId: ORG,
          name: 'a-only',
          version: 1,
          status: 'queued',
          mode: 'mock',
          startedBy: 'user:test',
          input: {},
          startedAt: Date.now(),
        }),
    );

    const asOwner = await t.query(internal.automations.queries.loadRunForStep, {
      organizationId: ORG,
      runId,
    });
    const asOther = await t.query(internal.automations.queries.loadRunForStep, {
      organizationId: OTHER_ORG,
      runId,
    });
    expect(asOwner?.run.name).toBe('a-only');
    // A run id from another organization reads as "not found" — the caller
    // learns nothing about whether it exists.
    expect(asOther).toBeNull();

    const docAsOther = await t.query(
      internal.automations.queries.loadWorkflowDocument,
      { organizationId: OTHER_ORG, name: 'a-only' },
    );
    expect(docAsOther).toBeNull();
  });
});

describe('automation store — triggers', () => {
  it('replaces the binding in place and keeps a webhook token across an edit', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: ACTOR,
      });
      await store.setTrigger('nightly', {
        kind: 'webhook',
        tokenHash: 'hash-1',
      });
      await store.setTrigger('nightly', {
        kind: 'schedule',
        cron: '0 3 * * *',
        timezone: 'Europe/Zurich',
      });
    });

    const rows = await t.run(
      async (ctx) => await ctx.db.query('workflowTriggers').collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: ORG,
      kind: 'schedule',
      cron: '0 3 * * *',
      timezone: 'Europe/Zurich',
      // The URL a vendor already holds keeps working: an edit that carries no
      // token does not clear the verifier.
      tokenHash: 'hash-1',
      enabled: true,
    });
  });

  it('refuses a trigger that cannot fire', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await automationStore(ctx, {
          organizationId: ORG,
          actor: ACTOR,
        }).setTrigger('nightly', { kind: 'schedule' });
      }),
    ).rejects.toThrow(/needs a cron expression/);
    await expect(
      t.run(async (ctx) => {
        await automationStore(ctx, {
          organizationId: ORG,
          actor: ACTOR,
        }).setTrigger('nightly', { kind: 'event' });
      }),
    ).rejects.toThrow(/needs an event name/);
  });
});

describe('automation store — the action-side surface', () => {
  /**
   * `dispatch()` reaches the store through these registered functions rather
   * than through a database handle it does not have. They must behave exactly
   * like the transactional store, scope included.
   */
  it('round-trips a version, a deployment and a run through the internal functions', async () => {
    const t = convexTest(schema, modules);

    const saved = await t.mutation(internal.automations.mutations.storeSave, {
      organizationId: ORG,
      actor: ACTOR,
      workflow: workflow('agent/authored', 'return 1'),
      message: 'from the builder',
      testsPassed: true,
    });
    expect(saved).toEqual({ name: 'agent/authored', version: 1 });

    await t.mutation(internal.automations.mutations.storeDeploy, {
      organizationId: ORG,
      actor: ACTOR,
      name: 'agent/authored',
      version: 1,
    });
    await t.mutation(internal.automations.mutations.storeSetTrigger, {
      organizationId: ORG,
      actor: ACTOR,
      name: 'agent/authored',
      trigger: { kind: 'event', event: 'ticket.created' },
    });
    await t.mutation(internal.automations.mutations.storeRecordRun, {
      organizationId: ORG,
      actor: ACTOR,
      name: 'agent/authored',
      version: 1,
      result: {
        status: 'success',
        output: { ok: true },
        trace: [],
        effects: [],
      },
      mode: 'mock',
    });

    expect(
      await t.query(internal.automations.queries.storeList, {
        organizationId: ORG,
      }),
    ).toEqual([{ name: 'agent/authored', latest: 1 }]);
    expect(
      await t.query(internal.automations.queries.storeDeployedVersion, {
        organizationId: ORG,
        name: 'agent/authored',
      }),
    ).toBe(1);
    const fetched = await t.query(internal.automations.queries.storeGet, {
      organizationId: ORG,
      name: 'agent/authored',
    });
    expect(fetched?.meta.version).toBe(1);

    // Same calls, other organization: nothing of ORG's is visible.
    expect(
      await t.query(internal.automations.queries.storeList, {
        organizationId: OTHER_ORG,
      }),
    ).toEqual([]);
    expect(
      await t.query(internal.automations.queries.storeGet, {
        organizationId: OTHER_ORG,
        name: 'agent/authored',
      }),
    ).toBeNull();
    expect(
      await t.query(internal.automations.queries.storeDeployedVersion, {
        organizationId: OTHER_ORG,
        name: 'agent/authored',
      }),
    ).toBeNull();

    const runs = await t.run(
      async (ctx) => await ctx.db.query('workflowRuns').collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      organizationId: ORG,
      status: 'success',
      mode: 'mock',
      output: { ok: true },
    });
  });
});

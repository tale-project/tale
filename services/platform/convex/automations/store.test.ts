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

import type { Automation } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import type { StoredTrigger } from './store';
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

function automation(name: string, code: string): Automation {
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
  wf: Automation,
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

    const first = await save(t, ORG, automation('billing/dunning', 'return 1'));
    const second = await save(
      t,
      ORG,
      automation('billing/dunning', 'return 2'),
      {
        message: 'second pass',
      },
    );
    const third = await save(t, ORG, automation('billing/dunning', 'return 3'));

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
    expect(stored.v1?.automation).toMatchObject({
      nodes: [{ code: 'return 1' }],
    });
    expect(stored.v2?.automation).toMatchObject({
      nodes: [{ code: 'return 2' }],
    });
    expect(stored.latest?.meta.version).toBe(3);
    expect(stored.list).toEqual([{ name: 'billing/dunning', latest: 3 }]);
  });

  it('numbers each automation independently and reports an unknown one as null', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, automation('one', 'return 1'));
    await save(t, ORG, automation('one', 'return 1'));
    await save(t, ORG, automation('two', 'return 2'));

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
      save(t, ORG, automation('Not A Slug', 'return 1')),
    ).rejects.toThrow(/not a valid automation name/);
  });
});

describe('automation store — deploy', () => {
  it('promotes a version and replaces the previous deployment in place', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, automation('reports/weekly', 'return 1'));
    await save(t, ORG, automation('reports/weekly', 'return 2'));

    await deploy(t, ORG, 'reports/weekly', 1);
    await deploy(t, ORG, 'reports/weekly', 2);

    const state = await t.run(async (ctx) => ({
      deployed: await automationReadStore(ctx, ORG).deployedVersion(
        'reports/weekly',
      ),
      rows: await ctx.db.query('automationDeployments').collect(),
      history: await ctx.db.query('automations').collect(),
    }));
    expect(state.deployed).toBe(2);
    // One deployment row, and the history is untouched by promoting.
    expect(state.rows).toHaveLength(1);
    expect(state.history).toHaveLength(2);
  });

  it('refuses an unknown version', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, automation('reports/weekly', 'return 1'));
    await expect(deploy(t, ORG, 'reports/weekly', 7)).rejects.toThrow(
      'cannot deploy unknown version reports/weekly@7',
    );
  });

  it('refuses a version whose tests failed — the deploy gate', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, automation('reports/weekly', 'return 1'), {
      testsPassed: false,
    });
    await expect(deploy(t, ORG, 'reports/weekly', 1)).rejects.toThrow(
      /deploy gate/,
    );

    // The gate is about the RECORDED result: a version saved with passing
    // tests promotes.
    await save(t, ORG, automation('reports/weekly', 'return 2'), {
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
    await save(t, ORG, automation('shared/name', 'return "a"'));
    await save(t, OTHER_ORG, automation('shared/name', 'return "b1"'));
    await save(t, OTHER_ORG, automation('shared/name', 'return "b2"'));

    const view = await t.run(async (ctx) => ({
      a: await automationReadStore(ctx, ORG).get('shared/name'),
      b: await automationReadStore(ctx, OTHER_ORG).get('shared/name'),
      aList: await automationReadStore(ctx, ORG).list(),
      bList: await automationReadStore(ctx, OTHER_ORG).list(),
    }));

    // Versions are numbered per organization, and each side reads its own.
    expect(view.a?.meta.version).toBe(1);
    expect(view.b?.meta.version).toBe(2);
    expect(view.a?.automation).toMatchObject({
      nodes: [{ code: 'return "a"' }],
    });
    expect(view.b?.automation).toMatchObject({
      nodes: [{ code: 'return "b2"' }],
    });
    expect(view.aList).toEqual([{ name: 'shared/name', latest: 1 }]);
    expect(view.bList).toEqual([{ name: 'shared/name', latest: 2 }]);
  });

  it('cannot deploy or read across the boundary, in either direction', async () => {
    const t = convexTest(schema, modules);
    await save(t, ORG, automation('a-only', 'return 1'));
    await save(t, OTHER_ORG, automation('b-only', 'return 1'));

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
    await save(t, ORG, automation('a-only', 'return 1'));
    await deploy(t, ORG, 'a-only', 1);
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert('automationRuns', {
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
      internal.automations.queries.loadAutomationDocument,
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
      async (ctx) => await ctx.db.query('automationTriggers').collect(),
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

  /**
   * The `api-key` kind is retired: a programmatic start is what the REST and
   * MCP surfaces are for, so it never had a delivery path of its own. The
   * refusal has to hold at RUNTIME, not only in the type — the action-side
   * `storeSetTrigger` takes the spec as `v.any()`, so an agent or an API client
   * can present the retired kind however it likes.
   */
  it('refuses the retired api-key kind', async () => {
    const t = convexTest(schema, modules);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately presenting a kind the type no longer allows
    const retired = { kind: 'api-key' } as unknown as StoredTrigger;
    await expect(
      t.run(async (ctx) => {
        await automationStore(ctx, {
          organizationId: ORG,
          actor: ACTOR,
        }).setTrigger('nightly', retired);
      }),
    ).rejects.toThrow(
      /unknown trigger kind "api-key" — one of schedule, webhook, event/,
    );
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
      automation: automation('agent/authored', 'return 1'),
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
      async (ctx) => await ctx.db.query('automationRuns').collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      organizationId: ORG,
      status: 'success',
      mode: 'mock',
      output: { ok: true },
    });
  });

  it('stores a validated settings declaration with the version and refuses a malformed one', async () => {
    const t = convexTest(schema, modules);

    const settings = {
      forms: [
        {
          file: 'fx-policy.yaml',
          title: 'FX conversion policy',
          fields: [{ key: 'method', label: 'Method', type: 'text' }],
        },
      ],
    };
    await t.mutation(internal.automations.mutations.storeSave, {
      organizationId: ORG,
      actor: ACTOR,
      automation: automation('desk/settings-carrier', 'return 1'),
      settings,
    });
    const row = await t.run(
      async (ctx) =>
        await ctx.db
          .query('automations')
          .withIndex('by_org_name', (q) =>
            q.eq('organizationId', ORG).eq('name', 'desk/settings-carrier'),
          )
          .unique(),
    );
    expect(row?.settings).toEqual(settings);

    await expect(
      t.mutation(internal.automations.mutations.storeSave, {
        organizationId: ORG,
        actor: ACTOR,
        automation: automation('desk/settings-carrier', 'return 2'),
        settings: { forms: [] },
      }),
    ).rejects.toThrowError(/not a valid settings declaration/);
  });
});

/**
 * Run control from an action — the path an organization API key takes through
 * the MCP endpoint.
 *
 * The rule under test is authorization, and it matters here more than anywhere
 * else in the store: an API key proves WHO is calling, and starting a live run
 * may send mail on the organization's behalf, so the caller's ROLE has to decide
 * whether the call proceeds. A mock run reaches nothing and needs only
 * membership, which is what keeps the authoring loop usable.
 */
describe('automation store — run control by actor', () => {
  const DEVELOPER = 'user_dev_1';
  const PLAIN_MEMBER = 'user_member_1';
  const STRANGER = 'user_outsider_1';

  async function world(): Promise<T> {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: 'ba_member_dev',
        userId: DEVELOPER,
        organizationId: ORG,
        role: 'developer',
        createdAt: 0,
      });
      await ctx.db.insert('memberMirror', {
        memberId: 'ba_member_plain',
        userId: PLAIN_MEMBER,
        organizationId: ORG,
        role: 'member',
        createdAt: 0,
      });
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: DEVELOPER,
      });
      const saved = await store.save(automation('ops/nightly', 'return 1'));
      await store.deploy(saved.name, saved.version);
    });
    return t;
  }

  function start(
    t: T,
    actor: string,
    mode: 'mock' | 'live',
  ): Promise<{ runId: Id<'automationRuns'>; version: number } | null> {
    return t.mutation(internal.automations.mutations.storeStartRun, {
      organizationId: ORG,
      actor,
      name: 'ops/nightly',
      input: {},
      mode,
    });
  }

  it('starts a live run for a developer, addressed as an api key', async () => {
    const t = await world();
    const started = await start(t, `api-key:${DEVELOPER}`, 'live');
    expect(started?.version).toBe(1);

    const runs = await t.run(
      async (ctx) => await ctx.db.query('automationRuns').collect(),
    );
    expect(runs).toHaveLength(1);
    // The run log names the key, not just the person behind it.
    expect(runs[0]).toMatchObject({
      mode: 'live',
      startedBy: `api-key:${DEVELOPER}`,
    });
  });

  it('refuses a live run for a member, and allows the same run as a mock', async () => {
    const t = await world();
    await expect(start(t, `api-key:${PLAIN_MEMBER}`, 'live')).rejects.toThrow(
      /developer-settings capability/,
    );
    expect(
      await t.run(
        async (ctx) => await ctx.db.query('automationRuns').collect(),
      ),
    ).toEqual([]);

    const mock = await start(t, `api-key:${PLAIN_MEMBER}`, 'mock');
    expect(mock?.version).toBe(1);
  });

  it('refuses a caller who is not a member at all', async () => {
    const t = await world();
    await expect(start(t, `api-key:${STRANGER}`, 'mock')).rejects.toThrow(
      /not a member of this organization/,
    );
  });

  it('refuses to cancel or unbind without the developer capability', async () => {
    const t = await world();
    const started = await start(t, `api-key:${DEVELOPER}`, 'live');
    const runId = started?.runId;
    if (!runId) throw new Error('the run was not started');

    await expect(
      t.mutation(internal.automations.mutations.storeCancelRun, {
        organizationId: ORG,
        actor: `api-key:${PLAIN_MEMBER}`,
        runId,
      }),
    ).rejects.toThrow(/developer-settings capability/);
    await expect(
      t.mutation(internal.automations.mutations.storeDeleteTrigger, {
        organizationId: ORG,
        actor: `api-key:${PLAIN_MEMBER}`,
        name: 'ops/nightly',
      }),
    ).rejects.toThrow(/developer-settings capability/);
  });

  it('cancels a run in flight and reports a handle that is not one', async () => {
    const t = await world();
    const started = await start(t, `api-key:${DEVELOPER}`, 'live');
    const runId = started?.runId;
    if (!runId) throw new Error('the run was not started');

    expect(
      await t.mutation(internal.automations.mutations.storeCancelRun, {
        organizationId: ORG,
        actor: `api-key:${DEVELOPER}`,
        runId,
      }),
    ).toEqual({ cancelled: true });
    // Cancelling a settled run is not an error — there is simply nothing left.
    expect(
      await t.mutation(internal.automations.mutations.storeCancelRun, {
        organizationId: ORG,
        actor: `api-key:${DEVELOPER}`,
        runId,
      }),
    ).toEqual({ cancelled: false });
    // An unusable handle reads as a miss rather than raising.
    expect(
      await t.mutation(internal.automations.mutations.storeCancelRun, {
        organizationId: ORG,
        actor: `api-key:${DEVELOPER}`,
        runId: 'not-an-id',
      }),
    ).toBeNull();
  });

  it('reads runs, versions and triggers the way the engine addresses them', async () => {
    const t = await world();
    await start(t, `api-key:${DEVELOPER}`, 'live');
    await t.run(async (ctx) => {
      await automationStore(ctx, {
        organizationId: ORG,
        actor: DEVELOPER,
      }).setTrigger('ops/nightly', { kind: 'webhook', tokenHash: 'hash-1' });
    });

    const runs = await t.query(internal.automations.queries.storeListRuns, {
      organizationId: ORG,
      name: 'ops/nightly',
    });
    expect(runs).toHaveLength(1);
    // `runId`, not `id`: the engine's own field name for a run handle.
    expect(runs[0].runId).toBeDefined();

    const detail = await t.query(internal.automations.queries.storeGetRun, {
      organizationId: ORG,
      runId: runs[0].runId,
    });
    expect(detail).toMatchObject({ name: 'ops/nightly', version: 1 });

    // Another organization's key cannot read the run, even with its handle.
    expect(
      await t.query(internal.automations.queries.storeGetRun, {
        organizationId: OTHER_ORG,
        runId: runs[0].runId,
      }),
    ).toBeNull();
    expect(
      await t.query(internal.automations.queries.storeGetRun, {
        organizationId: ORG,
        runId: 'not-an-id',
      }),
    ).toBeNull();

    expect(
      await t.query(internal.automations.queries.storeListVersions, {
        organizationId: ORG,
        name: 'ops/nightly',
      }),
    ).toMatchObject([{ version: 1, createdBy: DEVELOPER }]);

    const triggers = await t.query(
      internal.automations.queries.storeListTriggers,
      { organizationId: ORG },
    );
    // The verifier for the webhook secret never leaves the server.
    expect(triggers).toEqual([
      {
        name: 'ops/nightly',
        kind: 'webhook',
        hasToken: true,
        enabled: true,
      },
    ]);
  });
});

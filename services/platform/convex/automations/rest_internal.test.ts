// @vitest-environment node

/**
 * The API key's half of the automation store, against the real tables.
 *
 * These are the functions the REST handlers delegate to, so this suite holds
 * what a handler test cannot: that the organization on the argument is the ONLY
 * scope any of them read or write through. A name that exists in another
 * organization is not "someone else's" — it does not exist, and starting it is
 * refused with the same answer an undeployed automation gets.
 *
 * It also pins the webhook-token rule (mint once, keep on re-bind, rotate on
 * request) and the run lifecycle a REST-started run shares with a triggered one.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Automation } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';
import { automationStore } from './store';

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
const authModules = import.meta.glob('../betterAuth/**/*.*s');

const ORG = 'org_rest_a';
const OTHER_ORG = 'org_rest_b';
const KEY_USER = 'user_key_holder';

type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

function automation(name: string): Automation {
  return {
    version: 1,
    name,
    nodes: [{ id: 'noop', type: 'transform', code: 'return { ok: true }' }],
    output: '{{ nodes.noop.output }}',
  };
}

/** Save a version, and deploy it unless the test wants a draft-only automation. */
async function seed(
  t: T,
  organizationId: string,
  name: string,
  options: { deploy?: boolean } = {},
): Promise<number> {
  return await t.run(async (ctx) => {
    const store = automationStore(ctx, { organizationId, actor: KEY_USER });
    const saved = await store.save(automation(name));
    if (options.deploy !== false) await store.deploy(saved.name, saved.version);
    return saved.version;
  });
}

async function runsOf(t: T, organizationId: string) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query('automationRuns')
        .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
        .collect(),
  );
}

/**
 * The `code` of a thrown `ConvexError`. Crossing a convex-test function
 * boundary serializes `data` to JSON, exactly as a real deployment does over
 * the wire, so a caller has to read it back either way.
 */
function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

/** The error a promise rejected with, as a value. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    () => {
      throw new Error('expected the call to be refused, but it resolved');
    },
    (error: unknown) => error,
  );
}

describe('restStartRun', () => {
  it('starts the deployed version and stamps the API-key caller', async () => {
    const t = newWorld();
    await seed(t, ORG, 'billing/dunning-reminder');

    const started = await t.mutation(
      internal.automations.rest_api.restStartRun,
      {
        organizationId: ORG,
        name: 'billing/dunning-reminder',
        input: { invoice: 7 },
        mode: 'live',
        startedBy: `api-key:${KEY_USER}`,
      },
    );
    expect(started.version).toBe(1);

    const runs = await runsOf(t, ORG);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      name: 'billing/dunning-reminder',
      status: 'queued',
      mode: 'live',
      startedBy: `api-key:${KEY_USER}`,
      input: { invoice: 7 },
    });
  });

  it('needs NO trigger row — the key is the entitlement', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/callable');
    const triggers = await t.run(
      async (ctx) => await ctx.db.query('automationTriggers').collect(),
    );
    expect(triggers).toHaveLength(0);

    await expect(
      t.mutation(internal.automations.rest_api.restStartRun, {
        organizationId: ORG,
        name: 'ops/callable',
        mode: 'live',
        startedBy: `api-key:${KEY_USER}`,
      }),
    ).resolves.toMatchObject({ version: 1 });
  });

  it('refuses an automation with no deployed version', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/draft-only', { deploy: false });

    const error = await rejection(
      t.mutation(internal.automations.rest_api.restStartRun, {
        organizationId: ORG,
        name: 'ops/draft-only',
        mode: 'live',
        startedBy: `api-key:${KEY_USER}`,
      }),
    );
    expect(codeOf(error)).toBe('AUTOMATION_NOT_DEPLOYED');
    expect(await runsOf(t, ORG)).toHaveLength(0);
  });

  it('cannot reach another organization automation, even by exact name', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/callable');

    const error = await rejection(
      t.mutation(internal.automations.rest_api.restStartRun, {
        organizationId: OTHER_ORG,
        name: 'ops/callable',
        mode: 'live',
        startedBy: `api-key:${KEY_USER}`,
      }),
    );
    expect(codeOf(error)).toBe('AUTOMATION_NOT_DEPLOYED');
    expect(await runsOf(t, ORG)).toHaveLength(0);
    expect(await runsOf(t, OTHER_ORG)).toHaveLength(0);
  });

  it('runs an explicitly named version instead of the deployed one', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/x');
    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: KEY_USER,
      });
      await store.save(automation('ops/x'));
    });

    const started = await t.mutation(
      internal.automations.rest_api.restStartRun,
      {
        organizationId: ORG,
        name: 'ops/x',
        mode: 'mock',
        version: 1,
        startedBy: `api-key:${KEY_USER}`,
      },
    );
    expect(started.version).toBe(1);
  });
});

describe('restListAutomations', () => {
  it('pages by name and marks the live version', async () => {
    const t = newWorld();
    await seed(t, ORG, 'a/one');
    await seed(t, ORG, 'b/two', { deploy: false });
    await seed(t, ORG, 'c/three');
    await seed(t, OTHER_ORG, 'z/other');

    const first = await t.query(
      internal.automations.rest_api.restListAutomations,
      { organizationId: ORG, cursor: null, limit: 2 },
    );
    expect(first.page.map((entry) => entry.name)).toEqual(['a/one', 'b/two']);
    // A deployed automation carries its live version; a draft-only one omits
    // the field entirely rather than reporting a version it does not run.
    expect(first.page[0]).toMatchObject({ deployedVersion: 1 });
    expect('deployedVersion' in first.page[1]).toBe(false);
    expect(first.isDone).toBe(false);

    const second = await t.query(
      internal.automations.rest_api.restListAutomations,
      { organizationId: ORG, cursor: first.continueCursor, limit: 2 },
    );
    expect(second.page.map((entry) => entry.name)).toEqual(['c/three']);
    expect(second.isDone).toBe(true);
    // Another organization's automation never appears in either page.
    expect([...first.page, ...second.page].map((e) => e.name)).not.toContain(
      'z/other',
    );
  });

  it('refuses a projectId that is not an id at all', async () => {
    const t = newWorld();
    const error = await rejection(
      t.query(internal.automations.rest_api.restListAutomations, {
        organizationId: ORG,
        projectId: 'not-an-id',
        cursor: null,
        limit: 10,
      }),
    );
    expect(codeOf(error)).toBe('PROJECT_NOT_FOUND');
  });
});

describe('restGetRun, restListRuns and restCancelRun', () => {
  type RunStatus =
    | 'queued'
    | 'running'
    | 'waiting'
    | 'success'
    | 'failed'
    | 'cancelled';

  async function seedRun(
    t: T,
    organizationId: string,
    status: RunStatus,
  ): Promise<string> {
    return await t.run(async (ctx) => {
      return await ctx.db.insert('automationRuns', {
        organizationId,
        name: 'ops/x',
        version: 1,
        status,
        mode: 'live',
        startedBy: `api-key:${KEY_USER}`,
        input: {},
        checkpoints: { nodes: {}, executions: 0 },
        startedAt: Date.now(),
      });
    });
  }

  it('reads a run of its own organization and NOT one of another', async () => {
    const t = newWorld();
    const mine = await seedRun(t, ORG, 'running');
    const theirs = await seedRun(t, OTHER_ORG, 'running');

    expect(
      await t.query(internal.automations.rest_api.restGetRun, {
        organizationId: ORG,
        runId: mine,
      }),
    ).toMatchObject({ id: mine, name: 'ops/x' });
    expect(
      await t.query(internal.automations.rest_api.restGetRun, {
        organizationId: ORG,
        runId: theirs,
      }),
    ).toBeNull();
  });

  it('reads a malformed run id as absent rather than throwing', async () => {
    const t = newWorld();
    expect(
      await t.query(internal.automations.rest_api.restGetRun, {
        organizationId: ORG,
        runId: 'nonsense',
      }),
    ).toBeNull();
  });

  it('pages the run log newest first', async () => {
    const t = newWorld();
    await seedRun(t, ORG, 'success');
    await seedRun(t, ORG, 'failed');

    const page = await t.query(internal.automations.rest_api.restListRuns, {
      organizationId: ORG,
      name: 'ops/x',
      cursor: null,
      limit: 1,
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0].status).toBe('failed');
    expect(page.isDone).toBe(false);
  });

  it('cancels a live run once, and refuses a run of another organization', async () => {
    const t = newWorld();
    const runId = await seedRun(t, ORG, 'running');

    expect(
      await t.mutation(internal.automations.rest_api.restCancelRun, {
        organizationId: ORG,
        runId,
      }),
    ).toEqual({ cancelled: true });
    // Terminal now: a second cancel is a no-op, not an error.
    expect(
      await t.mutation(internal.automations.rest_api.restCancelRun, {
        organizationId: ORG,
        runId,
      }),
    ).toEqual({ cancelled: false });

    const error = await rejection(
      t.mutation(internal.automations.rest_api.restCancelRun, {
        organizationId: OTHER_ORG,
        runId,
      }),
    );
    expect(codeOf(error)).toBe('AUTOMATION_RUN_NOT_FOUND');
  });
});

describe('restSetTrigger and restDeleteTrigger', () => {
  it('mints a webhook token once, keeps it on re-bind, and rotates on request', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/x');

    const minted = await t.mutation(
      internal.automations.rest_api.restSetTrigger,
      {
        organizationId: ORG,
        actor: KEY_USER,
        name: 'ops/x',
        trigger: { kind: 'webhook' },
      },
    );
    expect(typeof minted.token).toBe('string');

    const rebound = await t.mutation(
      internal.automations.rest_api.restSetTrigger,
      {
        organizationId: ORG,
        actor: KEY_USER,
        name: 'ops/x',
        trigger: { kind: 'webhook', enabled: false },
      },
    );
    // No new plaintext: the URL a vendor already holds still works.
    expect(rebound.token).toBeUndefined();

    const rotated = await t.mutation(
      internal.automations.rest_api.restSetTrigger,
      {
        organizationId: ORG,
        actor: KEY_USER,
        name: 'ops/x',
        trigger: { kind: 'webhook' },
        rotateToken: true,
      },
    );
    expect(rotated.token).toBeTypeOf('string');
    expect(rotated.token).not.toBe(minted.token);
  });

  it('never exposes the token verifier through the read', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/x');
    await t.mutation(internal.automations.rest_api.restSetTrigger, {
      organizationId: ORG,
      actor: KEY_USER,
      name: 'ops/x',
      trigger: { kind: 'webhook' },
    });

    const [view] = await t.query(
      internal.automations.rest_api.restListTriggers,
      { organizationId: ORG, name: 'ops/x' },
    );
    expect(view).toMatchObject({
      name: 'ops/x',
      kind: 'webhook',
      hasToken: true,
    });
    expect(Object.keys(view)).not.toContain('tokenHash');
  });

  it('refuses a schedule with no cron as a coded client error', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/x');
    const error = await rejection(
      t.mutation(internal.automations.rest_api.restSetTrigger, {
        organizationId: ORG,
        actor: KEY_USER,
        name: 'ops/x',
        trigger: { kind: 'schedule' },
      }),
    );
    expect(codeOf(error)).toBe('AUTOMATION_TRIGGER_REJECTED');
  });

  it('reports whether a delete had anything to unbind', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/x');
    expect(
      await t.mutation(internal.automations.rest_api.restDeleteTrigger, {
        organizationId: ORG,
        name: 'ops/x',
      }),
    ).toEqual({ deleted: false });

    await t.mutation(internal.automations.rest_api.restSetTrigger, {
      organizationId: ORG,
      actor: KEY_USER,
      name: 'ops/x',
      trigger: { kind: 'event', event: 'ticket.created' },
    });
    expect(
      await t.mutation(internal.automations.rest_api.restDeleteTrigger, {
        organizationId: ORG,
        name: 'ops/x',
      }),
    ).toEqual({ deleted: true });
    // Another organization's delete must not reach this trigger.
    await t.mutation(internal.automations.rest_api.restSetTrigger, {
      organizationId: ORG,
      actor: KEY_USER,
      name: 'ops/x',
      trigger: { kind: 'event', event: 'ticket.created' },
    });
    expect(
      await t.mutation(internal.automations.rest_api.restDeleteTrigger, {
        organizationId: OTHER_ORG,
        name: 'ops/x',
      }),
    ).toEqual({ deleted: false });
  });

  it('lists the versions of one automation, oldest first', async () => {
    const t = newWorld();
    await seed(t, ORG, 'ops/x');
    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: KEY_USER,
      });
      await store.save(automation('ops/x'), 'second');
    });

    const versions = await t.query(
      internal.automations.rest_api.restListVersions,
      { organizationId: ORG, name: 'ops/x' },
    );
    expect(versions.map((entry) => entry.version)).toEqual([1, 2]);
    expect(versions[1].message).toBe('second');
  });
});

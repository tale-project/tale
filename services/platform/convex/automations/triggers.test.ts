// @vitest-environment node

/**
 * What may start a run, and what may not.
 *
 * The webhook half is driven through the REAL route table (`t.fetch` →
 * `convex/http.ts`), because the registration is part of the contract: a token
 * that does not resolve must be indistinguishable from one that resolves to a
 * disabled trigger, and neither may start anything.
 *
 * The loop-safety invariant has its own test: an event a workflow run produced
 * never fires a trigger. Without that rule an automation that writes a record
 * which raises an event that starts the same automation is an unbounded loop,
 * and every iteration looks legitimate from inside.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import type { Workflow } from '../../lib/engine/core/types';
import { internal } from '../_generated/api';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';
import { cronMatches, dueOccurrence, parseCron } from './cron';
import { automationStore } from './store';
import { hashWebhookToken, mintWebhookToken } from './webhook_token';

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

const ORG = 'org_triggers_a';
const OTHER_ORG = 'org_triggers_b';
const ACTOR = 'user_triggers';

type T = TestConvex<typeof schema>;

function newWorld(): T {
  const t = convexTest(schema, modules);
  t.registerComponent('betterAuth', betterAuthSchema, authModules);
  return t;
}

function workflow(name: string): Workflow {
  return {
    version: 1,
    name,
    nodes: [{ id: 'noop', type: 'transform', code: 'return { ok: true }' }],
    output: '{{ nodes.noop.output }}',
  };
}

/** Publish an automation and bind a trigger to it, as the settings UI would. */
async function publish(
  t: T,
  organizationId: string,
  name: string,
  trigger?: Parameters<ReturnType<typeof automationStore>['setTrigger']>[1],
): Promise<void> {
  await t.run(async (ctx) => {
    const store = automationStore(ctx, { organizationId, actor: ACTOR });
    const saved = await store.save(workflow(name));
    await store.deploy(saved.name, saved.version);
    if (trigger) await store.setTrigger(name, trigger);
  });
}

/**
 * Move a trigger's creation into the past. A schedule is armed at creation —
 * the minute it was created in is not "missed" — so a test that wants a due
 * occurrence has to look like a trigger that has existed for a while.
 */
async function backdate(t: T, name: string, ms: number): Promise<void> {
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('workflowTriggers').collect()) {
      if (row.name === name) {
        await ctx.db.patch(row._id, { createdAt: Date.now() - ms });
      }
    }
  });
}

async function runsOf(t: T, organizationId: string) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query('workflowRuns')
        .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
        .collect(),
  );
}

describe('cron matching', () => {
  const ZURICH = 'Europe/Zurich';

  it('matches a wall-clock schedule in its own timezone', () => {
    const schedule = parseCron('30 9 * * *');
    // 2026-07-22T07:30:00Z is 09:30 in Zurich (CEST).
    expect(
      cronMatches(schedule, Date.parse('2026-07-22T07:30:00Z'), ZURICH),
    ).toBe(true);
    expect(
      cronMatches(schedule, Date.parse('2026-07-22T08:30:00Z'), ZURICH),
    ).toBe(false);
    // The same instant in UTC is 07:30, which the schedule does not match.
    expect(
      cronMatches(schedule, Date.parse('2026-07-22T07:30:00Z'), 'UTC'),
    ).toBe(false);
  });

  it('reads steps, lists and ranges', () => {
    const every15 = parseCron('*/15 * * * *');
    expect(
      cronMatches(every15, Date.parse('2026-07-22T10:15:00Z'), 'UTC'),
    ).toBe(true);
    expect(
      cronMatches(every15, Date.parse('2026-07-22T10:16:00Z'), 'UTC'),
    ).toBe(false);
    const officeHours = parseCron('0 9-17 * * 1-5');
    // Wednesday 14:00 UTC.
    expect(
      cronMatches(officeHours, Date.parse('2026-07-22T14:00:00Z'), 'UTC'),
    ).toBe(true);
    // Sunday 14:00 UTC — outside the weekday restriction.
    expect(
      cronMatches(officeHours, Date.parse('2026-07-26T14:00:00Z'), 'UTC'),
    ).toBe(false);
  });

  it('treats 0 and 7 as Sunday', () => {
    const sunday = parseCron('0 12 * * 7');
    expect(cronMatches(sunday, Date.parse('2026-07-26T12:00:00Z'), 'UTC')).toBe(
      true,
    );
  });

  it('refuses an expression it cannot honour', () => {
    expect(() => parseCron('0 9 * *')).toThrow(/5 fields/);
    expect(() => parseCron('99 9 * * *')).toThrow(/out of range/);
  });

  it('reports the latest missed occurrence, and only once', () => {
    const now = Date.parse('2026-07-22T10:07:30Z');
    const lastHour = Date.parse('2026-07-22T09:00:00Z');
    // Hourly schedule, last fired an hour ago: due at 10:00.
    expect(dueOccurrence('0 * * * *', 'UTC', lastHour, now)).toBe(
      Date.parse('2026-07-22T10:00:00Z'),
    );
    // Once stamped, the same scan minute is no longer due.
    expect(
      dueOccurrence(
        '0 * * * *',
        'UTC',
        Date.parse('2026-07-22T10:00:00Z'),
        now,
      ),
    ).toBeNull();
  });
});

describe('schedule triggers', () => {
  it('fires a due schedule once and stamps it', async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/nightly', {
      kind: 'schedule',
      cron: '* * * * *',
      timezone: 'UTC',
    });
    await backdate(t, 'ops/nightly', 5 * 60 * 1000);

    const first = await t.mutation(
      internal.automations.triggers.scanScheduledTriggers,
      {},
    );
    expect(first).toEqual({ examined: 1, fired: 1 });
    expect(await runsOf(t, ORG)).toHaveLength(1);

    // The same minute does not fire again — `lastFiredAt` is the guard.
    const second = await t.mutation(
      internal.automations.triggers.scanScheduledTriggers,
      {},
    );
    expect(second.fired).toBe(0);
    expect(await runsOf(t, ORG)).toHaveLength(1);
  });

  it('skips disabled schedules and survives one that cannot be parsed', async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/broken-cron', {
      kind: 'schedule',
      cron: 'not a cron',
    });
    await publish(t, OTHER_ORG, 'ops/nightly', {
      kind: 'schedule',
      cron: '* * * * *',
      timezone: 'UTC',
    });
    await publish(t, ORG, 'ops/off', {
      kind: 'schedule',
      cron: '* * * * *',
      enabled: false,
    });
    for (const name of ['ops/broken-cron', 'ops/nightly', 'ops/off']) {
      await backdate(t, name, 5 * 60 * 1000);
    }

    const result = await t.mutation(
      internal.automations.triggers.scanScheduledTriggers,
      {},
    );
    // The unusable expression is skipped; the healthy one in the OTHER org
    // still fires, and each run belongs to its own organization.
    expect(result.fired).toBe(1);
    expect(await runsOf(t, ORG)).toHaveLength(0);
    expect(await runsOf(t, OTHER_ORG)).toHaveLength(1);
  });
});

describe('webhook triggers', () => {
  const path = (token: string) => `/api/automations/webhook/${token}`;

  it('starts a run for a valid token', async () => {
    const t = newWorld();
    const token = mintWebhookToken();
    await publish(t, ORG, 'ops/inbound', {
      kind: 'webhook',
      tokenHash: await hashWebhookToken(token),
    });

    const response = await t.fetch(path(token), {
      method: 'POST',
      body: JSON.stringify({ ticket: 42 }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(202);

    const runs = await runsOf(t, ORG);
    expect(runs).toHaveLength(1);
    expect(runs[0].input).toEqual({
      trigger: 'webhook',
      payload: { ticket: 42 },
    });
    expect(runs[0].mode).toBe('live');
  });

  it('refuses a token that does not match, and starts nothing', async () => {
    const t = newWorld();
    const token = mintWebhookToken();
    await publish(t, ORG, 'ops/inbound', {
      kind: 'webhook',
      tokenHash: await hashWebhookToken(token),
    });

    const wrong = await t.fetch(path(mintWebhookToken()), {
      method: 'POST',
      body: '{}',
    });
    expect(wrong.status).toBe(404);

    // A near-miss of the real token is refused too — the stored value is a
    // hash, so a prefix tells an attacker nothing.
    const nearMiss = await t.fetch(path(`${token.slice(0, -1)}X`), {
      method: 'POST',
      body: '{}',
    });
    expect(nearMiss.status).toBe(404);
    expect(await runsOf(t, ORG)).toHaveLength(0);
  });

  it('refuses a disabled trigger with the same 404', async () => {
    const t = newWorld();
    const token = mintWebhookToken();
    await publish(t, ORG, 'ops/inbound', {
      kind: 'webhook',
      tokenHash: await hashWebhookToken(token),
      enabled: false,
    });

    const response = await t.fetch(path(token), { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
    expect(await runsOf(t, ORG)).toHaveLength(0);
  });

  it('never stores the plaintext token', async () => {
    const t = newWorld();
    const token = mintWebhookToken();
    await publish(t, ORG, 'ops/inbound', {
      kind: 'webhook',
      tokenHash: await hashWebhookToken(token),
    });
    const rows = await t.run(
      async (ctx) => await ctx.db.query('workflowTriggers').collect(),
    );
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('event triggers — loop safety', () => {
  it('starts the listening automations of one organization', async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/on-ticket', {
      kind: 'event',
      event: 'ticket.created',
    });
    await publish(t, OTHER_ORG, 'ops/on-ticket', {
      kind: 'event',
      event: 'ticket.created',
    });

    const result = await t.mutation(
      internal.automations.triggers.dispatchAutomationEvent,
      {
        organizationId: ORG,
        event: 'ticket.created',
        payload: { id: 7 },
        origin: 'platform',
      },
    );
    expect(result.started).toHaveLength(1);
    expect(result.refused).toBe(false);
    // The other organization's listener is untouched by this organization's
    // event.
    expect(await runsOf(t, OTHER_ORG)).toHaveLength(0);
  });

  it("refuses an event raised by a workflow's own writes", async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/on-ticket', {
      kind: 'event',
      event: 'ticket.created',
    });

    const result = await t.mutation(
      internal.automations.triggers.dispatchAutomationEvent,
      {
        organizationId: ORG,
        event: 'ticket.created',
        payload: { id: 7 },
        origin: 'workflow',
      },
    );
    // This is THE loop-safety invariant: a run's own writes cannot start runs,
    // so an automation cannot trigger itself however its output is stored.
    expect(result).toEqual({ started: [], refused: true });
    expect(await runsOf(t, ORG)).toHaveLength(0);
  });

  it('ignores an event no trigger listens for', async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/on-ticket', {
      kind: 'event',
      event: 'ticket.created',
    });
    const result = await t.mutation(
      internal.automations.triggers.dispatchAutomationEvent,
      {
        organizationId: ORG,
        event: 'ticket.closed',
        origin: 'platform',
      },
    );
    expect(result.started).toEqual([]);
    expect(await runsOf(t, ORG)).toHaveLength(0);
  });
});

describe('api-key triggers', () => {
  it('runs only an automation the organization exposed', async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/callable', { kind: 'api-key' });
    await publish(t, ORG, 'ops/internal-only');

    const allowed = await t.mutation(
      internal.automations.triggers.fireApiKeyTrigger,
      {
        organizationId: ORG,
        name: 'ops/callable',
        input: { from: 'api' },
        callerRef: 'key_1',
      },
    );
    expect(allowed?.version).toBe(1);

    const refused = await t.mutation(
      internal.automations.triggers.fireApiKeyTrigger,
      {
        organizationId: ORG,
        name: 'ops/internal-only',
        callerRef: 'key_1',
      },
    );
    expect(refused).toBeNull();

    // A key for one organization cannot reach another organization's
    // automation, even by name.
    const crossOrg = await t.mutation(
      internal.automations.triggers.fireApiKeyTrigger,
      {
        organizationId: OTHER_ORG,
        name: 'ops/callable',
        callerRef: 'key_1',
      },
    );
    expect(crossOrg).toBeNull();
    expect(await runsOf(t, ORG)).toHaveLength(1);
    expect(await runsOf(t, OTHER_ORG)).toHaveLength(0);
  });
});

describe('run recovery', () => {
  it('re-enters a run left running with no continuation', async () => {
    const t = newWorld();
    await publish(t, ORG, 'ops/nightly');
    const stale = Date.now() - 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert('workflowRuns', {
        organizationId: ORG,
        name: 'ops/nightly',
        version: 1,
        status: 'running',
        mode: 'mock',
        startedBy: 'user:test',
        input: {},
        checkpoints: { nodes: {}, executions: 0 },
        startedAt: stale,
      });
      await ctx.db.insert('workflowRuns', {
        organizationId: ORG,
        name: 'ops/nightly',
        version: 1,
        status: 'running',
        mode: 'mock',
        startedBy: 'user:test',
        input: {},
        checkpoints: { nodes: {}, executions: 0 },
        // Started just now: a healthy run mid-step must not be disturbed.
        startedAt: Date.now(),
      });
    });

    const result = await t.mutation(
      internal.automations.triggers.recoverStuckRuns,
      {},
    );
    expect(result).toEqual({ resumed: 1 });
  });
});

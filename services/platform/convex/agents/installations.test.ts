import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { assertAgentAssigneeLive } from './installations';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/agents/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'agents';
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

const APP_AGENTS_ORG = 'org_appagents';
type T = TestConvex<typeof schema>;

function rowFor(t: T, agentSlug: string) {
  return t.run((ctx) =>
    ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', APP_AGENTS_ORG).eq('agentSlug', agentSlug),
      )
      .first(),
  );
}

// App agents are stamped with their owning app at install (the canonical
// ownership signal used by the global marker + delete/disable guards). Global
// agents leave `automationSlug` unset. Exercises the internal install/delete mutations
// directly (no auth) — the public, auth-gated roster guards are verified live.
describe('agent installations — app ownership stamp', () => {
  it('stamps automationSlug + enabled, survives re-install, and is cleared by delete', async () => {
    const t = convexTest(schema, modules);
    const SLUG = 'issue-desk/desk-implementer';

    await t.mutation(internal.agents.installations.upsertInstallation, {
      organizationId: APP_AGENTS_ORG,
      agentSlug: SLUG,
      installedBy: 'system',
      contentHash: 'h1',
      enabled: true,
      automationSlug: 'issue-desk',
    });
    let row = await rowFor(t, SLUG);
    expect(row?.automationSlug).toBe('issue-desk');
    expect(row?.enabled).toBe(true);
    // App ownership and the integration-cascade key are orthogonal.
    expect(row?.bundledBy).toBeUndefined();

    // Re-install (the patch path) re-stamps content but keeps the owner.
    await t.mutation(internal.agents.installations.upsertInstallation, {
      organizationId: APP_AGENTS_ORG,
      agentSlug: SLUG,
      installedBy: 'system',
      contentHash: 'h2',
      enabled: true,
      automationSlug: 'issue-desk',
    });
    row = await rowFor(t, SLUG);
    expect(row?.automationSlug).toBe('issue-desk');
    expect(row?.contentHash).toBe('h2');

    // A global agent install carries no owner.
    await t.mutation(internal.agents.installations.upsertInstallation, {
      organizationId: APP_AGENTS_ORG,
      agentSlug: 'global-helper',
      installedBy: 'system',
      contentHash: 'g1',
    });
    expect((await rowFor(t, 'global-helper'))?.automationSlug).toBeUndefined();

    // App uninstall deregisters the app agent's row.
    await t.mutation(internal.agents.installations.deleteInstallation, {
      organizationId: APP_AGENTS_ORG,
      agentSlug: SLUG,
    });
    expect(await rowFor(t, SLUG)).toBeNull();
  });
});

// The run-admission gate (`isAgentLiveInternal`) is anchored SOLELY on the
// `agentInstallations` rows: an agent is live IFF it has an enabled row. There
// is no provision-ledger fail-open — a row-less org has no live agents (every
// org is provisioned at create with the default agents). `agentDefaultProvisions`
// now only feeds `listInstallStatesInternal`'s `provisioned` flag.
describe('agent liveness gate — installed && enabled, no fail-open', () => {
  const GORG = 'org_livegate';

  function seedProvision(t: T, agentSlug: string) {
    return t.run((ctx) =>
      ctx.db.insert('agentDefaultProvisions', {
        organizationId: GORG,
        agentSlug,
        contentHash: 'h',
        provisionedAt: 0,
      }),
    );
  }
  function seedInstall(
    t: T,
    agentSlug: string,
    enabled: boolean,
    automationSlug?: string,
  ) {
    return t.run((ctx) =>
      ctx.db.insert('agentInstallations', {
        organizationId: GORG,
        agentSlug,
        installedAt: 0,
        installedBy: 'system',
        contentHash: 'h',
        enabled,
        ...(automationSlug !== undefined ? { automationSlug } : {}),
      }),
    );
  }
  const live = (t: T, agentSlug: string): Promise<boolean> =>
    t.query(internal.agents.installations.isAgentLiveInternal, {
      organizationId: GORG,
      agentSlug,
    });

  it('T1 — no install row: NOT live (no fail-open), even for a never-provisioned org', async () => {
    const t = convexTest(schema, modules);
    expect(await live(t, 'anything')).toBe(false);
  });

  it('T2 — enabled install row is live; a row-less agent is not', async () => {
    const t = convexTest(schema, modules);
    await seedInstall(t, 'a', true);
    expect(await live(t, 'a')).toBe(true);
    expect(await live(t, 'b')).toBe(false);
    expect(await live(t, 'unknown')).toBe(false);
  });

  it('T3 — disabled install row: NOT live', async () => {
    const t = convexTest(schema, modules);
    await seedInstall(t, 'a', false);
    expect(await live(t, 'a')).toBe(false);
  });

  it('T4 — an app-scoped enabled row is live like any other install row', async () => {
    const t = convexTest(schema, modules);
    await seedInstall(t, 'issue-desk/desk-implementer', true, 'issue-desk');
    expect(await live(t, 'issue-desk/desk-implementer')).toBe(true);
    // A row-less global is still not live — install rows are the only signal.
    expect(await live(t, 'global-rowless')).toBe(false);
  });

  it('T5 — listInstallStatesInternal returns { states, provisioned }', async () => {
    const t = convexTest(schema, modules);
    const before = await t.query(
      internal.agents.installations.listInstallStatesInternal,
      { organizationId: GORG },
    );
    expect(before.provisioned).toBe(false);
    expect(before.states).toEqual([]);

    await seedProvision(t, 'a');
    await seedInstall(t, 'a', true);
    const after = await t.query(
      internal.agents.installations.listInstallStatesInternal,
      { organizationId: GORG },
    );
    expect(after.provisioned).toBe(true);
    expect(after.states.map((s) => s.agentSlug)).toEqual(['a']);
  });

  it('T7 — sweep sentinel alone marks the org provisioned (listInstallStates flag)', async () => {
    const t = convexTest(schema, modules);
    await seedProvision(t, '__sweep__'); // only the sentinel, no real agents
    // The provision ledger no longer gates liveness; it only sets the
    // `provisioned` flag the roster/install-state reads expose.
    const states = await t.query(
      internal.agents.installations.listInstallStatesInternal,
      { organizationId: GORG },
    );
    expect(states.provisioned).toBe(true);
    expect(states.states).toEqual([]);
  });
});

describe('assertAgentAssigneeLive', () => {
  const ORG = 'org_assignee_gate';

  function seedInstall(t: TestConvex<typeof schema>, agentSlug: string) {
    return t.run((ctx) =>
      ctx.db.insert('agentInstallations', {
        organizationId: ORG,
        agentSlug,
        installedAt: 0,
        installedBy: 'user',
        contentHash: 'h',
        enabled: true,
      }),
    );
  }

  it('passes for user assignees and null', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await assertAgentAssigneeLive(ctx, ORG, null);
      await assertAgentAssigneeLive(ctx, ORG, {
        assigneeType: 'user',
        assigneeId: 'user-1',
      });
    });
  });

  it('throws AGENT_NOT_LIVE when the agent has no install row', async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.run(async (ctx) => {
        await assertAgentAssigneeLive(ctx, ORG, {
          assigneeType: 'agent',
          assigneeId: 'software-developer',
        });
      }),
    ).rejects.toThrow(/AGENT_NOT_LIVE|not installed or is disabled/);
  });

  it('throws AGENT_NOT_LIVE when the install row is disabled', async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert('agentInstallations', {
        organizationId: ORG,
        agentSlug: 'dev',
        installedAt: 0,
        installedBy: 'user',
        contentHash: 'h',
        enabled: false,
      }),
    );
    await expect(
      t.run(async (ctx) => {
        await assertAgentAssigneeLive(ctx, ORG, {
          assigneeType: 'agent',
          assigneeId: 'dev',
        });
      }),
    ).rejects.toThrow(/AGENT_NOT_LIVE|not installed or is disabled/);
  });

  it('passes when the agent is installed and enabled', async () => {
    const t = convexTest(schema, modules);
    await seedInstall(t, 'software-developer');
    await t.run(async (ctx) => {
      await assertAgentAssigneeLive(ctx, ORG, {
        assigneeType: 'agent',
        assigneeId: 'software-developer',
      });
    });
  });
});

describe('getEnabledAgentSlugsInternal', () => {
  const ORG = 'org_enabled_slugs';

  it('returns only enabled install rows', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('agentInstallations', {
        organizationId: ORG,
        agentSlug: 'live',
        installedAt: 0,
        installedBy: 'user',
        contentHash: 'h',
        enabled: true,
      });
      await ctx.db.insert('agentInstallations', {
        organizationId: ORG,
        agentSlug: 'off',
        installedAt: 0,
        installedBy: 'user',
        contentHash: 'h',
        enabled: false,
      });
    });
    const slugs = await t.query(
      internal.agents.installations.getEnabledAgentSlugsInternal,
      { organizationId: ORG },
    );
    expect(slugs).toEqual(['live']);
  });
});

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

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

const ORG = 'org_appagents';
type T = TestConvex<typeof schema>;

function rowFor(t: T, agentSlug: string) {
  return t.run((ctx) =>
    ctx.db
      .query('agentInstallations')
      .withIndex('by_org_slug', (q) =>
        q.eq('organizationId', ORG).eq('agentSlug', agentSlug),
      )
      .first(),
  );
}

// App agents are stamped with their owning app at install (the canonical
// ownership signal used by the global marker + delete/disable guards). Global
// agents leave `appSlug` unset. Exercises the internal install/delete mutations
// directly (no auth) — the public, auth-gated roster guards are verified live.
describe('agent installations — app ownership stamp', () => {
  it('stamps appSlug + enabled, survives re-install, and is cleared by delete', async () => {
    const t = convexTest(schema, modules);
    const SLUG = 'issue-desk/desk-implementer';

    await t.mutation(internal.agents.installations.upsertInstallation, {
      organizationId: ORG,
      agentSlug: SLUG,
      installedBy: 'system',
      contentHash: 'h1',
      enabled: true,
      appSlug: 'issue-desk',
    });
    let row = await rowFor(t, SLUG);
    expect(row?.appSlug).toBe('issue-desk');
    expect(row?.enabled).toBe(true);
    // App ownership and the integration-cascade key are orthogonal.
    expect(row?.bundledBy).toBeUndefined();

    // Re-install (the patch path) re-stamps content but keeps the owner.
    await t.mutation(internal.agents.installations.upsertInstallation, {
      organizationId: ORG,
      agentSlug: SLUG,
      installedBy: 'system',
      contentHash: 'h2',
      enabled: true,
      appSlug: 'issue-desk',
    });
    row = await rowFor(t, SLUG);
    expect(row?.appSlug).toBe('issue-desk');
    expect(row?.contentHash).toBe('h2');

    // A global agent install carries no owner.
    await t.mutation(internal.agents.installations.upsertInstallation, {
      organizationId: ORG,
      agentSlug: 'global-helper',
      installedBy: 'system',
      contentHash: 'g1',
    });
    expect((await rowFor(t, 'global-helper'))?.appSlug).toBeUndefined();

    // App uninstall deregisters the app agent's row.
    await t.mutation(internal.agents.installations.deleteInstallation, {
      organizationId: ORG,
      agentSlug: SLUG,
    });
    expect(await rowFor(t, SLUG)).toBeNull();
  });
});

// The run-admission gate (`isAgentLiveInternal`) anchors its fail-open on the
// durable provision ledger (`agentDefaultProvisions`), NOT the count of
// `agentInstallations` rows: fall open only for a never-provisioned org; once
// the autoInstall sweep has run, be authoritative. This fixes two defects of
// the old count-based fallback — resurrecting a deliberately-emptied org, and an
// app install flipping a never-provisioned org's fallback off.
describe('agent liveness gate — anchored on the provision ledger', () => {
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
    appSlug?: string,
  ) {
    return t.run((ctx) =>
      ctx.db.insert('agentInstallations', {
        organizationId: GORG,
        agentSlug,
        installedAt: 0,
        installedBy: 'system',
        contentHash: 'h',
        enabled,
        ...(appSlug !== undefined ? { appSlug } : {}),
      }),
    );
  }
  const live = (t: T, agentSlug: string): Promise<boolean> =>
    t.query(internal.agents.installations.isAgentLiveInternal, {
      organizationId: GORG,
      agentSlug,
    });

  it('T1 — never-provisioned org: every agent is live (fail-open)', async () => {
    const t = convexTest(schema, modules);
    expect(await live(t, 'anything')).toBe(true);
  });

  it('T2 — provisioned org: authoritative (enabled row live, row-less not)', async () => {
    const t = convexTest(schema, modules);
    await seedProvision(t, 'a');
    await seedInstall(t, 'a', true);
    await seedProvision(t, 'b'); // provisioned but no install row
    expect(await live(t, 'a')).toBe(true);
    expect(await live(t, 'b')).toBe(false);
    expect(await live(t, 'unknown')).toBe(false);
  });

  it('T3 — provisioned-then-emptied: row-less agent NOT live (no resurrection)', async () => {
    const t = convexTest(schema, modules);
    await seedProvision(t, 'a'); // provisioned once...
    // ...then all install rows removed (none seeded).
    expect(await live(t, 'a')).toBe(false);
  });

  it('T4/T6 — app install never changes the provision-anchored fallback', async () => {
    // Provisioned org: a row-less global stays authoritative despite an app row.
    const provisioned = convexTest(schema, modules);
    await seedProvision(provisioned, 'g');
    await seedInstall(
      provisioned,
      'issue-desk/desk-implementer',
      true,
      'issue-desk',
    );
    expect(await live(provisioned, 'global-rowless')).toBe(false);

    // Never-provisioned org: installing an app (adds install rows, no provision
    // rows) keeps the org fail-open — the row-less global is still live.
    const fresh = convexTest(schema, modules);
    await fresh.run((ctx) =>
      ctx.db.insert('agentInstallations', {
        organizationId: GORG,
        agentSlug: 'issue-desk/desk-implementer',
        installedAt: 0,
        installedBy: 'system',
        contentHash: 'h',
        enabled: true,
        appSlug: 'issue-desk',
      }),
    );
    expect(
      await fresh.query(internal.agents.installations.isAgentLiveInternal, {
        organizationId: GORG,
        agentSlug: 'global-rowless',
      }),
    ).toBe(true);
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

  it('T7 — sweep sentinel alone marks the org provisioned', async () => {
    const t = convexTest(schema, modules);
    await seedProvision(t, '__sweep__'); // only the sentinel, no real agents
    // Provisioned ⇒ authoritative ⇒ a row-less agent is not live.
    expect(await live(t, 'global-rowless')).toBe(false);
  });
});

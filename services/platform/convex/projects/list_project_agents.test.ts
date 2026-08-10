// Read-side coverage for `listProjectAgents` — the one query behind the
// project Agents tab, the task assignee picker, and actor-directory name
// resolution. Locks the regression where a row written by a retired feature
// build (vestigial `autonomyTier`, kept optional in the schema for rolling
// upgrades) failed the strict returns validator and blanked the whole list.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/projects/), mirroring accessible_members.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'projects';
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

const ORG = 'org_agent_list';
const MEMBER = 'u_member';

type T = TestConvex<typeof schema>;

/** Seed an org member and an org-wide project; return the project id. */
async function seedWorld(t: T): Promise<Id<'projects'>> {
  return t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${MEMBER}_${ORG}`,
      userId: MEMBER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
    return ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Project',
      createdBy: 'u_creator',
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

function agentRow(
  projectId: Id<'projects'>,
  name: string,
  extra: Record<string, unknown> = {},
) {
  return {
    organizationId: ORG,
    projectId,
    name,
    harness: 'claude-code',
    model: 'claude-sonnet-5',
    skills: [],
    connectors: [],
    createdBy: 'u_creator',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  };
}

function listAsMember(t: T, projectId: Id<'projects'>) {
  return t
    .withIdentity({ subject: MEMBER })
    .query(api.projects.queries.listProjectAgents, {
      projectId,
      organizationId: ORG,
    });
}

describe('listProjectAgents', () => {
  it('lists the project agents name-sorted', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('projectAgents', agentRow(projectId, 'Mike'));
      await ctx.db.insert('projectAgents', agentRow(projectId, 'Alice'));
    });

    const rows = await listAsMember(t, projectId);
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Mike']);
  });

  it('still lists every agent when a row carries a vestigial autonomyTier', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('projectAgents', agentRow(projectId, 'Alice'));
      await ctx.db.insert(
        'projectAgents',
        agentRow(projectId, 'Legacy tiered', { autonomyTier: 'a2' }),
      );
      await ctx.db.insert('projectAgents', agentRow(projectId, 'Mike'));
    });

    const rows = await listAsMember(t, projectId);
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Legacy tiered', 'Mike']);
    // The vestige never leaves the db layer.
    expect(rows.some((r) => 'autonomyTier' in r)).toBe(false);
  });
});

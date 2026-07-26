import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { assertAgentAssigneeLive } from '../agents/installations';
import schema from '../schema';
import { getProjectAccessibleUserIds } from './accessible_members';
import {
  assertAgentAssigneeInProject,
  assertHumanAssigneeAccess,
} from './resolve_project_access';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/projects/), mirroring queries.test.ts.
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

const ORG = 'org_access';
const OTHER_ORG = 'org_other';
const TEAM_A = 'team_a';
const TEAM_B = 'team_b';

const ADMIN = 'u_admin';
const MEMBER_A = 'u_member_a';
const MEMBER_B = 'u_member_b';
const OUTSIDER = 'u_outsider';
const DISABLED_A = 'u_disabled_a';
const BOTH_TEAMS = 'u_both';

type T = TestConvex<typeof schema>;

function dataOf(err: unknown): Record<string, unknown> | undefined {
  if (err === null || typeof err !== 'object' || !('data' in err))
    return undefined;
  let data: unknown = (err as { data: unknown }).data;
  for (let i = 0; i < 3 && typeof data === 'string'; i++) {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)
    : undefined;
}
function codeOf(err: unknown): string | undefined {
  const c = dataOf(err)?.code;
  return typeof c === 'string' ? c : undefined;
}
async function catchCode(
  fn: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await fn();
  } catch (err) {
    return codeOf(err);
  }
  return undefined;
}

async function seedMember(
  t: T,
  userId: string,
  role = 'member',
  organizationId = ORG,
): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    }),
  );
}

async function seedTeam(t: T, userId: string, teamId: string): Promise<void> {
  await t.run((ctx) =>
    ctx.db.insert('teamMemberMirror', {
      teamMemberId: `tm_${userId}_${teamId}`,
      userId,
      teamId,
      createdAt: 0,
    }),
  );
}

async function seedProject(
  t: T,
  args: {
    organizationId?: string;
    teamId?: string;
    sharedWithTeamIds?: string[];
  } = {},
): Promise<Id<'projects'>> {
  return t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: args.organizationId ?? ORG,
      name: 'Project',
      teamId: args.teamId,
      sharedWithTeamIds: args.sharedWithTeamIds,
      createdBy: 'u_creator',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function getProjectDoc(
  t: T,
  projectId: Id<'projects'>,
): Promise<Doc<'projects'>> {
  return t.run(async (ctx) => {
    const p = await ctx.db.get(projectId);
    if (!p) throw new Error('project missing');
    return p;
  });
}

/** Seed the standard org roster used by most cases. */
async function seedRoster(t: T): Promise<void> {
  await seedMember(t, ADMIN, 'admin');
  await seedMember(t, MEMBER_A);
  await seedMember(t, MEMBER_B);
  await seedMember(t, OUTSIDER);
  await seedMember(t, DISABLED_A, 'disabled');
  await seedTeam(t, MEMBER_A, TEAM_A);
  await seedTeam(t, MEMBER_B, TEAM_B);
  await seedTeam(t, DISABLED_A, TEAM_A);
}

/**
 * Run the helper in a txn, returning a Convex-serializable value — a `Set`
 * cannot cross the `t.run` boundary. `null` = org-wide.
 */
function accessibleIds(
  t: T,
  projectId: Id<'projects'>,
): Promise<string[] | null> {
  return t.run(async (ctx) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error('project missing');
    const set = await getProjectAccessibleUserIds(ctx, project);
    return set === null ? null : [...set];
  });
}

describe('getProjectAccessibleUserIds', () => {
  it('returns null for an org-wide project (no team restriction)', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t); // no teamId → org-wide
    expect(await accessibleIds(t, projectId)).toBeNull();
  });

  it('returns team members ∪ admins, excluding disabled and other teams', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, { teamId: TEAM_A });

    const ids = await accessibleIds(t, projectId);
    expect(ids).not.toBeNull();
    expect([...(ids ?? [])].sort()).toEqual([ADMIN, MEMBER_A].sort());
    // Disabled team member, other-team member, and teamless member are absent.
    expect(ids).not.toContain(DISABLED_A);
    expect(ids).not.toContain(MEMBER_B);
    expect(ids).not.toContain(OUTSIDER);
  });

  it('de-dupes a user who is on both the owning and a shared team', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    await seedMember(t, BOTH_TEAMS);
    await seedTeam(t, BOTH_TEAMS, TEAM_A);
    await seedTeam(t, BOTH_TEAMS, TEAM_B);
    const projectId = await seedProject(t, {
      teamId: TEAM_A,
      sharedWithTeamIds: [TEAM_B],
    });

    const ids = (await accessibleIds(t, projectId)) ?? [];
    expect(ids.filter((id) => id === BOTH_TEAMS)).toHaveLength(1);
    expect([...ids].sort()).toEqual(
      [ADMIN, MEMBER_A, MEMBER_B, BOTH_TEAMS].sort(),
    );
  });

  it('excludes a stale team-mirror row for a user no longer in the org', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ADMIN, 'admin');
    await seedTeam(t, 'u_ghost', TEAM_A); // team row but no memberMirror
    const projectId = await seedProject(t, { teamId: TEAM_A });

    const ids = await accessibleIds(t, projectId);
    expect(ids).not.toContain('u_ghost');
    expect(ids).toEqual([ADMIN]);
  });
});

describe('listAccessibleUserIds query', () => {
  it('returns the accessible set for a team member calling on a team project', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, { teamId: TEAM_A });

    const res = await t
      .withIdentity({ subject: MEMBER_A })
      .query(api.projects.queries.listAccessibleUserIds, {
        organizationId: ORG,
        projectId,
      });
    expect(res.orgWide).toBe(false);
    expect([...res.userIds].sort()).toEqual([ADMIN, MEMBER_A].sort());
  });

  it('flags org-wide projects so the client shows every member', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t); // org-wide

    const res = await t
      .withIdentity({ subject: MEMBER_A })
      .query(api.projects.queries.listAccessibleUserIds, {
        organizationId: ORG,
        projectId,
      });
    expect(res).toEqual({ orgWide: true, userIds: [] });
  });

  it('fails closed to empty when the caller cannot read the project', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, { teamId: TEAM_A });

    // OUTSIDER is an org member but on no team → no access to the team project.
    const res = await t
      .withIdentity({ subject: OUTSIDER })
      .query(api.projects.queries.listAccessibleUserIds, {
        organizationId: ORG,
        projectId,
      });
    expect(res).toEqual({ orgWide: false, userIds: [] });
  });

  it('fails closed for a project outside the active org', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, {
      organizationId: OTHER_ORG,
      teamId: TEAM_A,
    });

    const res = await t
      .withIdentity({ subject: MEMBER_A })
      .query(api.projects.queries.listAccessibleUserIds, {
        organizationId: ORG,
        projectId,
      });
    expect(res).toEqual({ orgWide: false, userIds: [] });
  });
});

describe('assertHumanAssigneeAccess', () => {
  it('allows self-assignment regardless of team access', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, { teamId: TEAM_A });
    const project = await getProjectDoc(t, projectId);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertHumanAssigneeAccess(ctx, {
          project,
          organizationId: ORG,
          assigneeId: OUTSIDER,
          callerId: OUTSIDER,
        }),
      ),
    );
    expect(code).toBeUndefined();
  });

  it('allows an assignee on the project team', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, { teamId: TEAM_A });
    const project = await getProjectDoc(t, projectId);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertHumanAssigneeAccess(ctx, {
          project,
          organizationId: ORG,
          assigneeId: MEMBER_A,
          callerId: ADMIN,
        }),
      ),
    );
    expect(code).toBeUndefined();
  });

  it('rejects an assignee outside the project team', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t, { teamId: TEAM_A });
    const project = await getProjectDoc(t, projectId);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertHumanAssigneeAccess(ctx, {
          project,
          organizationId: ORG,
          assigneeId: MEMBER_B,
          callerId: ADMIN,
        }),
      ),
    );
    expect(code).toBe('ASSIGNEE_NO_PROJECT_ACCESS');
  });

  it('allows any member on an org-wide project', async () => {
    const t = convexTest(schema, modules);
    await seedRoster(t);
    const projectId = await seedProject(t); // org-wide
    const project = await getProjectDoc(t, projectId);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertHumanAssigneeAccess(ctx, {
          project,
          organizationId: ORG,
          assigneeId: OUTSIDER,
          callerId: ADMIN,
        }),
      ),
    );
    expect(code).toBeUndefined();
  });
});

async function seedProjectAgent(
  t: T,
  projectId: Id<'projects'>,
  organizationId = ORG,
): Promise<Id<'projectAgents'>> {
  return t.run((ctx) =>
    ctx.db.insert('projectAgents', {
      organizationId,
      projectId,
      name: 'Scout',
      harness: 'claude-code',
      skills: [],
      connectors: [],
      createdBy: 'u_creator',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

describe('assertAgentAssigneeInProject', () => {
  it("permits the project's own agent", async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);
    const agentId = await seedProjectAgent(t, projectId);

    const code = await catchCode(() =>
      t.run((ctx) => assertAgentAssigneeInProject(ctx, projectId, agentId)),
    );
    expect(code).toBeUndefined();
  });

  it("rejects another project's agent", async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);
    const otherProjectId = await seedProject(t);
    const foreignAgentId = await seedProjectAgent(t, otherProjectId);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertAgentAssigneeInProject(ctx, projectId, foreignAgentId),
      ),
    );
    expect(code).toBe('AGENT_NOT_ALLOWED_IN_PROJECT');
  });

  it('rejects an id that is not a project agent at all', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertAgentAssigneeInProject(ctx, projectId, 'legacy-slug'),
      ),
    );
    expect(code).toBe('AGENT_NOT_ALLOWED_IN_PROJECT');
  });
});

describe('assertAgentAssigneeLive', () => {
  const AGENT_ASSIGNEE = (id: string) =>
    ({ assigneeType: 'agent', assigneeId: id }) as const;

  it('permits an existing agent of the organization', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);
    const agentId = await seedProjectAgent(t, projectId);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertAgentAssigneeLive(ctx, ORG, AGENT_ASSIGNEE(agentId)),
      ),
    );
    expect(code).toBeUndefined();
  });

  it("rejects another organization's agent", async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, { organizationId: OTHER_ORG });
    const agentId = await seedProjectAgent(t, projectId, OTHER_ORG);

    const code = await catchCode(() =>
      t.run((ctx) =>
        assertAgentAssigneeLive(ctx, ORG, AGENT_ASSIGNEE(agentId)),
      ),
    );
    expect(code).toBe('AGENT_NOT_LIVE');
  });

  it('rejects a missing agent and passes non-agent assignees through', async () => {
    const t = convexTest(schema, modules);

    const missing = await catchCode(() =>
      t.run((ctx) =>
        assertAgentAssigneeLive(ctx, ORG, AGENT_ASSIGNEE('gone-slug')),
      ),
    );
    expect(missing).toBe('AGENT_NOT_LIVE');

    const human = await catchCode(() =>
      t.run((ctx) =>
        assertAgentAssigneeLive(ctx, ORG, {
          assigneeType: 'user',
          assigneeId: 'u_member_a',
        }),
      ),
    );
    expect(human).toBeUndefined();
  });
});

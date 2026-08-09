// The workspace bridge's access gate must answer exactly like a user-side
// RLS read: membership from the memberMirror fast path (disabled dropped),
// role checked against the one role→table→action matrix. Only mirror-HIT
// paths are exercised — a mirror miss falls back to the Better Auth
// component, which convex-test does not host (same stance as
// members/member_mirror.test.ts).

import { convexTest } from 'convex-test';
import { defineSchema } from 'convex/server';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import { automationRunsTable } from '../automations/schema';
import { resolveAgentReadAccess } from '../lib/rls/helpers/agent_read_access';
import { memberMirrorTable, teamMemberMirrorTable } from '../members/schema';
import { buildModules } from '../migrations/framework/test_helpers';
import { projectAgentsTable, projectsTable } from '../projects/schema';
import { sandboxSessionsTable } from './sessions_schema';

const schema = defineSchema({
  memberMirror: memberMirrorTable,
  teamMemberMirror: teamMemberMirrorTable,
  sandboxSessions: sandboxSessionsTable,
  automationRuns: automationRunsTable,
  projects: projectsTable,
  projectAgents: projectAgentsTable,
});
const modules = buildModules(import.meta.glob('../**/*.*s'), 'sandbox');

const ORG = 'org_A';

function newTest() {
  return convexTest(schema, modules);
}

async function seedMember(
  t: ReturnType<typeof newTest>,
  args: { userId: string; organizationId: string; role: string },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `mm_${args.userId}_${args.organizationId}`,
      userId: args.userId,
      organizationId: args.organizationId,
      role: args.role,
      createdAt: 1,
    });
  });
}

describe('resolveAgentReadAccess', () => {
  it('an active member reads every workspace subject', async () => {
    const t = newTest();
    await seedMember(t, { userId: 'u1', organizationId: ORG, role: 'member' });
    for (const subject of [
      'documents',
      'contacts',
      'products',
      'websites',
    ] as const) {
      const access = await t.run((ctx) =>
        resolveAgentReadAccess(ctx, {
          userId: 'u1',
          organizationId: ORG,
          subject,
        }),
      );
      expect(access).toEqual({ allowed: true, role: 'member' });
    }
  });

  it('owner normalizes like the RLS path (admin matrix row)', async () => {
    const t = newTest();
    await seedMember(t, { userId: 'u2', organizationId: ORG, role: 'owner' });
    const access = await t.run((ctx) =>
      resolveAgentReadAccess(ctx, {
        userId: 'u2',
        organizationId: ORG,
        subject: 'contacts',
      }),
    );
    expect(access).toEqual({ allowed: true, role: 'owner' });
  });

  it('a disabled membership is not a membership', async () => {
    const t = newTest();
    await seedMember(t, {
      userId: 'u3',
      organizationId: ORG,
      role: 'disabled',
    });
    const access = await t.run((ctx) =>
      resolveAgentReadAccess(ctx, {
        userId: 'u3',
        organizationId: ORG,
        subject: 'documents',
      }),
    );
    expect(access).toEqual({ allowed: false, reason: 'not_a_member' });
  });

  it("membership in another org never reaches this org's data", async () => {
    const t = newTest();
    await seedMember(t, {
      userId: 'u4',
      organizationId: 'org_B',
      role: 'admin',
    });
    const access = await t.run((ctx) =>
      resolveAgentReadAccess(ctx, {
        userId: 'u4',
        organizationId: ORG,
        subject: 'products',
      }),
    );
    expect(access).toEqual({ allowed: false, reason: 'not_a_member' });
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspaceKnowledgeScope — the retrieval visibility of one dispatch,
// derived from what the SESSION proves (never the request).
// ---------------------------------------------------------------------------

async function seedProject(
  t: ReturnType<typeof newTest>,
  args: { teamId?: string; sharedWithTeamIds?: string[] },
): Promise<string> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Filing desk',
        ...(args.teamId !== undefined ? { teamId: args.teamId } : {}),
        ...(args.sharedWithTeamIds !== undefined
          ? { sharedWithTeamIds: args.sharedWithTeamIds }
          : {}),
        createdBy: 'user_seed',
        createdAt: 1,
        updatedAt: 1,
      }),
  );
}

async function seedSession(
  t: ReturnType<typeof newTest>,
  args: { sessionId: string; ownerType: string; ownerId: string },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('sandboxSessions', {
      organizationId: ORG,
      sessionId: args.sessionId,
      profile: 'agent',
      status: 'active',
      ownerType: args.ownerType,
      ownerId: args.ownerId,
      createdBy: 'system',
      createdAt: 1,
      expiresAt: 2_000_000_000_000,
    });
  });
}

describe('resolveWorkspaceKnowledgeScope', () => {
  it("a project agent's session sees its project, the project's teams, and the hub", async () => {
    const t = newTest();
    const projectId = await seedProject(t, {
      teamId: 'team-x',
      sharedWithTeamIds: ['team-y'],
    });
    const agentId = await t.run(
      async (ctx) =>
        await ctx.db.insert('projectAgents', {
          organizationId: ORG,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeded projects row id
          projectId: projectId as never,
          name: 'Filer',
          harness: 'claude-code',
          skills: [],
          connectors: [],
          createdBy: 'user_seed',
          createdAt: 1,
          updatedAt: 1,
        }),
    );
    await seedSession(t, {
      sessionId: 'sess_pa',
      ownerType: 'project_agent',
      ownerId: agentId,
    });
    const scope = await t.query(
      internal.sandbox.workspace_access.resolveWorkspaceKnowledgeScope,
      { organizationId: ORG, sessionId: 'sess_pa' },
    );
    expect(scope).toEqual({
      teamIds: ['team-x', 'team-y'],
      projectIds: [projectId],
      includeHub: true,
    });
  });

  it("an automation run's session sees the run's project", async () => {
    const t = newTest();
    const projectId = await seedProject(t, { teamId: 'team-x' });
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert('automationRuns', {
          organizationId: ORG,
          name: 'filing-desk',
          version: 1,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeded projects row id
          projectId: projectId as never,
          status: 'running',
          mode: 'live',
          startedBy: 'user_seed',
          input: {},
          startedAt: 1,
        }),
    );
    await seedSession(t, {
      sessionId: 'sess_wf',
      ownerType: 'workflow_run',
      // The owner key format the session naming module writes.
      ownerId: `${runId}:@workflow`,
    });
    const scope = await t.query(
      internal.sandbox.workspace_access.resolveWorkspaceKnowledgeScope,
      { organizationId: ORG, sessionId: 'sess_wf' },
    );
    expect(scope).toEqual({
      teamIds: ['team-x'],
      projectIds: [projectId],
      includeHub: true,
    });
  });

  it("a user-keyed session falls back to the USER's own visibility", async () => {
    const t = newTest();
    await seedMember(t, { userId: 'u9', organizationId: ORG, role: 'member' });
    await t.run(async (ctx) => {
      await ctx.db.insert('teamMemberMirror', {
        teamMemberId: 'tm_u9',
        userId: 'u9',
        teamId: 'team-mine',
      });
    });
    const orgWideProject = await seedProject(t, {});
    await seedProject(t, { teamId: 'team-foreign' });
    // Chat external turns own no project-bound session row.
    const scope = await t.query(
      internal.sandbox.workspace_access.resolveWorkspaceKnowledgeScope,
      { organizationId: ORG, sessionId: 'sess_chat', userId: 'u9' },
    );
    expect(scope).toEqual({
      teamIds: [`org_${ORG}`, 'team-mine'],
      projectIds: [orgWideProject],
      includeHub: true,
    });
  });

  it('a session with neither a project owner nor a user fails CLOSED', async () => {
    const t = newTest();
    await seedSession(t, {
      sessionId: 'sess_render',
      ownerType: 'render',
      ownerId: 'render_1',
    });
    const scope = await t.query(
      internal.sandbox.workspace_access.resolveWorkspaceKnowledgeScope,
      { organizationId: ORG, sessionId: 'sess_render' },
    );
    expect(scope).toEqual({ teamIds: [], projectIds: [], includeHub: false });
  });

  it("another org's session never yields this org's scope", async () => {
    const t = newTest();
    const projectId = await seedProject(t, { teamId: 'team-x' });
    const agentId = await t.run(
      async (ctx) =>
        await ctx.db.insert('projectAgents', {
          organizationId: ORG,
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeded projects row id
          projectId: projectId as never,
          name: 'Filer',
          harness: 'claude-code',
          skills: [],
          connectors: [],
          createdBy: 'user_seed',
          createdAt: 1,
          updatedAt: 1,
        }),
    );
    await seedSession(t, {
      sessionId: 'sess_pa2',
      ownerType: 'project_agent',
      ownerId: agentId,
    });
    // The dispatch claims a different org than the session's — fail closed.
    const scope = await t.query(
      internal.sandbox.workspace_access.resolveWorkspaceKnowledgeScope,
      { organizationId: 'org_OTHER', sessionId: 'sess_pa2' },
    );
    expect(scope).toEqual({ teamIds: [], projectIds: [], includeHub: false });
  });
});

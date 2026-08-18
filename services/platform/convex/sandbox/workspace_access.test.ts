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
import {
  automationProjectBindingsTable,
  automationRunsTable,
} from '../automations/schema';
import {
  AGENT_READ_SUBJECTS,
  resolveAgentReadAccess,
} from '../lib/rls/helpers/agent_read_access';
import { memberMirrorTable, teamMemberMirrorTable } from '../members/schema';
import { buildModules } from '../migrations/framework/test_helpers';
import { projectAgentsTable, projectsTable } from '../projects/schema';
import { sandboxSessionsTable } from './sessions_schema';
import { agentReadSubjectValidator } from './workspace_access';

const schema = defineSchema({
  memberMirror: memberMirrorTable,
  teamMemberMirror: teamMemberMirrorTable,
  sandboxSessions: sandboxSessionsTable,
  automationRuns: automationRunsTable,
  automationProjectBindings: automationProjectBindingsTable,
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
    // Driven off the exported list, not a copy of it: a subject added to the
    // union without a `platformPermissions` row would be denied by default,
    // and this loop is what catches that.
    for (const subject of AGENT_READ_SUBJECTS) {
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

  it('the wire validator lists exactly the subjects the resolver knows', () => {
    // Convex needs literal validators, so the union is spelled by hand. A
    // subject in one list and not the other is an argument-validation error at
    // dispatch — invisible to the type checker, so it is pinned here.
    const wireSubjects = agentReadSubjectValidator.members.map(
      (member) => member.value,
    );
    expect([...wireSubjects].sort()).toEqual([...AGENT_READ_SUBJECTS].sort());
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
// resolveKnowledgeToolAccess — the retrieval access of one dispatch, derived
// from what the SESSION proves (never the request): binding first, then the
// turn user (role-checked), else refused with the reason.
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

async function seedProjectAgent(
  t: ReturnType<typeof newTest>,
  projectId: string,
): Promise<string> {
  return await t.run(
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
}

async function seedAutomationRun(
  t: ReturnType<typeof newTest>,
  args: { projectId?: string },
): Promise<string> {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert('automationRuns', {
        organizationId: ORG,
        name: 'filing-desk',
        version: 1,
        ...(args.projectId !== undefined
          ? {
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeded projects row id
              projectId: args.projectId as never,
            }
          : {}),
        status: 'running',
        mode: 'live',
        startedBy: 'user_seed',
        input: {},
        startedAt: 1,
      }),
  );
}

/** Bind the `filing-desk` automation to a project — its bindings are what a
 * run started WITHOUT a project resolves as its allowed scope. */
async function seedBinding(
  t: ReturnType<typeof newTest>,
  projectId: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('automationProjectBindings', {
      organizationId: ORG,
      automationName: 'filing-desk',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeded projects row id
      projectId: projectId as never,
      boundAt: 1,
      boundBy: 'user_seed',
    });
  });
}

describe('resolveKnowledgeToolAccess', () => {
  it("a project agent's session reads its project, the project's teams, and the hub", async () => {
    const t = newTest();
    const projectId = await seedProject(t, {
      teamId: 'team-x',
      sharedWithTeamIds: ['team-y'],
    });
    const agentId = await seedProjectAgent(t, projectId);
    await seedSession(t, {
      sessionId: 'sess_pa',
      ownerType: 'project_agent',
      ownerId: agentId,
    });
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      { organizationId: ORG, sessionId: 'sess_pa', subject: 'documents' },
    );
    expect(access).toEqual({
      allowed: true,
      scope: {
        teamIds: ['team-x', 'team-y'],
        projectIds: [projectId],
        includeHub: true,
        archivedProjectIds: [],
      },
    });
  });

  it("a project-bound automation run's session reads the run's project", async () => {
    const t = newTest();
    const projectId = await seedProject(t, { teamId: 'team-x' });
    const runId = await seedAutomationRun(t, { projectId });
    await seedSession(t, {
      sessionId: 'sess_wf',
      ownerType: 'workflow_run',
      // The owner key format the session naming module writes.
      ownerId: `${runId}:@workflow`,
    });
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      { organizationId: ORG, sessionId: 'sess_wf', subject: 'documents' },
    );
    expect(access).toEqual({
      allowed: true,
      scope: {
        teamIds: ['team-x'],
        projectIds: [projectId],
        includeHub: true,
        archivedProjectIds: [],
      },
    });
  });

  it('an ORG-LEVEL automation run (no project) reads the hub only', async () => {
    const t = newTest();
    const runId = await seedAutomationRun(t, {});
    await seedSession(t, {
      sessionId: 'sess_wf_org',
      ownerType: 'workflow_run',
      ownerId: `${runId}:@workflow`,
    });
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      { organizationId: ORG, sessionId: 'sess_wf_org', subject: 'documents' },
    );
    expect(access).toEqual({
      allowed: true,
      scope: {
        teamIds: [],
        projectIds: [],
        includeHub: true,
        archivedProjectIds: [],
      },
    });
  });

  it('a run stamped with a DELETED project fails closed, never widened to the hub', async () => {
    const t = newTest();
    const projectId = await seedProject(t, { teamId: 'team-x' });
    const runId = await seedAutomationRun(t, { projectId });
    await t.run(async (ctx) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the seeded projects row id
      await ctx.db.delete(projectId as never);
    });
    await seedSession(t, {
      sessionId: 'sess_wf_gone',
      ownerType: 'workflow_run',
      ownerId: `${runId}:@workflow`,
    });
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      { organizationId: ORG, sessionId: 'sess_wf_gone', subject: 'documents' },
    );
    expect(access).toEqual({ allowed: false, reason: 'no_access_context' });
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
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      {
        organizationId: ORG,
        sessionId: 'sess_chat',
        userId: 'u9',
        subject: 'documents',
      },
    );
    expect(access).toEqual({
      allowed: true,
      scope: {
        teamIds: [`org_${ORG}`, 'team-mine'],
        projectIds: [orgWideProject],
        includeHub: true,
        archivedProjectIds: [],
      },
    });
  });

  it('the user fallback is role-checked: a disabled membership is refused', async () => {
    const t = newTest();
    await seedMember(t, {
      userId: 'u10',
      organizationId: ORG,
      role: 'disabled',
    });
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      {
        organizationId: ORG,
        sessionId: 'sess_chat2',
        userId: 'u10',
        subject: 'documents',
      },
    );
    expect(access).toEqual({ allowed: false, reason: 'not_a_member' });
  });

  it('a session with neither a binding nor a user is refused with the reason', async () => {
    const t = newTest();
    await seedSession(t, {
      sessionId: 'sess_render',
      ownerType: 'render',
      ownerId: 'render_1',
    });
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      { organizationId: ORG, sessionId: 'sess_render', subject: 'documents' },
    );
    expect(access).toEqual({ allowed: false, reason: 'no_access_context' });
  });

  it("another org's session never yields this org's scope", async () => {
    const t = newTest();
    const projectId = await seedProject(t, { teamId: 'team-x' });
    const agentId = await seedProjectAgent(t, projectId);
    await seedSession(t, {
      sessionId: 'sess_pa2',
      ownerType: 'project_agent',
      ownerId: agentId,
    });
    // The dispatch claims a different org than the session's — fail closed.
    const access = await t.query(
      internal.sandbox.workspace_access.resolveKnowledgeToolAccess,
      {
        organizationId: 'org_OTHER',
        sessionId: 'sess_pa2',
        subject: 'documents',
      },
    );
    expect(access).toEqual({ allowed: false, reason: 'no_access_context' });
  });
});

describe('resolveSessionActionContext', () => {
  it("a project-bound automation run acts inside the run's project", async () => {
    const t = newTest();
    const projectId = await seedProject(t, { teamId: 'team-x' });
    const runId = await seedAutomationRun(t, { projectId });
    await seedSession(t, {
      sessionId: 'sess_run',
      ownerType: 'workflow_run',
      ownerId: runId,
    });
    const context = await t.query(
      internal.sandbox.workspace_access.resolveSessionActionContext,
      {
        organizationId: ORG,
        sessionId: 'sess_run',
        subject: 'tasks',
        effect: 'write',
      },
    );
    expect(context).toEqual({
      allowed: true,
      actorId: 'automation:filing-desk',
      scope: { kind: 'project', projectId },
    });
  });

  it('a truly org-level run (no bindings) is org-wide, unbounded', async () => {
    const t = newTest();
    const runId = await seedAutomationRun(t, {});
    await seedSession(t, {
      sessionId: 'sess_org',
      ownerType: 'workflow_run',
      ownerId: runId,
    });
    const context = await t.query(
      internal.sandbox.workspace_access.resolveSessionActionContext,
      {
        organizationId: ORG,
        sessionId: 'sess_org',
        subject: 'tasks',
        effect: 'write',
      },
    );
    // No `allowedProjectIds` — a bindings-free automation reaches the whole org.
    expect(context).toEqual({
      allowed: true,
      actorId: 'automation:filing-desk',
      scope: { kind: 'org' },
    });
  });

  it('a MULTI-BOUND automation run org-wide is confined to its bound projects', async () => {
    const t = newTest();
    const projectA = await seedProject(t, { teamId: 'team-a' });
    const projectB = await seedProject(t, { teamId: 'team-b' });
    await seedBinding(t, projectA);
    await seedBinding(t, projectB);
    // The run itself carries no project — it is org-wide, but its automation's
    // bindings bound where it may act.
    const runId = await seedAutomationRun(t, {});
    await seedSession(t, {
      sessionId: 'sess_multi',
      ownerType: 'workflow_run',
      ownerId: runId,
    });
    const context = (await t.query(
      internal.sandbox.workspace_access.resolveSessionActionContext,
      {
        organizationId: ORG,
        sessionId: 'sess_multi',
        subject: 'tasks',
        effect: 'write',
      },
    )) as {
      allowed: boolean;
      actorId: string;
      scope: { kind: string; allowedProjectIds?: string[] };
    };
    expect(context.allowed).toBe(true);
    expect(context.scope.kind).toBe('org');
    expect([...(context.scope.allowedProjectIds ?? [])].sort()).toEqual(
      [projectA, projectB].sort(),
    );
  });
});

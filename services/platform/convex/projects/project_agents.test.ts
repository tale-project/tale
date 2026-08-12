// Coverage for the project-agent CRUD — user-created, named agents that
// replaced the per-harness capability binding. Locks the write-side contract:
// field normalization (trimmed bounded name, deduped capability sets, blank
// instructions dropped), the harness eligibility gate (shipped slug, cursor
// refused), per-project name uniqueness (case-folded, self-excluded on
// update), the instance/equipment caps, provenance preservation on update,
// and the RBAC + audit trail every mutation carries.
//
// Same mock-the-factory pattern as set_project_agent_capabilities.test.ts had
// (now retired with the binding): handler bodies unit-tested without a
// backend; `./access`, `diff`, and the audit-action map stay real.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PROJECT_AUDIT_ACTIONS } from './audit_actions';

vi.mock('convex/values', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stub = () => 'validator';
  return {
    ...actual,
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      id: stub,
      object: stub,
      union: stub,
      literal: stub,
      array: stub,
      null: stub,
      record: stub,
    },
  };
});

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    mutation: (config: Record<string, unknown>) => config,
  };
});

const mockGetAuthUserIdentity = vi.fn();
vi.mock('../lib/rls/auth/get_auth_user_identity', () => ({
  getAuthUserIdentity: (...args: unknown[]) => mockGetAuthUserIdentity(...args),
}));

const mockGetOrgMember = vi.fn();
vi.mock('../lib/rls/organization/get_organization_member', () => ({
  getOrganizationMember: (...args: unknown[]) => mockGetOrgMember(...args),
}));

vi.mock('../lib/get_user_teams', () => ({
  getUserTeamIds: vi.fn().mockResolvedValue([]),
}));

vi.mock('../lib/rate_limiter/helpers', () => ({
  checkUserRateLimit: vi.fn().mockResolvedValue(undefined),
  RateLimitExceededError: class RateLimitExceededError extends Error {
    retryAfter = 0;
  },
}));

const mockCreateAuditLog = vi.fn();
vi.mock('../audit_logs/helpers', () => ({
  createAuditLog: (...args: unknown[]) => mockCreateAuditLog(...args),
}));

vi.mock('../events/emit', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./schema', () => ({
  projectModeValidator: 'validator',
  projectKnowledgeModeValidator: 'validator',
  projectConnectorsModeValidator: 'validator',
}));

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

async function getMutations() {
  const { createProjectAgent, updateProjectAgent, deleteProjectAgent } =
    await import('./mutations');
  return {
    create: createProjectAgent as unknown as { handler: Handler },
    update: updateProjectAgent as unknown as { handler: Handler },
    remove: deleteProjectAgent as unknown as { handler: Handler },
  };
}

const AUTH_USER = { userId: 'user_1', email: 'test@example.com' };

const PROJECT = {
  _id: 'project_1',
  organizationId: 'org_1',
  name: 'Apollo',
  teamId: undefined,
  sharedWithTeamIds: undefined,
  // Non-zero so a delta is distinguishable from an absolute write.
  projectAgentCount: 3,
};

const AGENT_ROW = {
  _id: 'agent_1',
  organizationId: 'org_1',
  projectId: 'project_1',
  name: 'Old reviewer',
  harness: 'codex',
  model: 'openrouter/deepseek/deepseek-v3.2',
  skills: ['plan'],
  connectors: [],
  instructions: 'old instructions',
  createdBy: 'user_0',
  createdAt: 111,
  updatedAt: 111,
};

function createMockCtx(
  options: {
    project?: Record<string, unknown> | null;
    /** Existing projectAgents rows the by_project index walk returns. */
    siblings?: Array<Record<string, unknown>>;
    /** The row `db.get('agent_1')` resolves; null = missing. */
    agentRow?: Record<string, unknown> | null;
    /** Org agentSecrets rows the `pruneMissingSecrets` catalog walk returns. */
    secretRows?: Array<{ name: string }>;
  } = {},
) {
  const project = options.project === undefined ? PROJECT : options.project;
  const agentRow =
    options.agentRow === undefined ? AGENT_ROW : options.agentRow;
  const siblings = options.siblings ?? [];
  const secretRows = options.secretRows ?? [];
  return {
    db: {
      get: vi.fn((id: string) => {
        if (id === 'project_1') return Promise.resolve(project);
        if (id === 'agent_1') return Promise.resolve(agentRow);
        return Promise.resolve(null);
      }),
      insert: vi.fn().mockResolvedValue('agent_new'),
      patch: vi.fn().mockResolvedValue(undefined),
      replace: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      // Table-aware: the projectAgents walks return siblings; the agentSecrets
      // catalog walk (pruneMissingSecrets) returns the org's secret rows.
      query: vi.fn((table: string) => ({
        withIndex: vi.fn(() => ({
          collect: vi
            .fn()
            .mockResolvedValue(
              table === 'agentSecrets' ? secretRows : siblings,
            ),
        })),
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthUserIdentity.mockResolvedValue(AUTH_USER);
  mockGetOrgMember.mockResolvedValue({
    _id: 'member_1',
    organizationId: 'org_1',
    userId: 'user_1',
    role: 'editor',
  });
});

describe('createProjectAgent', () => {
  it('inserts the normalized row, bumps the project, and audits', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    const id = await create.handler(ctx, {
      projectId: 'project_1',
      name: '  PR reviewer  ',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: ['a', 'a', '', 'b'],
      connectors: ['', 'x', 'x'],
      instructions: '  review every PR carefully  ',
    });

    expect(id).toBe('agent_new');
    expect(ctx.db.insert).toHaveBeenCalledWith(
      'projectAgents',
      expect.objectContaining({
        organizationId: 'org_1',
        projectId: 'project_1',
        name: 'PR reviewer',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        skills: ['a', 'b'],
        connectors: ['x'],
        instructions: 'review every PR carefully',
        createdBy: 'user_1',
      }),
    );
    // The same patch carries the denormalized agent count the projects list
    // renders — one write, not a second read-modify-write.
    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      updatedAt: expect.any(Number),
      projectAgentCount: 4,
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: PROJECT_AUDIT_ACTIONS.agentsChanged,
        resourceId: 'project_1',
        newState: expect.objectContaining({
          name: 'PR reviewer',
          harness: 'claude-code',
          instructionsLength: 'review every PR carefully'.length,
        }),
        metadata: { op: 'create', projectAgentId: 'agent_new' },
      }),
    );
  });

  it('drops blank instructions instead of storing an empty string', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await create.handler(ctx, {
      projectId: 'project_1',
      name: 'Tester',
      harness: 'codex',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      instructions: '   ',
    });

    const inserted = ctx.db.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(inserted).not.toHaveProperty('instructions');
  });

  it('persists the provider pin trimmed, and audits it', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await create.handler(ctx, {
      projectId: 'project_1',
      name: 'Tester',
      harness: 'claude-code',
      model: 'claude-sonnet-4-6',
      modelProvider: '  anthropic  ',
      skills: [],
      connectors: [],
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'projectAgents',
      expect.objectContaining({ modelProvider: 'anthropic' }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        newState: expect.objectContaining({ modelProvider: 'anthropic' }),
      }),
    );
  });

  it('drops a blank provider pin instead of storing an empty string', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await create.handler(ctx, {
      projectId: 'project_1',
      name: 'Tester',
      harness: 'codex',
      model: 'z-ai/glm-5',
      modelProvider: '   ',
      skills: [],
      connectors: [],
    });

    const inserted = ctx.db.insert.mock.calls[0][1] as Record<string, unknown>;
    expect(inserted).not.toHaveProperty('modelProvider');
  });

  it.each([
    ['an unknown slug', 'not-a-harness'],
    ['cursor (byo-only, no instructions channel)', 'cursor'],
  ])('refuses %s as the harness', async (_label, harness) => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'Tester',
        harness,
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({
      data: { code: 'PROJECT_AGENT_HARNESS_INVALID' },
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('refuses a name a sibling already holds, case-folded', async () => {
    const ctx = createMockCtx({
      siblings: [{ _id: 'agent_0', name: 'pr REVIEWER' }],
    });
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'PR Reviewer',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'PROJECT_AGENT_NAME_TAKEN' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('normalizes tools against the catalog and prunes dangling secret names', async () => {
    // Setting a secret grant is a developer act (see the editor-denied test).
    mockGetOrgMember.mockResolvedValue({
      _id: 'member_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'developer',
    });
    const ctx = createMockCtx({ secretRows: [{ name: 'GLITCHTIP_TOKEN' }] });
    const { create } = await getMutations();

    await create.handler(ctx, {
      projectId: 'project_1',
      name: 'Triage bot',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      // Unknown tool dropped; duplicate folded; order → catalog order.
      tools: ['task_create', 'not_a_tool', 'task_find', 'task_create'],
      // Only names that exist in the org survive.
      secrets: ['GLITCHTIP_TOKEN', 'GHOST_SECRET'],
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      'projectAgents',
      expect.objectContaining({
        tools: ['task_find', 'task_create'],
        secrets: ['GLITCHTIP_TOKEN'],
      }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        newState: expect.objectContaining({
          tools: ['task_find', 'task_create'],
          secrets: ['GLITCHTIP_TOKEN'],
        }),
      }),
    );
  });

  it('lets an editor grant write TOOLS (no capability an editor lacks)', async () => {
    // The default member role in beforeEach is editor; tools are not gated.
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await create.handler(ctx, {
      projectId: 'project_1',
      name: 'Editor tools',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      tools: ['task_create'],
    });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      'projectAgents',
      expect.objectContaining({ tools: ['task_create'] }),
    );
  });

  it('refuses an editor adding a SECRET grant (developer act)', async () => {
    // beforeEach role = editor; the org has the secret, but attaching it
    // exposes plaintext to the agent, so it needs the developer capability.
    const ctx = createMockCtx({ secretRows: [{ name: 'GLITCHTIP_TOKEN' }] });
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'Editor secret',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
        secrets: ['GLITCHTIP_TOKEN'],
      }),
    ).rejects.toMatchObject({ data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('omits tools/secrets from the row when none are granted', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await create.handler(ctx, {
      projectId: 'project_1',
      name: 'Plain agent',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
    });

    const row = (ctx.db.insert as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as Record<string, unknown>;
    expect(row).not.toHaveProperty('tools');
    expect(row).not.toHaveProperty('secrets');
  });

  it('rejects equipment over the per-agent cap', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'Tester',
        harness: 'codex',
        model: 'z-ai/glm-5',
        skills: Array.from({ length: 26 }, (_, i) => `s${i}`),
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'too_many_bindings' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('rejects creation past the per-project instance cap', async () => {
    const ctx = createMockCtx({
      siblings: Array.from({ length: 50 }, (_, i) => ({
        _id: `agent_${i}`,
        name: `Agent ${i}`,
      })),
    });
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'One too many',
        harness: 'codex',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'PROJECT_AGENT_LIMIT' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('rejects over-long instructions', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'Tester',
        harness: 'codex',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
        instructions: 'x'.repeat(20_001),
      }),
    ).rejects.toMatchObject({
      data: { code: 'PROJECT_AGENT_INSTRUCTIONS_TOO_LONG' },
    });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('rejects a missing model', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'Tester',
        harness: 'codex',
        model: '   ',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'PROJECT_AGENT_MODEL_INVALID' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: '   ',
        harness: 'codex',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'PROJECT_AGENT_NAME_INVALID' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });

  it('requires project edit access', async () => {
    mockGetOrgMember.mockResolvedValue({
      _id: 'member_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'member',
    });
    const ctx = createMockCtx();
    const { create } = await getMutations();

    await expect(
      create.handler(ctx, {
        projectId: 'project_1',
        name: 'Tester',
        harness: 'codex',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'RBAC_FORBIDDEN' } });
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});

describe('updateProjectAgent', () => {
  it('replaces the writable fields and preserves provenance', async () => {
    const ctx = createMockCtx({ siblings: [AGENT_ROW] });
    const { update } = await getMutations();

    await update.handler(ctx, {
      agentId: 'agent_1',
      name: 'New reviewer',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      modelProvider: 'openrouter',
      skills: ['review'],
      connectors: ['github'],
      instructions: 'updated',
    });

    expect(ctx.db.replace).toHaveBeenCalledWith(
      'agent_1',
      expect.objectContaining({
        name: 'New reviewer',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        modelProvider: 'openrouter',
        skills: ['review'],
        connectors: ['github'],
        instructions: 'updated',
        createdBy: 'user_0',
        createdAt: 111,
      }),
    );
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: PROJECT_AUDIT_ACTIONS.agentsChanged,
        previousState: expect.objectContaining({ name: 'Old reviewer' }),
        newState: expect.objectContaining({ name: 'New reviewer' }),
        metadata: { op: 'update', projectAgentId: 'agent_1' },
      }),
    );
  });

  it('lets a row keep its own name across a case change', async () => {
    const ctx = createMockCtx({ siblings: [AGENT_ROW] });
    const { update } = await getMutations();

    await update.handler(ctx, {
      agentId: 'agent_1',
      name: 'OLD REVIEWER',
      harness: 'codex',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
    });

    expect(ctx.db.replace).toHaveBeenCalled();
  });

  it('refuses a missing row', async () => {
    const ctx = createMockCtx({ agentRow: null });
    const { update } = await getMutations();

    await expect(
      update.handler(ctx, {
        agentId: 'agent_1',
        name: 'Anything',
        harness: 'codex',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'PROJECT_AGENT_NOT_FOUND' } });
    expect(ctx.db.replace).not.toHaveBeenCalled();
  });
});

describe('deleteProjectAgent', () => {
  it('deletes the row and audits the previous state', async () => {
    const ctx = createMockCtx();
    const { remove } = await getMutations();

    await remove.handler(ctx, { agentId: 'agent_1' });

    expect(ctx.db.delete).toHaveBeenCalledWith('agent_1');
    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      updatedAt: expect.any(Number),
      projectAgentCount: 2,
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: PROJECT_AUDIT_ACTIONS.agentsChanged,
        previousState: expect.objectContaining({
          name: 'Old reviewer',
          harness: 'codex',
          instructionsLength: 'old instructions'.length,
        }),
        metadata: { op: 'delete', projectAgentId: 'agent_1' },
      }),
    );
  });

  it('refuses a missing row', async () => {
    const ctx = createMockCtx({ agentRow: null });
    const { remove } = await getMutations();

    await expect(
      remove.handler(ctx, { agentId: 'agent_1' }),
    ).rejects.toMatchObject({ data: { code: 'PROJECT_AGENT_NOT_FOUND' } });
    expect(ctx.db.delete).not.toHaveBeenCalled();
  });
});

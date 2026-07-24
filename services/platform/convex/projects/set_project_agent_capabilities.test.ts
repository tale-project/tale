// Coverage for `setProjectAgentCapabilities` — the project's persistent,
// per-agent skills/connectors binding (the project-scoped analog of a chat
// thread's `capabilities`). Locks the set-semantics that make the binding
// safe to write repeatedly from the UI: dedupe, drop empties, remove an
// emptied entry (so an agent falls back to its default rather than being
// pinned to "nothing"), and clear the whole field when the last entry goes.
//
// Same mock-the-factory pattern as detach_document_from_project.test.ts: the
// handler body is unit-tested without a running backend, and `./access`,
// `diff`/`arrayDiff`, and the audit-action map stay real so the audit trail
// and RBAC gate are exercised as shipped.

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
  projectIntegrationsModeValidator: 'validator',
}));

type Handler = (
  ctx: unknown,
  args: Record<string, unknown>,
) => Promise<unknown>;

async function getMutation(): Promise<{ handler: Handler }> {
  const { setProjectAgentCapabilities } = await import('./mutations');
  return setProjectAgentCapabilities as unknown as { handler: Handler };
}

const AUTH_USER = { userId: 'user_1', email: 'test@example.com' };

const PROJECT = {
  _id: 'project_1',
  organizationId: 'org_1',
  name: 'Apollo',
  teamId: undefined,
  sharedWithTeamIds: undefined,
};

function createMockCtx(project: Record<string, unknown> = PROJECT) {
  return {
    db: {
      get: vi.fn((id: string) =>
        Promise.resolve(id === 'project_1' ? project : null),
      ),
      patch: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('setProjectAgentCapabilities', () => {
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

  it('persists a binding and audits the agent that changed', async () => {
    const ctx = createMockCtx();
    const { handler } = await getMutation();

    await handler(ctx, {
      projectId: 'project_1',
      agentId: 'claude-code',
      skills: ['review'],
      connectors: ['github'],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      agentCapabilities: {
        'claude-code': { skills: ['review'], connectors: ['github'] },
      },
      updatedAt: expect.any(Number),
    });
    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        action: PROJECT_AUDIT_ACTIONS.agentsChanged,
        resourceId: 'project_1',
        metadata: expect.objectContaining({
          agentId: 'claude-code',
          skillsDiff: { added: ['review'], removed: [] },
          connectorsDiff: { added: ['github'], removed: [] },
        }),
      }),
    );
  });

  it('dedupes and drops empty slugs — the binding is a set', async () => {
    const ctx = createMockCtx();
    const { handler } = await getMutation();

    await handler(ctx, {
      projectId: 'project_1',
      agentId: 'codex',
      skills: ['a', 'a', '', 'b'],
      connectors: ['', 'x', 'x'],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      agentCapabilities: {
        codex: { skills: ['a', 'b'], connectors: ['x'] },
      },
      updatedAt: expect.any(Number),
    });
  });

  it('merges alongside other agents without disturbing them', async () => {
    const ctx = createMockCtx({
      ...PROJECT,
      agentCapabilities: {
        'claude-code': { skills: ['review'], connectors: [] },
      },
    });
    const { handler } = await getMutation();

    await handler(ctx, {
      projectId: 'project_1',
      agentId: 'codex',
      skills: ['plan'],
      connectors: [],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      agentCapabilities: {
        'claude-code': { skills: ['review'], connectors: [] },
        codex: { skills: ['plan'], connectors: [] },
      },
      updatedAt: expect.any(Number),
    });
  });

  it('removes an emptied entry but keeps the other agents', async () => {
    const ctx = createMockCtx({
      ...PROJECT,
      agentCapabilities: {
        'claude-code': { skills: ['review'], connectors: [] },
        codex: { skills: ['plan'], connectors: [] },
      },
    });
    const { handler } = await getMutation();

    await handler(ctx, {
      projectId: 'project_1',
      agentId: 'claude-code',
      skills: [],
      connectors: [],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      agentCapabilities: { codex: { skills: ['plan'], connectors: [] } },
      updatedAt: expect.any(Number),
    });
  });

  it('clears the whole field when the last entry is emptied', async () => {
    const ctx = createMockCtx({
      ...PROJECT,
      agentCapabilities: {
        'claude-code': { skills: ['review'], connectors: [] },
      },
    });
    const { handler } = await getMutation();

    await handler(ctx, {
      projectId: 'project_1',
      agentId: 'claude-code',
      skills: [],
      connectors: [],
    });

    expect(ctx.db.patch).toHaveBeenCalledWith('project_1', {
      agentCapabilities: undefined,
      updatedAt: expect.any(Number),
    });
  });

  it('rejects a binding over the per-agent cap', async () => {
    const ctx = createMockCtx();
    const { handler } = await getMutation();

    await expect(
      handler(ctx, {
        projectId: 'project_1',
        agentId: 'codex',
        skills: Array.from({ length: 26 }, (_, i) => `s${i}`),
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'too_many_bindings' } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('rejects an empty agent id', async () => {
    const ctx = createMockCtx();
    const { handler } = await getMutation();

    await expect(
      handler(ctx, {
        projectId: 'project_1',
        agentId: '',
        skills: ['review'],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_agent' } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it('requires project edit access', async () => {
    mockGetOrgMember.mockResolvedValue({
      _id: 'member_1',
      organizationId: 'org_1',
      userId: 'user_1',
      role: 'member',
    });
    const ctx = createMockCtx();
    const { handler } = await getMutation();

    await expect(
      handler(ctx, {
        projectId: 'project_1',
        agentId: 'codex',
        skills: ['review'],
        connectors: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'RBAC_FORBIDDEN' } });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

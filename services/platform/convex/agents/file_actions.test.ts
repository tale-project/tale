import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUnlink = vi.fn();
const mockRm = vi.fn();
const mockReaddir = vi.fn();
const mockMkdir = vi.fn();
const mockListAgentsForOrg = vi.fn();

vi.mock('node:fs/promises', () => ({
  unlink: (...args: unknown[]) => mockUnlink(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...actual, default: actual };
});

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
  internalAction: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    agents: {
      mutations: { cleanupAgentBinding: 'cleanupAgentBinding' },
      internal_queries: { getBindingByAgent: 'getBindingByAgent' },
      installations: { getInstallationInternal: 'getInstallationInternal' },
    },
    organizations: {
      internal_queries: {
        getOrganizationDefaultLocale: 'getOrganizationDefaultLocale',
      },
    },
  },
}));

const mockGetAuthUser = vi.fn();
vi.mock('../auth', () => ({
  authComponent: {
    getAuthUser: (...args: unknown[]) => mockGetAuthUser(...args),
  },
}));

vi.mock('../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('default'),
}));

const mockRequireOrgMembershipById = vi.fn();
vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: (...args: unknown[]) =>
    mockRequireOrgMembershipById(...args),
}));

const mockAtomicWrite = vi.fn();
const mockReadJsonFile = vi.fn();
const mockReadFileSafe = vi.fn();
vi.mock('../lib/file_io', () => ({
  atomicWrite: (...args: unknown[]) => mockAtomicWrite(...args),
  readJsonFile: (...args: unknown[]) => mockReadJsonFile(...args),
  readFileSafe: (...args: unknown[]) => mockReadFileSafe(...args),
  sha256: () => 'mock-hash',
  generateHistoryTimestamp: () => '1234567890-abcdef01',
  pruneHistory: vi.fn(),
  serializeJson: (data: object) => JSON.stringify(data, null, 2) + '\n',
}));

vi.mock('./file_utils', async () => {
  const actual =
    await vi.importActual<typeof import('./file_utils')>('./file_utils');
  return {
    ...actual,
    resolveAgentsDir: (orgSlug: string) =>
      orgSlug === 'default' ? '/data/agents' : `/data/agents/${orgSlug}`,
    resolveAgentFilePath: (_orgSlug: string, agentName: string) =>
      `/data/agents/${agentName}.json`,
    resolveAgentFilePathFromRelative: (_orgSlug: string, rel: string) =>
      `/data/agents/${rel}`,
    resolveHistoryDir: (_orgSlug: string, agentName: string) =>
      `/data/agents/.history/${agentName}`,
    walkAgentRelativePaths: async () => [],
  };
});

// The folder-aware index lives in internal_actions; stub `resolveAgentPath` to
// the flat `<slug>.json` location (the unindexed-slug fallback) so edit/delete/
// history ops resolve to the path these assertions expect, and cache drops no-op.
vi.mock('./internal_actions', () => ({
  resolveAgentPath: vi.fn(
    async (_orgSlug: string, slug: string) => `/data/agents/${slug}.json`,
  ),
  invalidateAgentListCache: vi.fn(),
  listAgentsForOrg: (...args: unknown[]) => mockListAgentsForOrg(...args),
}));

vi.mock('../../lib/shared/constants/agents', () => ({
  PROTECTED_AGENT_NAMES: ['assistant', 'workflow-assistant'],
  RESERVED_AGENT_SLUGS: ['auto', 'organigram'],
}));

vi.mock('../../lib/shared/schemas/agents', () => ({
  agentJsonSchema: {
    parse: (v: unknown) => v,
    safeParse: (v: unknown) => ({ success: true, data: v }),
  },
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------

const { deleteAgent, duplicateAgent } = await import('./file_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const deleteHandler = (deleteAgent as unknown as ActionConfig).handler;
const duplicateHandler = (duplicateAgent as unknown as ActionConfig).handler;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(undefined),
    runQuery: vi.fn().mockResolvedValue(null),
  };
}

const validConfig = {
  displayName: 'Test Agent',
  description: 'A test agent',
  systemInstructions: 'You are helpful',
  supportedModels: ['openai/gpt-5.2'],
  visibleInChat: true,
};

// ---------------------------------------------------------------------------
// Tests: deleteAgent
// ---------------------------------------------------------------------------

describe('deleteAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({
      _id: 'user-1',
      email: 'a@b.com',
      name: 'A',
    });
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'admin' },
    });
    mockUnlink.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  it('deletes the agent file and history directory', async () => {
    const ctx = createMockCtx();

    await deleteHandler(
      ctx as never,
      { organizationId: 'org_test', agentName: 'my-agent' } as never,
    );

    expect(mockUnlink).toHaveBeenCalledWith('/data/agents/my-agent.json');
    expect(mockRm).toHaveBeenCalledWith('/data/agents/.history/my-agent', {
      recursive: true,
      force: true,
    });
  });

  it('throws when agent is protected', async () => {
    const ctx = createMockCtx();

    await expect(
      deleteHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'assistant' } as never,
      ),
    ).rejects.toThrow("Agent 'assistant' cannot be deleted");

    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('throws when user is not authenticated', async () => {
    mockRequireOrgMembershipById.mockRejectedValue(
      new Error('Authentication required.'),
    );
    const ctx = createMockCtx();

    await expect(
      deleteHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'my-agent' } as never,
      ),
    ).rejects.toThrow('Authentication required.');
  });

  it('ignores ENOENT from unlink (file already absent)', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockUnlink.mockRejectedValue(enoent);
    const ctx = createMockCtx();

    await expect(
      deleteHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'my-agent' } as never,
      ),
    ).resolves.toBeNull();
  });

  it('propagates non-ENOENT errors from unlink', async () => {
    const eacces = Object.assign(new Error('Permission denied'), {
      code: 'EACCES',
    });
    mockUnlink.mockRejectedValue(eacces);
    const ctx = createMockCtx();

    await expect(
      deleteHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'my-agent' } as never,
      ),
    ).rejects.toThrow('Permission denied');
  });

  it('cleans up the DB binding for the deleted agent', async () => {
    const ctx = createMockCtx();

    await deleteHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        agentName: 'my-agent',
      } as never,
    );

    expect(ctx.runMutation).toHaveBeenCalledWith('cleanupAgentBinding', {
      organizationId: 'org-123',
      agentSlug: 'my-agent',
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: duplicateAgent
// ---------------------------------------------------------------------------

describe('duplicateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthUser.mockResolvedValue({
      _id: 'user-1',
      email: 'a@b.com',
      name: 'A',
    });
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'admin' },
    });
    mockReadJsonFile.mockResolvedValue({
      ok: true,
      data: validConfig,
      hash: 'abc123',
    });
    mockReaddir.mockResolvedValue(['my-agent.json']);
    // duplicateAgent now derives existing names from the roster index.
    mockListAgentsForOrg.mockResolvedValue([{ name: 'my-agent' }]);
    mockAtomicWrite.mockResolvedValue(undefined);
  });

  it('creates a copy with -copy suffix', async () => {
    const ctx = createMockCtx();

    const result = await duplicateHandler(
      ctx as never,
      { organizationId: 'org_test', agentName: 'my-agent' } as never,
    );

    expect(result).toEqual({ newAgentName: 'my-agent-copy' });
    expect(mockAtomicWrite).toHaveBeenCalledWith(
      '/data/agents/my-agent-copy.json',
      expect.stringContaining('"Test Agent (Copy)"'),
    );
  });

  it('increments suffix when copy already exists', async () => {
    mockListAgentsForOrg.mockResolvedValue([
      { name: 'my-agent' },
      { name: 'my-agent-copy' },
    ]);
    const ctx = createMockCtx();

    const result = await duplicateHandler(
      ctx as never,
      { organizationId: 'org_test', agentName: 'my-agent' } as never,
    );

    expect(result).toEqual({ newAgentName: 'my-agent-copy-2' });
  });

  it('sets visibleInChat to false on the copy', async () => {
    const ctx = createMockCtx();

    await duplicateHandler(
      ctx as never,
      { organizationId: 'org_test', agentName: 'my-agent' } as never,
    );

    const writtenContent = mockAtomicWrite.mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.visibleInChat).toBe(false);
  });

  it('throws when source agent cannot be read', async () => {
    mockReadJsonFile.mockResolvedValue({
      ok: false,
      error: 'not_found',
      message: 'File not found: my-agent.json',
    });
    const ctx = createMockCtx();

    await expect(
      duplicateHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'my-agent' } as never,
      ),
    ).rejects.toThrow('Cannot duplicate');
  });

  it('throws when user is not authenticated', async () => {
    mockRequireOrgMembershipById.mockRejectedValue(
      new Error('Authentication required.'),
    );
    const ctx = createMockCtx();

    await expect(
      duplicateHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'my-agent' } as never,
      ),
    ).rejects.toThrow('Authentication required.');
  });

  it('propagates atomicWrite errors', async () => {
    mockAtomicWrite.mockRejectedValue(new Error('Disk full'));
    const ctx = createMockCtx();

    await expect(
      duplicateHandler(
        ctx as never,
        { organizationId: 'org_test', agentName: 'my-agent' } as never,
      ),
    ).rejects.toThrow('Disk full');
  });
});

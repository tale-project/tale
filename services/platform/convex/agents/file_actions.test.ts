import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUnlink = vi.fn();
const mockRm = vi.fn();
const mockReaddir = vi.fn();
const mockMkdir = vi.fn();
const mockListAgentsForOrg = vi.fn();
const mockResolveAgentRelativePath = vi.fn();

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
      audit_mutations: { logAgentAuditEvent: 'logAgentAuditEvent' },
    },
    automations: {
      install_mutations: {
        listAutomationInstallationsInternal:
          'listAutomationInstallationsInternal',
      },
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
  handleDirReadError: vi.fn(),
  sha256: () => 'mock-hash',
  generateHistoryTimestamp: () => '1234567890-abcdef01',
  pruneHistory: vi.fn(),
  serializeJson: (data: object) => JSON.stringify(data, null, 2) + '\n',
  validateTimestamp: () => true,
  safeJoinWithinDir: (dir: string, name: string) => `${dir}/${name}`,
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
    resolveAutomationAgentsDir: (_orgSlug: string, app: string) =>
      `/data/apps/${app}/agents`,
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
  resolveAgentRelativePath: (...args: unknown[]) =>
    mockResolveAgentRelativePath(...args),
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

vi.mock('../../lib/shared/schemas/apps', () => ({
  isValidAppSlug: () => true,
}));

// ---------------------------------------------------------------------------
// Import handlers
// ---------------------------------------------------------------------------

const {
  deleteAgent,
  duplicateAgent,
  restoreFromHistory,
  setAgentAuthMode,
  listAgents,
} = await import('./file_actions');

type ActionConfig = {
  handler: (ctx: never, args: never) => Promise<unknown>;
};

const deleteHandler = (deleteAgent as unknown as ActionConfig).handler;
const duplicateHandler = (duplicateAgent as unknown as ActionConfig).handler;
const restoreHandler = (restoreFromHistory as unknown as ActionConfig).handler;
const setAuthModeHandler = (setAgentAuthMode as unknown as ActionConfig)
  .handler;
const listAgentsHandler = (listAgents as unknown as ActionConfig).handler;

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

  it('rejects a plain member lacking the developerSettings capability', async () => {
    // deleteAgent now gates on `developerSettings` (requireOrgAdminOrDeveloper),
    // matching create/duplicate/save. The real gate runs on top of the mocked
    // membership helper, so a `member` role must be rejected before any deletion.
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'member' },
    });
    const ctx = createMockCtx();

    await expect(
      deleteHandler(
        ctx as never,
        { organizationId: 'org-123', agentName: 'my-agent' } as never,
      ),
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
    });
    expect(mockUnlink).not.toHaveBeenCalled();
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

  it('writes the copy into the same folder as a foldered source agent', async () => {
    // Regression (#duplicate-lost-in-folder): a chat/ (or github/)
    // agent must duplicate ALONGSIDE its source, not flatten to
    // org/agents/<slug>.json — otherwise the copy's derived `folder` is `''` and
    // the folder-scoped list view (`?folder=chat`) filters it out, so the user
    // sees "Agent duplicated" but no new row.
    mockResolveAgentRelativePath.mockResolvedValue('chat/my-agent.json');
    const ctx = createMockCtx();

    const result = await duplicateHandler(
      ctx as never,
      { organizationId: 'org_test', agentName: 'my-agent' } as never,
    );

    expect(result).toEqual({ newAgentName: 'my-agent-copy' });
    expect(mockAtomicWrite).toHaveBeenCalledWith(
      '/data/agents/chat/my-agent-copy.json',
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

// ---------------------------------------------------------------------------
// Tests: restoreFromHistory
// ---------------------------------------------------------------------------

describe('restoreFromHistory', () => {
  // History snapshot path contains `.history`; the live agent path does not.
  // Route readFileSafe by which one is requested so each test can vary the
  // snapshot's capability fields independently of the current config.
  function mockHistoryAndCurrent(historyConfig: object, currentConfig: object) {
    mockReadFileSafe.mockImplementation(async (p: string) =>
      p.includes('.history')
        ? JSON.stringify(historyConfig)
        : JSON.stringify(currentConfig),
    );
  }

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
    mockAtomicWrite.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('rejects a plain member when the restore changes capability fields', async () => {
    // The snapshot re-grants a skillBinding the current config lacks — a
    // capability change that must require the developerSettings gate, even
    // though the public action only resolves plain membership directly.
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'member' },
    });
    mockHistoryAndCurrent(
      { ...validConfig, skillBindings: ['secret-skill'] },
      { ...validConfig, skillBindings: [] },
    );
    const ctx = createMockCtx();

    await expect(
      restoreHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          agentName: 'my-agent',
          timestamp: '1234567890-abcdef01',
        } as never,
      ),
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
    });
    expect(mockAtomicWrite).not.toHaveBeenCalled();
  });

  it('allows a developer to restore a capability-changing snapshot', async () => {
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'developer' },
    });
    mockHistoryAndCurrent(
      { ...validConfig, skillBindings: ['secret-skill'] },
      { ...validConfig, skillBindings: [] },
    );
    const ctx = createMockCtx();

    await restoreHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        agentName: 'my-agent',
        timestamp: '1234567890-abcdef01',
      } as never,
    );

    expect(mockAtomicWrite).toHaveBeenCalledWith(
      '/data/agents/my-agent.json',
      expect.stringContaining('secret-skill'),
    );
  });

  it('allows a plain member to restore a non-capability change', async () => {
    // Only the description differs; capability fields are identical, so the
    // restore is allowed for a plain member — mirroring saveAgent, where
    // members may edit non-capability fields.
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'member' },
    });
    mockHistoryAndCurrent(
      { ...validConfig, description: 'old description' },
      { ...validConfig, description: 'new description' },
    );
    const ctx = createMockCtx();

    await restoreHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        agentName: 'my-agent',
        timestamp: '1234567890-abcdef01',
      } as never,
    );

    expect(mockAtomicWrite).toHaveBeenCalledWith(
      '/data/agents/my-agent.json',
      expect.stringContaining('old description'),
    );
  });

  it('fails closed (requires the capability) when the current config is unreadable', async () => {
    // No current content means we cannot prove the snapshot leaves capability
    // grants unchanged, so the gate must require the developerSettings
    // capability and reject a plain member.
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'member' },
    });
    mockReadFileSafe.mockImplementation(async (p: string) =>
      p.includes('.history') ? JSON.stringify(validConfig) : null,
    );
    const ctx = createMockCtx();

    await expect(
      restoreHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          agentName: 'my-agent',
          timestamp: '1234567890-abcdef01',
        } as never,
      ),
    ).rejects.toMatchObject({
      data: { code: 'FORBIDDEN_DEVELOPER_SETTINGS' },
    });
    expect(mockAtomicWrite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: setAgentAuthMode
// ---------------------------------------------------------------------------

describe('setAgentAuthMode', () => {
  const externalByoConfig = {
    displayName: 'Desk Implementer',
    description: 'Runs as Claude Code',
    primaryBehavior: 'external-agent',
    agentKind: 'claude-code',
    authMode: 'byo',
    // An unresolvable model: `saveAgent` would throw UNKNOWN_MODEL on this,
    // which is exactly what used to block the flip (#2342).
    supportedModels: ['openrouter:anthropic/claude-opus-4.6'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgMembershipById.mockResolvedValue({
      orgId: 'org-123',
      orgSlug: 'default',
      userId: 'user-1',
      email: 'a@b.com',
      name: 'A',
      member: { _id: 'm-1', role: 'member' },
    });
    mockReadJsonFile.mockResolvedValue({
      ok: true,
      data: externalByoConfig,
      hash: 'abc123',
    });
    mockAtomicWrite.mockResolvedValue(undefined);
  });

  it('persists the managed flip even when supportedModels are unresolvable', async () => {
    // Regression (#2342): the flip must NOT re-validate supportedModels against
    // the provider catalog — an agent whose declared model the org hasn't
    // configured still gets its auth mode persisted.
    const ctx = createMockCtx();

    const result = await setAuthModeHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        agentName: 'issue-desk/desk-implementer',
        authMode: 'managed',
      } as never,
    );

    expect(result).toEqual({ ok: true });
    expect(mockAtomicWrite).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenContent] = mockAtomicWrite.mock.calls[0];
    expect(writtenPath).toBe('/data/agents/issue-desk/desk-implementer.json');
    expect(JSON.parse(writtenContent).authMode).toBe('managed');
  });

  it('is a no-op write when the mode is already set', async () => {
    const ctx = createMockCtx();

    const result = await setAuthModeHandler(
      ctx as never,
      {
        organizationId: 'org-123',
        agentName: 'issue-desk/desk-implementer',
        authMode: 'byo',
      } as never,
    );

    expect(result).toEqual({ ok: true });
    expect(mockAtomicWrite).not.toHaveBeenCalled();
  });

  it('rejects a non-external agent', async () => {
    mockReadJsonFile.mockResolvedValue({
      ok: true,
      data: { ...validConfig, primaryBehavior: 'chat' },
      hash: 'abc123',
    });
    const ctx = createMockCtx();

    await expect(
      setAuthModeHandler(
        ctx as never,
        {
          organizationId: 'org-123',
          agentName: 'my-agent',
          authMode: 'managed',
        } as never,
      ),
    ).rejects.toThrow('authMode only applies to an external-agent.');
    expect(mockAtomicWrite).not.toHaveBeenCalled();
  });
});

describe('listAgents app scope (#2564)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireOrgMembershipById.mockResolvedValue({ orgSlug: 'default' });
  });

  it('lists app agents only for installed apps, not every on-disk bundle', async () => {
    const ctx = {
      runMutation: vi.fn().mockResolvedValue(undefined),
      runQuery: vi.fn().mockResolvedValue(['issue-desk']),
    };
    // Both issue-desk (installed) and issue-desk-qa (uploaded, never installed)
    // may exist on disk; only the installed slug should be scanned.
    mockReaddir.mockImplementation(async (dir: string) => {
      if (dir === '/data/apps/issue-desk/agents') {
        return ['desk-implementer.json', 'desk-reviewer.json'];
      }
      if (dir === '/data/apps/issue-desk-qa/agents') {
        return ['desk-implementer.json', 'desk-reviewer.json'];
      }
      throw new Error(`unexpected readdir: ${dir}`);
    });
    mockReadJsonFile.mockImplementation(async () => ({
      ok: true,
      data: {
        displayName: 'Desk Agent',
      },
      hash: 'hash',
    }));

    const rows = (await listAgentsHandler(
      ctx as never,
      { organizationId: 'org-123' } as never,
    )) as Array<{ slug: string; appSlug?: string }>;

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'listAutomationInstallationsInternal',
      {
        organizationId: 'org-123',
      },
    );
    expect(mockReaddir).toHaveBeenCalledTimes(1);
    expect(mockReaddir).toHaveBeenCalledWith('/data/apps/issue-desk/agents');
    expect(mockReaddir).not.toHaveBeenCalledWith(
      '/data/apps/issue-desk-qa/agents',
    );
    expect(rows.some((row) => row.slug === 'issue-desk/desk-implementer')).toBe(
      true,
    );
    expect(rows.some((row) => row.slug === 'issue-desk/desk-reviewer')).toBe(
      true,
    );
    expect(rows.some((row) => row.slug.startsWith('issue-desk-qa/'))).toBe(
      false,
    );
  });

  it('returns no app agents when nothing is installed', async () => {
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue([]);

    const rows = (await listAgentsHandler(
      ctx as never,
      { organizationId: 'org-123' } as never,
    )) as Array<{ slug: string }>;

    expect(mockReaddir).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

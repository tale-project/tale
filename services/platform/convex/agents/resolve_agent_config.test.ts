import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replaces the deleted unified_chat_ttft.test.ts "no separate resolveAgentConfig
// runAction hop" contract: resolveAgentConfigInline must read the agent config
// from disk + binding + locale directly (in parallel), never via ctx.runAction.

vi.mock('../_generated/api', () => ({
  internal: {
    agents: {
      internal_queries: { getBindingByAgent: 'mock-getBindingByAgent' },
    },
    organizations: {
      internal_queries: {
        getOrganizationDefaultLocale: 'mock-getOrganizationDefaultLocale',
      },
    },
  },
}));

const mockReadJsonFile = vi.fn();
vi.mock('../lib/file_io', () => ({
  readJsonFile: (...args: unknown[]) => mockReadJsonFile(...args),
}));

const mockToSerializableConfig = vi.fn();
const mockApplyModelOverride = vi.fn();
vi.mock('./config', () => ({
  toSerializableConfig: (...args: unknown[]) =>
    mockToSerializableConfig(...args),
  applyModelOverride: (...args: unknown[]) => mockApplyModelOverride(...args),
}));

vi.mock('./file_utils', () => ({
  resolveAgentFilePath: (orgSlug: string, agentSlug: string) =>
    `${orgSlug}/${agentSlug}.json`,
  parseAgentJson: 'mock-parseAgentJson',
  MAX_FILE_SIZE_BYTES: 123,
}));

const { resolveAgentConfigInline } = await import('./resolve_agent_config');

function createCtx() {
  return {
    runQuery: vi.fn().mockImplementation((ref: string) => {
      if (ref === 'mock-getBindingByAgent') {
        return Promise.resolve({ teamId: 'team_1', knowledgeFiles: [] });
      }
      if (ref === 'mock-getOrganizationDefaultLocale') {
        return Promise.resolve('de');
      }
      return Promise.resolve(null);
    }),
    // Present so the test can assert it is NEVER used (the whole point of the
    // inline resolver is to avoid the resolveAgentConfig runAction hop).
    runAction: vi.fn(),
  };
}

describe('resolveAgentConfigInline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadJsonFile.mockResolvedValue({
      ok: true,
      data: {
        name: 'writer',
        systemInstructions: 'be terse',
        supportedModels: ['openrouter:gpt-4o', 'openrouter:claude'],
      },
    });
    mockToSerializableConfig.mockReturnValue({
      name: 'writer',
      model: 'openrouter:gpt-4o',
    });
  });

  it('reads config file + binding + locale and returns the inline result without a runAction hop', async () => {
    const ctx = createCtx();

    const result = await resolveAgentConfigInline(ctx as never, {
      orgSlug: 'acme',
      agentSlug: 'writer',
      organizationId: 'org_1',
    });

    // File read uses the derived path + injected size cap + parser.
    expect(mockReadJsonFile).toHaveBeenCalledWith(
      'acme/writer.json',
      123,
      'mock-parseAgentJson',
    );
    // Binding + locale resolved via queries...
    expect(ctx.runQuery).toHaveBeenCalledWith('mock-getBindingByAgent', {
      organizationId: 'org_1',
      agentSlug: 'writer',
    });
    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-getOrganizationDefaultLocale',
      { organizationId: 'org_1' },
    );
    // ...and NEVER via a resolveAgentConfig action dispatch.
    expect(ctx.runAction).not.toHaveBeenCalled();

    // Binding + locale are threaded into the serializable config builder.
    expect(mockToSerializableConfig).toHaveBeenCalledWith(
      'writer',
      expect.objectContaining({ name: 'writer' }),
      expect.objectContaining({ teamId: 'team_1' }),
      'de',
    );

    expect(result).toEqual({
      config: { name: 'writer', model: 'openrouter:gpt-4o' },
      supportedModels: ['openrouter:gpt-4o', 'openrouter:claude'],
      orgLocale: 'de',
    });
    // No explicit modelId → no override applied.
    expect(mockApplyModelOverride).not.toHaveBeenCalled();
  });

  it('starts the file read and both queries before any of them resolves (parallel, not serial)', async () => {
    const ctx = createCtx();
    let resolveFile: (v: unknown) => void = () => {};
    const started: string[] = [];

    mockReadJsonFile.mockImplementation(() => {
      started.push('file');
      return new Promise((res) => {
        resolveFile = res;
      });
    });
    ctx.runQuery.mockImplementation((ref: string) => {
      started.push(ref);
      return Promise.resolve(
        ref === 'mock-getOrganizationDefaultLocale'
          ? 'en'
          : { teamId: 'team_1' },
      );
    });

    const pending = resolveAgentConfigInline(ctx as never, {
      orgSlug: 'acme',
      agentSlug: 'writer',
      organizationId: 'org_1',
    });
    // All three I/O calls were kicked off before the (still-pending) file read
    // resolved — i.e. they run concurrently inside one Promise.all.
    await Promise.resolve();
    expect(started).toContain('file');
    expect(started).toContain('mock-getBindingByAgent');
    expect(started).toContain('mock-getOrganizationDefaultLocale');

    resolveFile({
      ok: true,
      data: { name: 'writer', supportedModels: ['openrouter:gpt-4o'] },
    });
    await pending;
  });

  it('applies the explicit model override against supportedModels when modelId is given', async () => {
    const ctx = createCtx();

    await resolveAgentConfigInline(ctx as never, {
      orgSlug: 'acme',
      agentSlug: 'writer',
      organizationId: 'org_1',
      modelId: 'openrouter:claude',
    });

    expect(mockApplyModelOverride).toHaveBeenCalledWith(
      { name: 'writer', model: 'openrouter:gpt-4o' },
      'openrouter:claude',
      ['openrouter:gpt-4o', 'openrouter:claude'],
    );
  });

  it('throws when the agent config file is unreadable', async () => {
    const ctx = createCtx();
    mockReadJsonFile.mockResolvedValue({ ok: false, message: 'ENOENT' });

    await expect(
      resolveAgentConfigInline(ctx as never, {
        orgSlug: 'acme',
        agentSlug: 'ghost',
        organizationId: 'org_1',
      }),
    ).rejects.toThrow('Agent not found: ghost');
  });
});

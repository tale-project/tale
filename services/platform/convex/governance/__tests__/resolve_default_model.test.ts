import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadPolicyConfig = vi.fn();
const mockCheckModelAccess = vi.fn();

vi.mock('../helpers', () => ({
  readPolicyConfig: (...args: unknown[]) => mockReadPolicyConfig(...args),
}));

vi.mock('../model_access_enforcement', () => ({
  checkModelAccess: (...args: unknown[]) => mockCheckModelAccess(...args),
}));

// Import after mocks
const { resolveDefaultModel } = await import('../resolve_default_model');

// Minimal ctx stub (only used to pass through to readPolicyConfig)
const ctx = {} as Parameters<typeof resolveDefaultModel>[0];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveDefaultModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: allow every model so existing scope-priority tests stay focused
    // on scope behavior. Access-check cases override this per test.
    mockCheckModelAccess.mockResolvedValue({ allowed: true });
  });

  it('returns null when no default_models policy exists', async () => {
    mockReadPolicyConfig.mockResolvedValue(null);

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-1'],
      'member',
    );

    expect(result).toBeNull();
    expect(mockReadPolicyConfig).toHaveBeenCalledWith(
      ctx,
      'org-1',
      'default_models',
    );
  });

  it('returns null when policy is disabled', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: false,
      rules: [
        {
          scope: 'default',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-1'],
      'member',
    );

    expect(result).toBeNull();
  });

  it('returns null when rules array is empty', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-1'],
      'member',
    );

    expect(result).toBeNull();
  });

  it('returns team-scoped rule when user belongs to that team', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'team',
          scopeId: 'team-engineering',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
        {
          scope: 'default',
          providerName: 'anthropic',
          modelId: 'claude-sonnet',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-engineering'],
      'member',
    );

    expect(result).toEqual({ providerName: 'openai', modelId: 'gpt-4o' });
  });

  it('team rule takes priority over role rule', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'anthropic',
          modelId: 'claude-opus',
        },
        {
          scope: 'team',
          scopeId: 'team-1',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
        {
          scope: 'default',
          providerName: 'google',
          modelId: 'gemini-pro',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-1'],
      'admin',
    );

    expect(result).toEqual({ providerName: 'openai', modelId: 'gpt-4o' });
  });

  it('role rule takes priority over default rule', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'role',
          scopeId: 'developer',
          providerName: 'anthropic',
          modelId: 'claude-sonnet',
        },
        {
          scope: 'default',
          providerName: 'openai',
          modelId: 'gpt-4o-mini',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-unrelated'],
      'developer',
    );

    expect(result).toEqual({
      providerName: 'anthropic',
      modelId: 'claude-sonnet',
    });
  });

  it('returns default rule when no team or role matches', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'team',
          scopeId: 'team-engineering',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'anthropic',
          modelId: 'claude-opus',
        },
        {
          scope: 'default',
          providerName: 'google',
          modelId: 'gemini-pro',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-marketing'],
      'member',
    );

    expect(result).toEqual({ providerName: 'google', modelId: 'gemini-pro' });
  });

  it('multi-team membership: first matching rule wins by rules array order', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'team',
          scopeId: 'team-b',
          providerName: 'anthropic',
          modelId: 'claude-sonnet',
        },
        {
          scope: 'team',
          scopeId: 'team-a',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-a', 'team-b'],
      'member',
    );

    expect(result).toEqual({
      providerName: 'anthropic',
      modelId: 'claude-sonnet',
    });
  });

  it('returns null when no userRole is provided and only role rules exist', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      [],
      undefined,
    );

    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Model-access cross-check (Layer 1)
  // -------------------------------------------------------------------------

  it('returns null when the resolved default is denied by model_access', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'default',
          providerName: 'openrouter',
          modelId: 'qwen/qwen3-vl-32b-instruct',
        },
      ],
    });
    mockCheckModelAccess.mockResolvedValue({
      allowed: false,
      reason: 'Model not in allowlist',
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      ['team-1'],
      'member',
    );

    expect(result).toBeNull();
    expect(mockCheckModelAccess).toHaveBeenCalledWith(
      ctx,
      'org-1',
      'user-1',
      ['team-1'],
      'member',
      'qwen/qwen3-vl-32b-instruct',
    );
  });

  it('returns the rule when the resolved default is allowed by model_access', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'default',
          providerName: 'openrouter',
          modelId: 'kimi-k2.5',
        },
      ],
    });
    mockCheckModelAccess.mockResolvedValue({ allowed: true });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      [],
      'member',
    );

    expect(result).toEqual({
      providerName: 'openrouter',
      modelId: 'kimi-k2.5',
    });
  });

  it('does not call checkModelAccess when no rule applies', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'role',
          scopeId: 'admin',
          providerName: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    });

    const result = await resolveDefaultModel(
      ctx,
      'org-1',
      'user-1',
      [],
      'member',
    );

    expect(result).toBeNull();
    expect(mockCheckModelAccess).not.toHaveBeenCalled();
  });
});

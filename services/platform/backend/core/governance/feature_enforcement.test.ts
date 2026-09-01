import { describe, it, expect, vi } from 'vitest';

const mockReadPolicyConfig = vi.fn();
vi.mock('./helpers', () => ({
  readPolicyConfig: (...args: unknown[]) => mockReadPolicyConfig(...args),
}));

const { resolveFeatureFlags } = await import('./feature_enforcement');

const mockCtx = {} as never;

describe('resolveFeatureFlags', () => {
  it('returns defaults when no policy exists', async () => {
    mockReadPolicyConfig.mockResolvedValue(null);

    const result = await resolveFeatureFlags(mockCtx, 'org_1', 'user_1', []);

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('returns defaults when policy is disabled', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: false,
      rules: [
        {
          scope: 'default',
          webSearch: false,
          maxContextTokens: 8192,
        },
      ],
    });

    const result = await resolveFeatureFlags(mockCtx, 'org_1', 'user_1', []);

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('returns defaults when rules array is empty', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [],
    });

    const result = await resolveFeatureFlags(mockCtx, 'org_1', 'user_1', []);

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('applies default rule when no specific rule matches', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'default',
          webSearch: false,
          maxContextTokens: 16384,
        },
      ],
    });

    const result = await resolveFeatureFlags(mockCtx, 'org_1', 'user_1', []);

    expect(result).toEqual({
      webSearch: false,
      codeExecution: true,
      fileUpload: true,
      maxContextTokens: 16384,
    });
  });

  it('user rule takes priority over team, role, and default', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        { scope: 'default', maxContextTokens: 65536 },
        { scope: 'role', scopeId: 'member', maxContextTokens: 32768 },
        { scope: 'team', scopeId: 'team_1', maxContextTokens: 16384 },
        { scope: 'user', scopeId: 'user_1', maxContextTokens: 8192 },
      ],
    });

    const result = await resolveFeatureFlags(
      mockCtx,
      'org_1',
      'user_1',
      ['team_1'],
      'member',
    );

    expect(result.maxContextTokens).toBe(8192);
  });

  it('team rule takes priority over role and default', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        { scope: 'default', maxContextTokens: 65536 },
        { scope: 'role', scopeId: 'member', maxContextTokens: 32768 },
        { scope: 'team', scopeId: 'team_1', maxContextTokens: 16384 },
      ],
    });

    const result = await resolveFeatureFlags(
      mockCtx,
      'org_1',
      'user_2',
      ['team_1'],
      'member',
    );

    expect(result.maxContextTokens).toBe(16384);
  });

  it('role rule takes priority over default', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        { scope: 'default', maxContextTokens: 65536 },
        { scope: 'role', scopeId: 'admin', maxContextTokens: 131072 },
      ],
    });

    const result = await resolveFeatureFlags(
      mockCtx,
      'org_1',
      'user_2',
      [],
      'admin',
    );

    expect(result.maxContextTokens).toBe(131072);
  });

  it('partial rule merges with defaults for missing fields', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'user',
          scopeId: 'user_1',
          webSearch: false,
        },
      ],
    });

    const result = await resolveFeatureFlags(mockCtx, 'org_1', 'user_1', []);

    expect(result).toEqual({
      webSearch: false,
      codeExecution: true,
      fileUpload: true,
      maxContextTokens: undefined,
    });
  });

  it('resolves maxContextTokens from matching rule', async () => {
    mockReadPolicyConfig.mockResolvedValue({
      enabled: true,
      rules: [
        {
          scope: 'default',
          maxContextTokens: 32768,
          webSearch: true,
          codeExecution: true,
          fileUpload: true,
        },
      ],
    });

    const result = await resolveFeatureFlags(mockCtx, 'org_1', 'user_1', []);

    expect(result.maxContextTokens).toBe(32768);
  });
});

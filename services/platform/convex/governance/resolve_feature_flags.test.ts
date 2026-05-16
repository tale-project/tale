import { describe, it, expect, vi, beforeEach } from 'vitest';

import type {
  FeatureFlagsConfig,
  FeatureFlagRule,
} from '../../lib/shared/schemas/governance';

vi.mock('./helpers', () => ({
  readPolicyConfig: vi.fn(),
}));

const { readPolicyConfig } = await import('./helpers');
const mockedReadPolicyConfig = vi.mocked(readPolicyConfig);

const { resolveFeatureFlags } = await import('./feature_enforcement');

function createMockCtx() {
  return {
    db: {
      query: vi.fn(),
    },
    auth: {
      getUserIdentity: vi.fn(),
    },
  } as never;
}

describe('resolveFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all-enabled defaults when no policy exists', async () => {
    mockedReadPolicyConfig.mockResolvedValue(null);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('returns all-enabled defaults when policy is disabled', async () => {
    const config: FeatureFlagsConfig = {
      enabled: false,
      rules: [{ scope: 'default', webSearch: false, codeExecution: false }],
    };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('returns all-enabled defaults when rules array is empty', async () => {
    const config: FeatureFlagsConfig = {
      enabled: true,
      rules: [],
    };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('applies default-scope rule when no more specific rule matches', async () => {
    const config: FeatureFlagsConfig = {
      enabled: true,
      rules: [
        {
          scope: 'default',
          webSearch: false,
          codeExecution: true,
          fileUpload: true,
        },
      ],
    };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result.webSearch).toBe(false);
    expect(result.codeExecution).toBe(true);
    expect(result.fileUpload).toBe(true);
  });

  it('user-scope rule overrides team-scope rule', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'team', scopeId: 'team_1', webSearch: false },
      { scope: 'user', scopeId: 'user_1', webSearch: true },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      ['team_1'],
      'member',
    );

    expect(result.webSearch).toBe(true);
  });

  it('team-scope rule overrides role-scope rule', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'role', scopeId: 'member', webSearch: true },
      { scope: 'team', scopeId: 'team_1', webSearch: false },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_2',
      ['team_1'],
      'member',
    );

    expect(result.webSearch).toBe(false);
  });

  it('role-scope rule overrides default rule', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'default', webSearch: true },
      { scope: 'role', scopeId: 'member', webSearch: false },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result.webSearch).toBe(false);
  });

  it('partial rule preserves defaults for unset fields', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'user', scopeId: 'user_1', webSearch: false },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result.webSearch).toBe(false);
    expect(result.codeExecution).toBe(true);
    expect(result.fileUpload).toBe(true);
    expect(result.maxContextTokens).toBeUndefined();
  });

  it('passes through maxContextTokens from the matching rule', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'user', scopeId: 'user_1', maxContextTokens: 50000 },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result.maxContextTokens).toBe(50000);
  });

  it('returns defaults when no rules match the user', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'user', scopeId: 'user_other', webSearch: false },
      { scope: 'team', scopeId: 'team_other', codeExecution: false },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result).toEqual({
      webSearch: true,
      codeExecution: true,
      fileUpload: true,
    });
  });

  it('handles all features disabled for a user', async () => {
    const rules: FeatureFlagRule[] = [
      {
        scope: 'user',
        scopeId: 'user_1',
        webSearch: false,
        codeExecution: false,
        fileUpload: false,
        maxContextTokens: 10000,
      },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      'member',
    );

    expect(result).toEqual({
      webSearch: false,
      codeExecution: false,
      fileUpload: false,
      maxContextTokens: 10000,
    });
  });

  it('matches team rule when user belongs to multiple teams', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'team', scopeId: 'team_2', webSearch: false },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      ['team_1', 'team_2', 'team_3'],
      'member',
    );

    expect(result.webSearch).toBe(false);
  });

  it('skips role rule when role is not provided', async () => {
    const rules: FeatureFlagRule[] = [
      { scope: 'role', scopeId: 'admin', webSearch: false },
      { scope: 'default', webSearch: true },
    ];
    const config: FeatureFlagsConfig = { enabled: true, rules };
    mockedReadPolicyConfig.mockResolvedValue(config);
    const ctx = createMockCtx();

    const result = await resolveFeatureFlags(
      ctx,
      'org_1',
      'user_1',
      [],
      undefined,
    );

    expect(result.webSearch).toBe(true);
  });
});

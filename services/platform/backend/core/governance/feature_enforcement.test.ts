import { describe, expect, it } from 'vitest';

import { evaluateFeatureFlags } from './feature_enforcement';

const WHO = { userId: 'user_1', teamIds: [] as string[] };

describe('evaluateFeatureFlags', () => {
  it('applies no cap when no policy exists', () => {
    expect(evaluateFeatureFlags(null, WHO)).toEqual({});
  });

  it('applies no cap when the policy is disabled', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: false,
        rules: [{ scope: 'default', maxContextTokens: 8192 }],
      },
      WHO,
    );
    expect(result).toEqual({});
  });

  it('applies no cap when the rules array is empty', () => {
    expect(evaluateFeatureFlags({ enabled: true, rules: [] }, WHO)).toEqual({});
  });

  it('applies the default rule when no specific rule matches', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: true,
        rules: [{ scope: 'default', maxContextTokens: 16384 }],
      },
      WHO,
    );
    expect(result).toEqual({ maxContextTokens: 16384 });
  });

  it('user rule takes priority over team, role, and default', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: true,
        rules: [
          { scope: 'default', maxContextTokens: 65536 },
          { scope: 'role', scopeId: 'member', maxContextTokens: 32768 },
          { scope: 'team', scopeId: 'team_1', maxContextTokens: 16384 },
          { scope: 'user', scopeId: 'user_1', maxContextTokens: 8192 },
        ],
      },
      { userId: 'user_1', teamIds: ['team_1'], role: 'member' },
    );
    expect(result.maxContextTokens).toBe(8192);
  });

  it('team rule takes priority over role and default', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: true,
        rules: [
          { scope: 'default', maxContextTokens: 65536 },
          { scope: 'role', scopeId: 'member', maxContextTokens: 32768 },
          { scope: 'team', scopeId: 'team_1', maxContextTokens: 16384 },
        ],
      },
      { userId: 'user_2', teamIds: ['team_1'], role: 'member' },
    );
    expect(result.maxContextTokens).toBe(16384);
  });

  it('role rule takes priority over default', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: true,
        rules: [
          { scope: 'default', maxContextTokens: 65536 },
          { scope: 'role', scopeId: 'admin', maxContextTokens: 131072 },
        ],
      },
      { userId: 'user_2', teamIds: [], role: 'admin' },
    );
    expect(result.maxContextTokens).toBe(131072);
  });

  // The webSearch / codeExecution / fileUpload toggles were never enforced
  // anywhere and are retired; a policy file written by an earlier release may
  // still carry them, and they must resolve to nothing — not reappear on the
  // wire as controls that do nothing.
  it('ignores the deprecated toggles a rule may still carry', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: true,
        rules: [
          {
            scope: 'user',
            scopeId: 'user_1',
            webSearch: false,
            codeExecution: false,
            fileUpload: false,
          },
        ],
      },
      WHO,
    );
    expect(result).toEqual({});
    expect(result).not.toHaveProperty('webSearch');
    expect(result).not.toHaveProperty('codeExecution');
    expect(result).not.toHaveProperty('fileUpload');
  });

  it('resolves maxContextTokens from the matching rule', () => {
    const result = evaluateFeatureFlags(
      {
        enabled: true,
        rules: [{ scope: 'default', maxContextTokens: 32768 }],
      },
      WHO,
    );
    expect(result.maxContextTokens).toBe(32768);
  });
});

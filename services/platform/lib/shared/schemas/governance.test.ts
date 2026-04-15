import { describe, it, expect } from 'vitest';

import {
  DEFAULT_PASSWORD_POLICY,
  featureFlagRuleSchema,
  featureFlagsConfigSchema,
  mergeStrictestPasswordPolicy,
  passwordPolicyConfigSchema,
} from './governance';

describe('featureFlagRuleSchema — maxContextTokens validation', () => {
  it('accepts valid maxContextTokens at minimum floor (4096)', () => {
    const result = featureFlagRuleSchema.safeParse({
      scope: 'default',
      maxContextTokens: 4096,
    });
    expect(result.success).toBe(true);
  });

  it('accepts maxContextTokens above minimum floor', () => {
    const result = featureFlagRuleSchema.safeParse({
      scope: 'default',
      maxContextTokens: 32768,
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxContextTokens below minimum floor (4096)', () => {
    const result = featureFlagRuleSchema.safeParse({
      scope: 'default',
      maxContextTokens: 2048,
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero maxContextTokens', () => {
    const result = featureFlagRuleSchema.safeParse({
      scope: 'default',
      maxContextTokens: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative maxContextTokens', () => {
    const result = featureFlagRuleSchema.safeParse({
      scope: 'default',
      maxContextTokens: -1000,
    });
    expect(result.success).toBe(false);
  });

  it('accepts rule without maxContextTokens (optional)', () => {
    const result = featureFlagRuleSchema.safeParse({
      scope: 'user',
      scopeId: 'user_1',
      webSearch: false,
    });
    expect(result.success).toBe(true);
  });
});

describe('featureFlagsConfigSchema', () => {
  it('validates a complete config', () => {
    const result = featureFlagsConfigSchema.safeParse({
      enabled: true,
      rules: [
        {
          scope: 'default',
          webSearch: true,
          codeExecution: true,
          fileUpload: true,
          maxContextTokens: 65536,
        },
        {
          scope: 'user',
          scopeId: 'user_1',
          maxContextTokens: 8192,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects config with invalid rule', () => {
    const result = featureFlagsConfigSchema.safeParse({
      enabled: true,
      rules: [
        {
          scope: 'default',
          maxContextTokens: 1000,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('passwordPolicyConfigSchema', () => {
  it('parses an empty object to built-in defaults', () => {
    const result = passwordPolicyConfigSchema.parse({});
    expect(result).toEqual({
      minLength: 8,
      requireUpper: true,
      requireLower: true,
      requireDigit: true,
      requireSpecial: true,
      rotationDays: 0,
    });
  });

  it('rejects minLength below 6', () => {
    expect(passwordPolicyConfigSchema.safeParse({ minLength: 5 }).success).toBe(
      false,
    );
  });

  it('rejects rotationDays outside [0, 3650]', () => {
    expect(
      passwordPolicyConfigSchema.safeParse({ rotationDays: -1 }).success,
    ).toBe(false);
    expect(
      passwordPolicyConfigSchema.safeParse({ rotationDays: 3651 }).success,
    ).toBe(false);
  });
});

describe('mergeStrictestPasswordPolicy', () => {
  const strict = {
    ...DEFAULT_PASSWORD_POLICY,
    minLength: 16,
    rotationDays: 30,
  };
  const relaxed = {
    ...DEFAULT_PASSWORD_POLICY,
    minLength: 8,
    requireSpecial: false,
    rotationDays: 90,
  };

  it('returns defaults when policies is empty', () => {
    expect(mergeStrictestPasswordPolicy([])).toEqual(DEFAULT_PASSWORD_POLICY);
  });

  it('picks the longest minLength', () => {
    expect(mergeStrictestPasswordPolicy([strict, relaxed]).minLength).toBe(16);
  });

  it('ORs each require flag (strict wins)', () => {
    const merged = mergeStrictestPasswordPolicy([strict, relaxed]);
    expect(merged.requireSpecial).toBe(true);
  });

  it('picks shortest positive rotationDays', () => {
    expect(mergeStrictestPasswordPolicy([strict, relaxed]).rotationDays).toBe(
      30,
    );
  });

  it('treats rotationDays=0 as disabled (ignores it when another is set)', () => {
    const disabled = { ...DEFAULT_PASSWORD_POLICY, rotationDays: 0 };
    expect(mergeStrictestPasswordPolicy([disabled, relaxed]).rotationDays).toBe(
      90,
    );
  });

  it('keeps rotationDays=0 when all policies disable it', () => {
    expect(
      mergeStrictestPasswordPolicy([
        { ...DEFAULT_PASSWORD_POLICY, rotationDays: 0 },
        { ...DEFAULT_PASSWORD_POLICY, rotationDays: 0 },
      ]).rotationDays,
    ).toBe(0);
  });
});

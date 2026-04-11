import { describe, it, expect } from 'vitest';

import { featureFlagRuleSchema, featureFlagsConfigSchema } from './governance';

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

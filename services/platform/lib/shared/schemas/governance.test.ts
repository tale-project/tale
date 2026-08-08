import { describe, it, expect } from 'vitest';

import {
  DEFAULT_PASSWORD_POLICY,
  effectiveMandatoryInstructions,
  featureFlagRuleSchema,
  featureFlagsConfigSchema,
  mergeStrictestPasswordPolicy,
  moderationProviderConfigSchema,
  passwordPolicyConfigSchema,
  POLICY_SCHEMAS,
  reviewPolicyConfigSchema,
  visionModelConfigSchema,
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

// #2657: disabling the moderation provider must not re-validate the
// endpoint/template/custom-jsonpath fields it is turning off.
describe('moderationProviderConfigSchema — validate-on-disable (#2657)', () => {
  const unconfiguredEndpoint = {
    url: '',
    method: 'POST',
    headers: {},
    requestTemplate: '',
    timeoutMs: 3000,
    maxResponseBytes: 262_144,
    bufferPolicy: {
      minFlushChars: 120,
      maxBufferChars: 800,
      idleFlushMs: 400,
      perStreamMaxConcurrent: 2,
    },
  };
  const baseConfig = {
    enabled: false,
    appliesTo: ['input'],
    endpoint: unconfiguredEndpoint,
    responseShape: { type: 'openai_moderation' },
    categoryMappings: [],
    failBehavior: { input: 'open', output: 'closed' },
    configVersion: 1,
  };

  it('accepts enabled:false with a blank/unconfigured endpoint', () => {
    const result = moderationProviderConfigSchema.safeParse(baseConfig);
    expect(result.success).toBe(true);
  });

  it('accepts enabled:false with a custom_jsonpath draft missing categoriesPath', () => {
    const result = moderationProviderConfigSchema.safeParse({
      ...baseConfig,
      responseShape: {
        type: 'custom_jsonpath',
        categoriesPath: '',
        categoryShape: 'record_of_bool',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects enabled:true with a blank endpoint URL', () => {
    const result = moderationProviderConfigSchema.safeParse({
      ...baseConfig,
      enabled: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts enabled:true with a valid endpoint + request template', () => {
    const result = moderationProviderConfigSchema.safeParse({
      ...baseConfig,
      enabled: true,
      endpoint: {
        ...unconfiguredEndpoint,
        url: 'https://moderation.example.com/check',
        requestTemplate: '{"text": {{text}}}',
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('passwordPolicyConfigSchema', () => {
  it('parses an empty object to built-in defaults', () => {
    const result = passwordPolicyConfigSchema.parse({});
    expect(result).toEqual({
      // Production-secure default: 12-char floor (see schema comment).
      minLength: 12,
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

describe('system_prompt policy — mandatoryInstructions cutover', () => {
  const schema = POLICY_SCHEMAS.system_prompt;

  it('still parses pre-cutover files carrying only the legacy pair', () => {
    const result = schema.safeParse({
      mandatoryPrefixPrompt: 'Be terse.',
      mandatorySuffixPrompt: 'Cite sources.',
    });
    expect(result.success).toBe(true);
  });

  it('parses the unified field, alone or alongside the legacy pair', () => {
    expect(
      schema.safeParse({ mandatoryInstructions: 'Be terse.' }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        mandatoryInstructions: 'Be terse.',
        mandatoryPrefixPrompt: 'old prefix',
        mandatorySuffixPrompt: 'old suffix',
      }).success,
    ).toBe(true);
  });

  it('effectiveMandatoryInstructions prefers the unified field', () => {
    expect(
      effectiveMandatoryInstructions({
        mandatoryInstructions: '  Unified wins.  ',
        mandatoryPrefixPrompt: 'ignored prefix',
        mandatorySuffixPrompt: 'ignored suffix',
      }),
    ).toBe('Unified wins.');
  });

  it('falls back to prefix + blank line + suffix', () => {
    expect(
      effectiveMandatoryInstructions({
        mandatoryPrefixPrompt: 'Be terse. ',
        mandatorySuffixPrompt: ' Cite sources.',
      }),
    ).toBe('Be terse.\n\nCite sources.');
  });

  it('uses whichever legacy side is present when the other is empty', () => {
    expect(
      effectiveMandatoryInstructions({ mandatoryPrefixPrompt: 'Prefix only.' }),
    ).toBe('Prefix only.');
    expect(
      effectiveMandatoryInstructions({
        mandatoryPrefixPrompt: '   ',
        mandatorySuffixPrompt: 'Suffix only.',
      }),
    ).toBe('Suffix only.');
  });

  it('treats a whitespace-only unified field as absent', () => {
    expect(
      effectiveMandatoryInstructions({
        mandatoryInstructions: '   ',
        mandatorySuffixPrompt: 'Suffix.',
      }),
    ).toBe('Suffix.');
  });

  it('returns undefined when the policy carries no text at all', () => {
    expect(effectiveMandatoryInstructions({})).toBeUndefined();
    expect(
      effectiveMandatoryInstructions({
        mandatoryPrefixPrompt: '',
        mandatorySuffixPrompt: '  ',
      }),
    ).toBeUndefined();
  });
});

describe('visionModelConfigSchema', () => {
  it('accepts the empty config — a missing file and Auto mean the same thing', () => {
    const parsed = visionModelConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({});
  });

  it('round-trips a pinned provider/model pair', () => {
    expect(
      visionModelConfigSchema.parse({
        providerSlug: 'openrouter',
        modelId: 'qwen/qwen3-vl-32b-instruct',
      }),
    ).toEqual({
      providerSlug: 'openrouter',
      modelId: 'qwen/qwen3-vl-32b-instruct',
    });
  });

  it('rejects half a pin — neither side can be routed alone', () => {
    expect(
      visionModelConfigSchema.safeParse({ providerSlug: 'openrouter' }).success,
    ).toBe(false);
    expect(
      visionModelConfigSchema.safeParse({ modelId: 'some/model' }).success,
    ).toBe(false);
  });

  it('rejects empty strings, which would route nowhere', () => {
    expect(
      visionModelConfigSchema.safeParse({ providerSlug: '', modelId: '' })
        .success,
    ).toBe(false);
  });

  it('is registered as the vision_model policy schema', () => {
    expect(POLICY_SCHEMAS.vision_model).toBe(visionModelConfigSchema);
  });
});

describe('reviewPolicyConfigSchema', () => {
  it('accepts the empty config — a missing file and no requirement mean the same thing', () => {
    const parsed = reviewPolicyConfigSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({});
  });

  it('round-trips both requirements', () => {
    expect(
      reviewPolicyConfigSchema.parse({
        requireIndependentReviewer: true,
        requiredCompetences: ['vat-review', 'iso-audit'],
      }),
    ).toEqual({
      requireIndependentReviewer: true,
      requiredCompetences: ['vat-review', 'iso-audit'],
    });
  });

  it('rejects malformed shapes — the reader falls back to absent', () => {
    expect(
      reviewPolicyConfigSchema.safeParse({ requiredCompetences: 'vat-review' })
        .success,
    ).toBe(false);
    expect(
      reviewPolicyConfigSchema.safeParse({ requiredCompetences: [''] }).success,
    ).toBe(false);
  });

  it('is registered as the review_policy policy schema', () => {
    expect(POLICY_SCHEMAS.review_policy).toBe(reviewPolicyConfigSchema);
  });
});

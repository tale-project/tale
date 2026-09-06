import { describe, it, expect } from 'vitest';

import {
  uploadPolicyConfigSchema,
  retentionPolicyConfigSchema,
  piiConfigSchema,
} from './governance';

describe('uploadPolicyConfigSchema', () => {
  it('accepts a valid full config', () => {
    const result = uploadPolicyConfigSchema.safeParse({
      enabled: true,
      allowedExtensions: ['pdf', 'png'],
      blockedExtensions: ['exe'],
      allowedMimeTypes: ['image/*'],
      maxFileSizeBytes: 10_000_000,
      maxTotalVolumeBytesPerUser: 1_000_000_000,
    });

    expect(result.success).toBe(true);
  });

  it('accepts minimal config with only enabled field', () => {
    const result = uploadPolicyConfigSchema.safeParse({ enabled: false });

    expect(result.success).toBe(true);
  });

  it('rejects config without enabled field', () => {
    const result = uploadPolicyConfigSchema.safeParse({
      allowedExtensions: ['pdf'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative maxFileSizeBytes', () => {
    const result = uploadPolicyConfigSchema.safeParse({
      enabled: true,
      maxFileSizeBytes: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative maxTotalVolumeBytesPerUser', () => {
    const result = uploadPolicyConfigSchema.safeParse({
      enabled: true,
      maxTotalVolumeBytesPerUser: -100,
    });

    expect(result.success).toBe(false);
  });
});

describe('retentionPolicyConfigSchema', () => {
  it('accepts a valid full config', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      documentsEnabled: true,
      documentsRetentionDays: 90,
      batchSize: 50,
      userTempEnabled: true,
      userTempRetentionHours: 24,
      agentTempEnabled: false,
      agentTempRetentionHours: 48,
    });

    expect(result.success).toBe(true);
  });

  it('accepts minimal config with only documentsRetentionDays (policy-level enabled lives on the row, not the payload)', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      documentsRetentionDays: 30,
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty config (all category fields are optional after the rename refactor)', () => {
    const result = retentionPolicyConfigSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('rejects negative documentsRetentionDays', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      documentsRetentionDays: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative batchSize', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      documentsRetentionDays: 30,
      batchSize: -1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts config with temp file settings', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      documentsRetentionDays: 30,
      userTempEnabled: true,
      userTempRetentionHours: 12,
    });

    expect(result.success).toBe(true);
  });

  it('rejects negative temp retention hours', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      documentsRetentionDays: 30,
      agentTempRetentionHours: -5,
    });

    expect(result.success).toBe(false);
  });
});

describe('piiConfigSchema customPattern ReDoS guard (S-02)', () => {
  // The Round 2 review measured `(a+)+b` running ~12 seconds against 28 'a's
  // — far past `execWithBudget`'s 50ms cap (which only checks between
  // `exec()` calls, never within one). `safe-regex2` AST-validates the
  // pattern at save-time and rejects nested-quantifier shapes.
  const baseConfig = {
    enabled: true,
    mode: 'mask' as const,
    enabledPatterns: ['email'],
  };

  it('accepts a benign pattern', () => {
    const result = piiConfigSchema.safeParse({
      ...baseConfig,
      customPatterns: [
        { name: 'ssn', regex: '\\d{3}-\\d{2}-\\d{4}', replacement: '[SSN]' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects nested-quantifier ReDoS shape "(a+)+b"', () => {
    const result = piiConfigSchema.safeParse({
      ...baseConfig,
      customPatterns: [{ name: 'redos', regex: '(a+)+b', replacement: '[X]' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects "(a|a?)+" optional-overlap ReDoS', () => {
    const result = piiConfigSchema.safeParse({
      ...baseConfig,
      customPatterns: [
        { name: 'redos3', regex: '(a|a?)+', replacement: '[X]' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects syntactically invalid regex (existing contract)', () => {
    const result = piiConfigSchema.safeParse({
      ...baseConfig,
      customPatterns: [
        { name: 'broken', regex: '[unclosed', replacement: '[X]' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

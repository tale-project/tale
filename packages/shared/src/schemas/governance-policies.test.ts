import { describe, it, expect } from 'vitest';

import {
  chatToolsConfigSchema,
  DEFAULT_CHAT_TOOLS,
  DEFAULT_SANDBOX_WORKSPACES,
  POLICY_SCHEMAS,
  sandboxWorkspacesConfigSchema,
  uploadPolicyConfigSchema,
  retentionPolicyConfigSchema,
  piiConfigSchema,
  sandboxQuotaConfigSchema,
  sandboxQuotaTotal,
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

describe('chatToolsConfigSchema', () => {
  it('reads a missing file and a missing switch as on', () => {
    expect(DEFAULT_CHAT_TOOLS).toEqual({
      files: true,
      skills: true,
      code: true,
    });
    expect(chatToolsConfigSchema.parse({ code: false })).toEqual({
      files: true,
      skills: true,
      code: false,
    });
  });

  it('refuses an unknown switch or a non-boolean value', () => {
    expect(chatToolsConfigSchema.safeParse({ images: false }).success).toBe(
      false,
    );
    expect(chatToolsConfigSchema.safeParse({ code: 'no' }).success).toBe(false);
  });

  it('is the chat_tools policy type', () => {
    expect(POLICY_SCHEMAS.chat_tools).toBe(chatToolsConfigSchema);
  });
});

describe('sandboxQuotaConfigSchema — light sandboxes', () => {
  it('defaults the chat light sandbox limit to 2 and counts it in the total', () => {
    const config = sandboxQuotaConfigSchema.parse({});
    expect(config.maxLightSessionsPerOrg).toBe(2);
    expect(sandboxQuotaTotal(config)).toBe(8);
    expect(sandboxQuotaTotal({ ...config, maxLightSessionsPerOrg: 5 })).toBe(
      11,
    );
  });
});

describe('sandboxWorkspacesConfigSchema — size and disk space', () => {
  it('reclaims idle workspaces while the disk runs short, after 24 idle hours, with no size cap, unless the organization set otherwise', () => {
    expect(DEFAULT_SANDBOX_WORKSPACES).toEqual({
      deleteUnused: true,
      unusedDays: 30,
      reclaimOnDiskPressure: true,
      reclaimMinIdleHours: 24,
    });
    expect('maxWorkspaceGiB' in DEFAULT_SANDBOX_WORKSPACES).toBe(false);
  });

  it('reads a file written before the size and disk fields existed with their defaults', () => {
    expect(
      sandboxWorkspacesConfigSchema.parse({
        deleteUnused: false,
        unusedDays: 90,
      }),
    ).toEqual({
      deleteUnused: false,
      unusedDays: 90,
      reclaimOnDiskPressure: true,
      reclaimMinIdleHours: 24,
    });
  });

  it('keeps a cap and the switches as set', () => {
    expect(
      sandboxWorkspacesConfigSchema.parse({
        reclaimOnDiskPressure: false,
        maxWorkspaceGiB: 30,
        reclaimMinIdleHours: 6,
      }),
    ).toEqual({
      deleteUnused: true,
      unusedDays: 30,
      reclaimOnDiskPressure: false,
      maxWorkspaceGiB: 30,
      reclaimMinIdleHours: 6,
    });
  });

  it.each([
    { maxWorkspaceGiB: 0 },
    { maxWorkspaceGiB: 10_241 },
    { maxWorkspaceGiB: 2.5 },
    { maxWorkspaceGiB: '30g' },
    { maxWorkspaceGiB: null },
    { reclaimMinIdleHours: 0 },
    { reclaimMinIdleHours: 8761 },
    { reclaimMinIdleHours: 1.5 },
    { reclaimOnDiskPressure: 'yes' },
  ])('refuses %j', (config) => {
    expect(sandboxWorkspacesConfigSchema.safeParse(config).success).toBe(false);
  });

  it.each([
    { maxWorkspaceGiB: 1 },
    { maxWorkspaceGiB: 10_240 },
    { reclaimMinIdleHours: 1 },
    { reclaimMinIdleHours: 8760 },
  ])('accepts %j', (config) => {
    expect(sandboxWorkspacesConfigSchema.safeParse(config).success).toBe(true);
  });

  it('is the sandbox_workspaces policy type', () => {
    expect(POLICY_SCHEMAS.sandbox_workspaces).toBe(
      sandboxWorkspacesConfigSchema,
    );
  });
});

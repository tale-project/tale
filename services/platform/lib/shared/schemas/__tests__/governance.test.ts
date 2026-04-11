import { describe, it, expect } from 'vitest';

import {
  uploadPolicyConfigSchema,
  retentionPolicyConfigSchema,
} from '../governance';

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
      enabled: true,
      retentionDays: 90,
      scope: 'upload',
      batchSize: 50,
    });

    expect(result.success).toBe(true);
  });

  it('accepts minimal config with enabled and retentionDays', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      enabled: true,
      retentionDays: 30,
    });

    expect(result.success).toBe(true);
  });

  it('rejects config without retentionDays', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      enabled: true,
    });

    expect(result.success).toBe(false);
  });

  it('rejects negative retentionDays', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      enabled: true,
      retentionDays: -1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid scope value', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      enabled: true,
      retentionDays: 30,
      scope: 'invalid',
    });

    expect(result.success).toBe(false);
  });

  it('accepts scope all', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      enabled: true,
      retentionDays: 30,
      scope: 'all',
    });

    expect(result.success).toBe(true);
  });

  it('accepts scope agent', () => {
    const result = retentionPolicyConfigSchema.safeParse({
      enabled: true,
      retentionDays: 90,
      scope: 'agent',
    });

    expect(result.success).toBe(true);
  });
});

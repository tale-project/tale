import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type AppliedBoundsByCategory,
  RETENTION_CATEGORIES,
  canonicalizeAppliedBounds,
  hashAppliedBounds,
  retentionBoundDefSchema,
  retentionDefaultsConfigSchema,
  retentionRootMetadataSchema,
} from '../retention';

describe('retentionBoundDefSchema', () => {
  it('accepts valid bounds', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 30,
      max: 365,
      default: 90,
      unit: 'days',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative numbers', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: -1,
      max: 365,
      default: 90,
      unit: 'days',
    });
    expect(result.success).toBe(false);
  });

  it('rejects min > max', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 100,
      max: 50,
      default: 75,
      unit: 'days',
    });
    expect(result.success).toBe(false);
  });

  it('rejects default outside [min, max]', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 30,
      max: 365,
      default: 1000,
      unit: 'days',
    });
    expect(result.success).toBe(false);
  });

  it('accepts equal min/max/default', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 30,
      max: 30,
      default: 30,
      unit: 'days',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing unit', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 30,
      max: 365,
      default: 90,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unit value outside the enum', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 30,
      max: 365,
      default: 90,
      unit: 'minutes',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const result = retentionBoundDefSchema.safeParse({
      min: 30,
      max: 365,
      default: 90,
      unit: 'days',
      _metadata: { label: 'should not be accepted' },
    });
    expect(result.success).toBe(false);
  });
});

describe('retentionDefaultsConfigSchema', () => {
  it('accepts examples/retention/default.json (every category + root envPrefix + full envNames map)', () => {
    // Resolve from this test's directory up to repo root, then to examples/.
    // __dirname is services/platform/lib/shared/schemas/__tests__/
    const examplePath = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'examples',
      'retention',
      'default.json',
    );
    const content = readFileSync(examplePath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = retentionDefaultsConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `default.json failed validation: ${result.error.message}`,
      );
    }
    // Strict drift check: factory file declares every category and the
    // root `_metadata.envNames` map covers every (category × field)
    // pair (16 × 3 = 48 entries). Adding a new category to
    // RETENTION_CATEGORIES without updating examples/retention/default.json
    // fails one of these assertions loudly.
    expect(typeof parsed._metadata?.envPrefix).toBe('string');
    expect(parsed._metadata.envPrefix.length).toBeGreaterThan(0);
    const envNames = parsed._metadata.envNames as Record<string, string>;
    expect(typeof envNames).toBe('object');
    const paths = new Set(Object.values(envNames));
    expect(paths.size).toBe(RETENTION_CATEGORIES.length * 3);
    for (const cat of RETENTION_CATEGORIES) {
      expect(parsed[cat]).toBeDefined();
      for (const field of ['min', 'max', 'default'] as const) {
        expect(paths.has(`${cat}.${field}`)).toBe(true);
      }
    }
  });

  it('accepts a partial subset (one category)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object (refine: at least one category)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects unknown category names', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
      typoCategory: { min: 1, max: 100, default: 50, unit: 'days' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed bound def (missing field)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      auditLog: { min: 365, max: 3650, unit: 'days' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a category without per-category metadata (descriptor lives in TS)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a category with a per-category _metadata block (descriptor moved to TS)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      auditLog: {
        min: 365,
        max: 3650,
        default: 730,
        unit: 'days',
        _metadata: { label: 'rejected' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts root _metadata with envPrefix + envNames + at least one category', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      _metadata: {
        envPrefix: 'TALE_RETENTION_',
        envNames: {
          AUDIT_MIN: 'auditLog.min',
          AUDIT_MAX: 'auditLog.max',
          AUDIT_DEFAULT: 'auditLog.default',
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unit that disagrees with category id convention (auditLog must be days)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      auditLog: { min: 365, max: 3650, default: 730, unit: 'hours' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unit that disagrees with category id convention (userTempHours must be hours)', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      userTempHours: { min: 1, max: 720, default: 24, unit: 'days' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects root _metadata with no category present', () => {
    const result = retentionDefaultsConfigSchema.safeParse({
      _metadata: { envPrefix: 'TALE_RETENTION_' },
    });
    expect(result.success).toBe(false);
  });
});

describe('retentionRootMetadataSchema', () => {
  it('accepts a full envPrefix + envNames declaration', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envPrefix: 'TALE_RETENTION_',
      envNames: {
        AUDIT_MIN: 'auditLog.min',
        AUDIT_MAX: 'auditLog.max',
        AUDIT_DEFAULT: 'auditLog.default',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty metadata block (both fields optional)', () => {
    const result = retentionRootMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts envNames with no envPrefix (suffix keys are full env names)', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envNames: { AUDIT_MIN: 'auditLog.min' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects lowercase env-name suffix keys', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envPrefix: 'TALE_RETENTION_',
      envNames: { audit_min: 'auditLog.min' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects path that does not resolve to a known category.field', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envPrefix: 'TALE_RETENTION_',
      envNames: { TALE_X: 'nonexistent.field' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects path with unknown bound field', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envPrefix: 'TALE_RETENTION_',
      envNames: { TALE_X: 'auditLog.median' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects envPrefix + suffix combined length over 40 chars', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envPrefix: 'A_VERY_LONG_PREFIX_FOR_SURE___',
      envNames: { AN_ALSO_LONG_SUFFIX_KEY: 'auditLog.min' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown root metadata keys (strict)', () => {
    const result = retentionRootMetadataSchema.safeParse({
      envPrefix: 'TALE_RETENTION_',
      label: 'not-allowed-at-root',
    });
    expect(result.success).toBe(false);
  });
});

describe('canonicalizeAppliedBounds', () => {
  it('produces stable output regardless of category insertion order', () => {
    const a: AppliedBoundsByCategory = {
      auditLog: { min: 365, max: 3650 },
      documents: { min: 30, max: 3650 },
    };
    const b: AppliedBoundsByCategory = {
      documents: { min: 30, max: 3650 },
      auditLog: { min: 365, max: 3650 },
    };
    expect(canonicalizeAppliedBounds(a)).toBe(canonicalizeAppliedBounds(b));
  });

  it('produces stable output regardless of field order within a bound', () => {
    // Object literal key order is preserved in V8, so we exercise via
    // Object.fromEntries with intentionally swapped pairs.
    const a: AppliedBoundsByCategory = {
      auditLog: Object.fromEntries([
        ['min', 365],
        ['max', 3650],
      ]) as { min: number; max: number },
    };
    const b: AppliedBoundsByCategory = {
      auditLog: Object.fromEntries([
        ['max', 3650],
        ['min', 365],
      ]) as { min: number; max: number },
    };
    expect(canonicalizeAppliedBounds(a)).toBe(canonicalizeAppliedBounds(b));
  });

  it('changes output when min or max changes', () => {
    const a: AppliedBoundsByCategory = {
      auditLog: { min: 365, max: 3650 },
    };
    const b: AppliedBoundsByCategory = {
      auditLog: { min: 365, max: 365 },
    };
    expect(canonicalizeAppliedBounds(a)).not.toBe(canonicalizeAppliedBounds(b));
  });
});

describe('hashAppliedBounds', () => {
  it('produces a 64-char hex string', async () => {
    const hash = await hashAppliedBounds({
      auditLog: { min: 365, max: 3650 },
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns identical hashes for equivalent inputs in different order', async () => {
    const a = await hashAppliedBounds({
      auditLog: { min: 365, max: 3650 },
      documents: { min: 30, max: 3650 },
    });
    const b = await hashAppliedBounds({
      documents: { min: 30, max: 3650 },
      auditLog: { min: 365, max: 3650 },
    });
    expect(a).toBe(b);
  });

  it('returns different hashes when bounds differ', async () => {
    const a = await hashAppliedBounds({
      auditLog: { min: 365, max: 3650 },
    });
    const b = await hashAppliedBounds({
      auditLog: { min: 365, max: 365 },
    });
    expect(a).not.toBe(b);
  });
});

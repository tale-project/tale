import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RetentionDefaultsConfig } from '../../../lib/shared/schemas/retention';
import {
  RetentionBoundsViolation,
  RetentionConfigMissingError,
  applyEnvTightening,
  applyEnvTighteningAll,
  assertWithinBounds,
  buildBoundsByCategory,
  clampConfigToBounds,
  clampToBounds,
  isRetentionDisabled,
} from '../retention_floors';

// A complete config covering a few representative categories used
// across multiple tests. Includes a root `_metadata.envNames` map so
// env-binding tests can exercise the path → env lookup. Other
// categories absent so the schema-level "at least one" refine isn't
// tested here (covered in retention.test.ts).
const baseConfig: RetentionDefaultsConfig = {
  _metadata: {
    envPrefix: 'TALE_RETENTION_',
    envNames: {
      AUDIT_MIN: 'auditLog.min',
      AUDIT_MAX: 'auditLog.max',
      AUDIT_DEFAULT: 'auditLog.default',
      FILES_MIN: 'documents.min',
      FILES_MAX: 'documents.max',
      FILES_DEFAULT: 'documents.default',
      USER_TEMP_MIN: 'userTempHours.min',
      USER_TEMP_MAX: 'userTempHours.max',
      USER_TEMP_DEFAULT: 'userTempHours.default',
      EXECUTIONS_MIN: 'workflowLog.min',
      EXECUTIONS_MAX: 'workflowLog.max',
      EXECUTIONS_DEFAULT: 'workflowLog.default',
    },
  },
  auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
  documents: { min: 30, max: 3650, default: 365, unit: 'days' },
  userTempHours: { min: 1, max: 720, default: 24, unit: 'hours' },
  workflowLog: { min: 1, max: 365, default: 30, unit: 'days' },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('applyEnvTightening', () => {
  it('returns base values when env vars unset', () => {
    const out = applyEnvTightening(baseConfig, 'auditLog');
    expect(out.min).toBe(365);
    expect(out.max).toBe(3650);
    expect(out.default).toBe(730);
    expect(out.unit).toBe('days');
    expect(out.source).toBe('file');
  });

  it('raises min when env _MIN exceeds base min', () => {
    vi.stubEnv('TALE_RETENTION_AUDIT_MIN', '500');
    const out = applyEnvTightening(baseConfig, 'auditLog');
    expect(out.min).toBe(500);
    expect(out.source).toBe('env');
  });

  it('lowers max when env _MAX undercuts base max', () => {
    vi.stubEnv('TALE_RETENTION_AUDIT_MAX', '1000');
    const out = applyEnvTightening(baseConfig, 'auditLog');
    expect(out.max).toBe(1000);
    expect(out.source).toBe('env');
  });

  it('ignores env attempting to relax min (env < base min)', () => {
    vi.stubEnv('TALE_RETENTION_AUDIT_MIN', '100');
    const out = applyEnvTightening(baseConfig, 'auditLog');
    // base.min=365 wins because Math.max(365, 100) = 365.
    expect(out.min).toBe(365);
  });

  it('ignores env attempting to relax max (env > base max)', () => {
    vi.stubEnv('TALE_RETENTION_AUDIT_MAX', '9999');
    const out = applyEnvTightening(baseConfig, 'auditLog');
    expect(out.max).toBe(3650);
  });

  it('still works for hour-unit categories (no special suffix)', () => {
    vi.stubEnv('TALE_RETENTION_USER_TEMP_MIN', '4');
    const out = applyEnvTightening(baseConfig, 'userTempHours');
    expect(out.unit).toBe('hours');
    expect(out.min).toBe(4);
    expect(out.source).toBe('env');
  });

  it('throws RetentionConfigMissingError when orgConfig is null', () => {
    expect(() => applyEnvTightening(null, 'auditLog')).toThrow(
      RetentionConfigMissingError,
    );
  });

  it('throws RetentionConfigMissingError when category absent', () => {
    expect(() => applyEnvTightening(baseConfig, 'customers')).toThrow(
      RetentionConfigMissingError,
    );
  });

  it('rejects env=0 (invalid bound) and falls back to file', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('TALE_RETENTION_AUDIT_MIN', '0');
    const out = applyEnvTightening(baseConfig, 'auditLog');
    expect(out.min).toBe(365);
    expect(out.source).toBe('file');
    errSpy.mockRestore();
  });

  it('reports env binding sources (metadata-derived for paths in envNames)', () => {
    const out = applyEnvTightening(baseConfig, 'auditLog');
    expect(out.minEnv.envName).toBe('TALE_RETENTION_AUDIT_MIN');
    expect(out.minEnv.source).toBe('metadata');
    expect(out.minEnv.applied).toBe(false);
    expect(out.maxEnv.envName).toBe('TALE_RETENTION_AUDIT_MAX');
    expect(out.maxEnv.source).toBe('metadata');
    expect(out.maxEnv.applied).toBe(false);
    expect(out.defaultEnv.envName).toBe('TALE_RETENTION_AUDIT_DEFAULT');
    expect(out.defaultEnv.source).toBe('metadata');
  });
});

describe('applyEnvTightening — _metadata.envNames map resolution', () => {
  it('forms full env names by plain concat: envPrefix + suffix', () => {
    const cfg: RetentionDefaultsConfig = {
      _metadata: {
        envPrefix: 'MY_',
        envNames: {
          AUDIT_MIN: 'auditLog.min',
          AUDIT_MAX: 'auditLog.max',
          AUDIT_DEFAULT: 'auditLog.default',
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    };
    const out = applyEnvTightening(cfg, 'auditLog');
    expect(out.minEnv.envName).toBe('MY_AUDIT_MIN');
    expect(out.maxEnv.envName).toBe('MY_AUDIT_MAX');
    expect(out.defaultEnv.envName).toBe('MY_AUDIT_DEFAULT');
  });

  it('omits envPrefix entirely when not declared (suffix keys are full env names)', () => {
    const cfg: RetentionDefaultsConfig = {
      _metadata: {
        envNames: {
          MY_AUDIT_MIN: 'auditLog.min',
          MY_AUDIT_MAX: 'auditLog.max',
          MY_AUDIT_DEFAULT: 'auditLog.default',
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    };
    const out = applyEnvTightening(cfg, 'auditLog');
    expect(out.minEnv.envName).toBe('MY_AUDIT_MIN');
    expect(out.maxEnv.envName).toBe('MY_AUDIT_MAX');
    expect(out.defaultEnv.envName).toBe('MY_AUDIT_DEFAULT');
  });

  it('binds independently per category through distinct envNames entries', () => {
    const cfg: RetentionDefaultsConfig = {
      _metadata: {
        envPrefix: 'TALE_RETENTION_',
        envNames: {
          AUDIT_MIN: 'auditLog.min',
          AUDIT_MAX: 'auditLog.max',
          AUDIT_DEFAULT: 'auditLog.default',
          INBOX_MIN: 'externalConversations.min',
          INBOX_MAX: 'externalConversations.max',
          INBOX_DEFAULT: 'externalConversations.default',
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
      externalConversations: { min: 30, max: 3650, default: 730, unit: 'days' },
    };
    const auditOut = applyEnvTightening(cfg, 'auditLog');
    expect(auditOut.minEnv.envName).toBe('TALE_RETENTION_AUDIT_MIN');
    const inboxOut = applyEnvTightening(cfg, 'externalConversations');
    expect(inboxOut.minEnv.envName).toBe('TALE_RETENTION_INBOX_MIN');
  });

  it('tightens at runtime via the resolved env name', () => {
    const cfg: RetentionDefaultsConfig = {
      _metadata: {
        envPrefix: 'TALE_RETENTION_',
        envNames: {
          AUDIT_MIN: 'auditLog.min',
          AUDIT_MAX: 'auditLog.max',
          AUDIT_DEFAULT: 'auditLog.default',
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    };
    vi.stubEnv('TALE_RETENTION_AUDIT_MIN', '500');
    const out = applyEnvTightening(cfg, 'auditLog');
    expect(out.min).toBe(500);
    expect(out.minEnv.applied).toBe(true);
    expect(out.source).toBe('env');
  });

  it('default env REPLACES (not tightens) the seed value', () => {
    const cfg: RetentionDefaultsConfig = {
      _metadata: {
        envPrefix: 'MY_',
        envNames: {
          AUDIT_DEFAULT: 'auditLog.default',
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    };
    vi.stubEnv('MY_AUDIT_DEFAULT', '900');
    const out = applyEnvTightening(cfg, 'auditLog');
    expect(out.default).toBe(900);
    expect(out.defaultEnv.applied).toBe(true);
  });

  it('no envNames at all → no env binding, source=none', () => {
    const cfg: RetentionDefaultsConfig = {
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    };
    const out = applyEnvTightening(cfg, 'auditLog');
    expect(out.minEnv.envName).toBe('');
    expect(out.minEnv.source).toBe('none');
    expect(out.minEnv.applied).toBe(false);
    expect(out.maxEnv.source).toBe('none');
    expect(out.defaultEnv.source).toBe('none');
  });

  it('partial envNames map → bound fields get metadata, unbound fields get none', () => {
    const cfg: RetentionDefaultsConfig = {
      _metadata: {
        envPrefix: 'TALE_RETENTION_',
        envNames: {
          AUDIT_MIN: 'auditLog.min',
          // max + default omitted intentionally
        },
      },
      auditLog: { min: 365, max: 3650, default: 730, unit: 'days' },
    };
    const out = applyEnvTightening(cfg, 'auditLog');
    expect(out.minEnv.source).toBe('metadata');
    expect(out.minEnv.envName).toBe('TALE_RETENTION_AUDIT_MIN');
    expect(out.maxEnv.source).toBe('none');
    expect(out.maxEnv.envName).toBe('');
    expect(out.defaultEnv.source).toBe('none');
  });
});

describe('applyEnvTighteningAll', () => {
  it('throws when any required category is missing from the config', () => {
    // baseConfig only has 4 of 16 categories; the helper iterates all 16.
    expect(() => applyEnvTighteningAll(baseConfig)).toThrow(
      RetentionConfigMissingError,
    );
  });
});

describe('assertWithinBounds + clampToBounds', () => {
  const bound = {
    category: 'auditLog' as const,
    min: 365,
    max: 3650,
    default: 730,
    unit: 'days' as const,
    source: 'file' as const,
    minEnv: {
      envName: 'TALE_RETENTION_AUDIT_MIN',
      source: 'metadata' as const,
      applied: false,
    },
    maxEnv: {
      envName: 'TALE_RETENTION_AUDIT_MAX',
      source: 'metadata' as const,
      applied: false,
    },
    defaultEnv: {
      envName: 'TALE_RETENTION_AUDIT_DEFAULT',
      source: 'metadata' as const,
      applied: false,
    },
  };

  it('assertWithinBounds accepts in-range value', () => {
    expect(() => assertWithinBounds(bound, 730)).not.toThrow();
  });

  it('assertWithinBounds throws RETENTION_BELOW_FLOOR', () => {
    try {
      assertWithinBounds(bound, 100);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RetentionBoundsViolation);
      if (err instanceof RetentionBoundsViolation) {
        expect(err.code).toBe('RETENTION_BELOW_FLOOR');
        expect(err.category).toBe('auditLog');
      }
    }
  });

  it('assertWithinBounds throws RETENTION_EXCEEDS_CEILING', () => {
    try {
      assertWithinBounds(bound, 9999);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RetentionBoundsViolation);
      if (err instanceof RetentionBoundsViolation) {
        expect(err.code).toBe('RETENTION_EXCEEDS_CEILING');
      }
    }
  });

  it('clampToBounds clamps below to min', () => {
    expect(clampToBounds(bound, 100)).toBe(365);
  });

  it('clampToBounds clamps above to max', () => {
    expect(clampToBounds(bound, 9999)).toBe(3650);
  });

  it('clampToBounds passes through in-range value', () => {
    expect(clampToBounds(bound, 1000)).toBe(1000);
  });
});

describe('clampConfigToBounds', () => {
  it('clamps each retention field against its bound', () => {
    // Hand-roll the bounds map covering the fields the test config
    // exercises. `buildBoundsByCategory` requires all 16 categories
    // present in the file; this test scope just needs four.
    const partialBounds = {
      auditLog: applyEnvTightening(baseConfig, 'auditLog'),
      documents: applyEnvTightening(baseConfig, 'documents'),
      userTempHours: applyEnvTightening(baseConfig, 'userTempHours'),
      workflowLog: applyEnvTightening(baseConfig, 'workflowLog'),
    };
    const config = {
      auditLogRetentionDays: 100, // below floor 365 → 365
      documentsRetentionDays: 9999, // above ceiling 3650 → 3650
      userTempRetentionHours: 24, // in range
      workflowLogRetentionDays: 'oops', // non-numeric → untouched
    };
    const out = clampConfigToBounds(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial bounds map for this scoped test
      partialBounds as Parameters<typeof clampConfigToBounds>[0],
      config,
    );
    expect(out.auditLogRetentionDays).toBe(365);
    expect(out.documentsRetentionDays).toBe(3650);
    expect(out.userTempRetentionHours).toBe(24);
    expect(out.workflowLogRetentionDays).toBe('oops');
  });

  it('buildBoundsByCategory throws if config is missing categories', () => {
    expect(() => buildBoundsByCategory(baseConfig)).toThrow(
      RetentionConfigMissingError,
    );
  });
});

describe('isRetentionDisabled', () => {
  it('returns false when env unset', () => {
    expect(isRetentionDisabled()).toBe(false);
  });

  it('returns true when TALE_RETENTION_DISABLED=true', () => {
    vi.stubEnv('TALE_RETENTION_DISABLED', 'true');
    expect(isRetentionDisabled()).toBe(true);
  });

  it('returns false for any other string value', () => {
    vi.stubEnv('TALE_RETENTION_DISABLED', '1');
    expect(isRetentionDisabled()).toBe(false);
  });
});

/**
 * Regression for #2675 — runtime container images have no vitest sources, so
 * `validateBuiltinCatalog` must skip repo-relative covering-gate existence
 * checks while CI/build gates keep them enabled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const AUTOMATIONS_GATE_FRAGMENTS = [
  'builtin_apps.test.ts',
  'fixture_bundle_drift.test.ts',
] as const;

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: Parameters<typeof actual.existsSync>[0]) => {
      const p = String(path);
      if (AUTOMATIONS_GATE_FRAGMENTS.some((fragment) => p.includes(fragment))) {
        return false;
      }
      return actual.existsSync(path);
    },
  };
});

import { checkValidatorRegistryComplete } from './catalog_validator';

describe('checkValidatorRegistryComplete covering gates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports missing gate files when checkCoveringGates is true (default)', () => {
    const issues = checkValidatorRegistryComplete();
    expect(issues.some((issue) => issue.startsWith('automations:'))).toBe(true);
  });

  it('skips gate file checks when checkCoveringGates is false', () => {
    const issues = checkValidatorRegistryComplete({
      checkCoveringGates: false,
    });
    expect(issues).toEqual([]);
  });
});

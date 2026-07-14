/**
 * Universal JSON-config validation gate — a thin vitest wrapper over
 * `catalog_validator.ts` (the walkers + `DOMAIN_VALIDATORS` registry live
 * there so the same logic is importable from the build-time CLI gate
 * (`scripts/validate-builtin-configs.ts`) and the post-deploy runtime action
 * (`convex/lib/config_store/validate_builtin_catalog.ts`), not just vitest).
 *
 * Walks the entire `builtin-configs/` catalog PLUS both e2e fixture org trees
 * and validates every file against the domain's shared Zod schema (the SAME
 * schema the platform load path uses — never a hand-rolled twin), and asserts
 * the domain-validator registry itself has no drift (every `CONFIG_DOMAINS`
 * entry declares a validator, every validator maps back to a registered
 * domain, every externally-gated domain's covering test files still exist).
 */
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkValidatorRegistryComplete,
  validateConfigDir,
} from './catalog_validator';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

/**
 * The roots this gate sweeps. `catalog` roots must carry a dir for every
 * catalog-scaffolded domain (`scaffoldKind` present) with at least one file;
 * `org` roots are partial by design (a fixture org ships only what its specs
 * need), so absent domain dirs are fine there.
 */
const ROOTS: ReadonlyArray<{
  label: string;
  dir: string;
  kind: 'catalog' | 'org';
}> = [
  {
    label: 'builtin-configs',
    dir: `${REPO_ROOT}builtin-configs`,
    kind: 'catalog',
  },
  {
    label: 'e2e fixture default',
    dir: `${REPO_ROOT}services/platform/tests/e2e/fixtures/config/default`,
    kind: 'org',
  },
  {
    label: 'e2e fixture qa-guides-org',
    dir: `${REPO_ROOT}services/platform/tests/e2e/fixtures/config/qa-guides-org`,
    kind: 'org',
  },
  {
    // The docs-screenshot demo catalog. It carries a REAL governance dir (not a
    // symlink to builtin-configs) so the governance pages screenshot populated
    // instead of empty — which means it can drift from the policy schemas on
    // its own, and nothing else validates it.
    label: 'e2e fixture docs-demo',
    dir: `${REPO_ROOT}services/platform/tests/e2e/fixtures/config/docs-demo`,
    kind: 'org',
  },
];

describe('config-domain validator completeness (registry drift guard)', () => {
  it('every domain declares a validator, mapping back and gate files intact', () => {
    expect(checkValidatorRegistryComplete()).toEqual([]);
  });

  // #2675: the covering-gate file-existence half is checkout-bound. A root
  // without the repo's test files (a shipped image's filesystem) must fail
  // the default/strict mode — and pass when the runtime call site turns the
  // checkout-bound half off. Registry completeness runs in both modes.
  describe('covering-gate check outside a checkout (#2675)', () => {
    // Exists, but contains none of the covering test files — the same shape
    // as a container's `$TALE_CONFIG_BUILTIN_DIR` filesystem.
    const checkoutlessRoot = `${REPO_ROOT}builtin-configs`;

    it('strict mode still reports missing covering gates', () => {
      const issues = checkValidatorRegistryComplete({
        repoRoot: checkoutlessRoot,
      });
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.includes('covering gate'))).toBe(true);
    });

    it('the runtime mode (checkCoveringGates: false) reports none', () => {
      expect(
        checkValidatorRegistryComplete({
          checkCoveringGates: false,
          repoRoot: checkoutlessRoot,
        }),
      ).toEqual([]);
    });
  });
});

describe.each(ROOTS)('$label config tree', ({ dir, kind }) => {
  it(`validates every domain against its shared schema (kind=${kind})`, () => {
    const { issues } = validateConfigDir(dir, kind);
    expect(issues).toEqual([]);
  });
});

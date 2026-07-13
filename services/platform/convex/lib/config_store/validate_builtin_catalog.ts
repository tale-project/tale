'use node';

/**
 * Post-deploy, non-fatal sanity check over the built-in config catalog baked
 * into the image (`$TALE_CONFIG_BUILTIN_DIR`) — walks it against every
 * domain's shared Zod schema (`catalog_validator.ts`, the same engine behind
 * the vitest gate and the build-time `configs:validate` script) and LOGS any
 * problem loudly. Never blocks boot: a broken builtin catalog is a build-time
 * regression `configs:validate` + CI should already have caught before the
 * image shipped — this is the last-mile safety net for a mismatched image, a
 * bind-mounted dev catalog, or a hand-edited builtin dir on an existing
 * deployment.
 *
 * Invoked from `docker-entrypoint.sh` right beside the `provisioning:
 * provisionAll` / `migrations:runAll` post-deploy calls, with the same loud
 * + non-fatal posture:
 *   `bunx convex run lib/config_store/validate_builtin_catalog:validateBuiltinCatalog`
 */

import { v } from 'convex/values';

import {
  checkValidatorRegistryComplete,
  validateConfigDir,
} from '../../../lib/shared/config/catalog_validator';
import { internalAction } from '../../_generated/server';

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

export const validateBuiltinCatalog = internalAction({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    issueCount: v.number(),
    filesValidated: v.number(),
  }),
  handler: async () => {
    const builtinDir = process.env[BUILTIN_ENV];
    if (!builtinDir) {
      console.error(
        `[validateBuiltinCatalog] ${BUILTIN_ENV} is unset; skipping builtin catalog validation`,
      );
      return { ok: false, issueCount: 0, filesValidated: 0 };
    }

    // Registry completeness (domain ↔ validator mapping) is checked here
    // like everywhere else, but the covering-gate file-existence half is
    // checkout-bound: the shipped image carries no repo checkout and never
    // bundles test files, so checking them at runtime turned every healthy
    // container boot red (#2675). The vitest and build-time gates keep it on.
    const registryIssues = checkValidatorRegistryComplete({
      checkCoveringGates: false,
    });
    const { issues: catalogIssues, filesValidated } = validateConfigDir(
      builtinDir,
      'catalog',
    );
    const issues = [...registryIssues, ...catalogIssues];

    if (issues.length > 0) {
      console.error(
        `[validateBuiltinCatalog] ${issues.length} issue(s) in the builtin catalog at ${builtinDir}:`,
      );
      for (const issue of issues) {
        console.error(`  - ${issue}`);
      }
    } else {
      console.log(
        `[validateBuiltinCatalog] builtin catalog OK (${filesValidated} files validated)`,
      );
    }

    return {
      ok: issues.length === 0,
      issueCount: issues.length,
      filesValidated,
    };
  },
});

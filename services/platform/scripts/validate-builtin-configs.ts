/**
 * Build-time CI guard for the built-in config catalog. Fails the build when
 * any shipped `builtin-configs/<domain>/` file doesn't validate against its
 * domain's shared Zod schema, or when the domain-validator registry itself
 * has drifted (a `CONFIG_DOMAINS` entry with no `DOMAIN_VALIDATORS` entry, an
 * externally-gated domain whose covering test file is gone).
 *
 * This closes the gap where `build.yml` and `test.yml` run independently: a
 * broken builtin catalog previously only failed the (separate) test job, not
 * the artifact build — a bad image could still ship. Run via
 * `bun run --filter @tale/platform configs:validate`; wired into both the
 * platform `build` script and a CI step before the Docker build-push.
 *
 * Same logic as the vitest gate
 * (`lib/shared/config/builtin_configs_validation.test.ts`), reused from
 * `catalog_validator.ts` — plain Bun, no vitest, so it can run as a build
 * step with no test-runner dependency.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkValidatorRegistryComplete,
  validateConfigDir,
} from '../lib/shared/config/catalog_validator';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_CONFIGS_DIR = path.join(here, '../../../builtin-configs');

function main(): void {
  const registryIssues = checkValidatorRegistryComplete();
  const { issues: catalogIssues, filesValidated } = validateConfigDir(
    BUILTIN_CONFIGS_DIR,
    'catalog',
  );
  const issues = [...registryIssues, ...catalogIssues];

  if (issues.length > 0) {
    console.error(
      `[configs:validate] FAILED — ${issues.length} issue(s) in ${BUILTIN_CONFIGS_DIR}:\n  - ` +
        issues.join('\n  - '),
    );
    process.exit(1);
  }

  console.log(
    `[configs:validate] OK — ${filesValidated} builtin config file(s) validated.`,
  );
}

main();

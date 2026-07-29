/**
 * Build-time CI guard for the shipped SYSTEM config catalog
 * (`configs/platform/system/{providers,models,harnesses,connectors}`). Fails
 * the build when any shipped connector, model catalog, or harness file doesn't
 * parse or validate against its Zod schema — the loaders throw with the
 * offending file path in the message.
 *
 * This closes the gap where `build.yml` and `test.yml` run independently: a
 * broken system catalog would otherwise only fail the (separate) test job, not
 * the artifact build, so a bad image could still ship. Wired into the platform
 * `build` script and a CI step before the Docker build-push.
 *
 * Plain Bun — no vitest, no running Convex: the loaders it calls are
 * runtime-neutral (`lib/shared/config/yaml` + Zod, no `convex/_generated`), so
 * this runs as a build step with no test-runner or backend dependency. It
 * replaces the retired registry-based `catalog_validator.ts` guard that walked
 * the old `builtin-configs/` tree.
 *
 * Scope: the per-org CUSTOM seed catalog (`configs/platform/custom/*`) is
 * validated at org-scaffold time and by the runtime `validateBuiltinCatalog`
 * action; the migration corpus covers historical era formats.
 */

import path from 'node:path';
import process from 'node:process';

import {
  loadHarnesses,
  loadProviderDefinitions,
  loadStaticCatalogs,
} from '../convex/lib/providers/load_system_config';
import { loadConnectorDefinitions } from '../lib/connectors/catalog';

// scripts/ -> services/platform -> services -> repo root -> configs/platform/system
const SYSTEM_ROOT = path.join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'configs',
  'platform',
  'system',
);

function main(): void {
  const options = { root: SYSTEM_ROOT } as const;
  try {
    const providers = loadProviderDefinitions(options);
    const modelCatalogs = loadStaticCatalogs(options);
    const harnesses = loadHarnesses(options);
    const connectors = loadConnectorDefinitions(options);
    console.log(
      `[configs:validate] OK — ${providers.length} provider connectors, ` +
        `${modelCatalogs.size} model catalogs, ${harnesses.length} harnesses, ` +
        `${connectors.length} connectors validated in ${SYSTEM_ROOT}`,
    );
  } catch (err) {
    console.error(
      `[configs:validate] FAILED — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

main();

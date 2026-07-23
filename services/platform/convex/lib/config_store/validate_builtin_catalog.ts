'use node';

/**
 * Post-deploy, non-fatal sanity check over the shipped built-in config
 * catalog — the per-org seed tree resolved by
 * `builtin_catalog.ts` (`$TALE_CONFIG_BUILTIN_DIR`, else the repo's
 * `configs/platform/custom/`). Walks the catalog's `governance/` domain and
 * validates every file against the shared Zod schemas, LOGGING any problem
 * loudly. Never blocks boot: a broken catalog is a build-time regression CI
 * should have caught before the image shipped — this is the last-mile
 * safety net for a mismatched image, a bind-mounted dev catalog, or a
 * hand-edited builtin dir on an existing deployment.
 *
 * Registry-completeness posture: the shipped catalog is authored YAML and
 * every file must be CLAIMED by a schema — a `.yml` whose basename maps to
 * a governance policy type validates against `POLICY_SCHEMAS`, the
 * `retention.yml` bounds catalog against its schema, and anything else
 * (an unmapped basename, a stray `.json`, a subdirectory, a non-config
 * file) is an issue. Drift between the catalog and the registry must
 * surface as an error, never ship silently.
 *
 * Invoked from `docker-entrypoint.sh` right beside the
 * `provisioning:provisionAll` / `migrations:runAll` post-deploy calls, with
 * the same loud + non-fatal posture:
 *   `bunx convex run lib/config_store/validate_builtin_catalog:validateBuiltinCatalog`
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { v } from 'convex/values';

import { parseYaml } from '../../../lib/shared/config/yaml';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  fileBaseToPolicyType,
  POLICY_SCHEMAS,
} from '../../../lib/shared/schemas/governance';
import { retentionDefaultsConfigSchema } from '../../../lib/shared/schemas/retention';
import { internalAction } from '../../_generated/server';
import { resolveBuiltinCatalogRoot } from './builtin_catalog';

/** The retention bounds catalog rides in the governance dir but is not a
 *  policy — it validates against its own schema. */
const RETENTION_BASE = 'retention';

interface CatalogReport {
  issues: string[];
  filesValidated: number;
}

function validateGovernanceCatalogDir(catalogRoot: string): CatalogReport {
  const dir = path.join(catalogRoot, 'governance');
  const issues: string[] = [];
  let filesValidated = 0;

  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch (err) {
    return {
      issues: [
        `governance/: catalog domain dir is missing or unreadable at ${dir} — ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
      filesValidated: 0,
    };
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue; // .gitkeep and editor droppings

    const entryPath = path.join(dir, name);
    let isDirectory = false;
    try {
      isDirectory = statSync(entryPath).isDirectory();
    } catch (err) {
      issues.push(
        `governance/${name}: unreadable — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (isDirectory) {
      issues.push(
        `governance/${name}/: unexpected subdirectory — the governance catalog is a flat domain`,
      );
      continue;
    }
    if (!name.endsWith('.yml')) {
      issues.push(
        `governance/${name}: unexpected file — the shipped catalog is authored as .yml`,
      );
      continue;
    }

    const base = name.slice(0, -'.yml'.length);
    const policyType = fileBaseToPolicyType(base);
    const schema =
      base === RETENTION_BASE
        ? retentionDefaultsConfigSchema
        : policyType
          ? POLICY_SCHEMAS[policyType]
          : null;
    if (!schema) {
      issues.push(
        `governance/${name}: no schema claims this file — not a governance policy type and not the retention bounds catalog`,
      );
      continue;
    }

    const parsed = parseYaml(readFileSync(entryPath, 'utf-8'));
    if (!parsed.ok) {
      issues.push(`governance/${name}: ${parsed.error}`);
      continue;
    }
    const outcome = schema.safeParse(parsed.data);
    if (!outcome.success) {
      issues.push(
        zodErrorMessage(`governance/${name}: invalid`, outcome.error),
      );
      continue;
    }
    filesValidated++;
  }

  return { issues, filesValidated };
}

export const validateBuiltinCatalog = internalAction({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    issueCount: v.number(),
    filesValidated: v.number(),
  }),
  handler: async () => {
    const catalogRoot = resolveBuiltinCatalogRoot();
    if (!catalogRoot) {
      console.error(
        '[validateBuiltinCatalog] no builtin catalog root resolves (TALE_CONFIG_BUILTIN_DIR unset/relative, no repo configs/platform/custom); skipping catalog validation',
      );
      return { ok: false, issueCount: 0, filesValidated: 0 };
    }

    const { issues, filesValidated } =
      validateGovernanceCatalogDir(catalogRoot);

    if (issues.length > 0) {
      console.error(
        `[validateBuiltinCatalog] ${issues.length} issue(s) in the builtin catalog at ${catalogRoot}:`,
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

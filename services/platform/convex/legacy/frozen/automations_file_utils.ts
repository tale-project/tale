'use node';

/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Trimmed copy of `file_utils.ts` from the retired `convex/automations/`
 * domain. Trimmed
 * to `resolveAutomationsDir` / `resolveAutomationManifestPath` — the surface
 * `v0_3_4/33_workflows_become_automations/migration.ts` imports — plus their
 * two direct internal dependencies (`resolveManifestFilePath`,
 * `resolveAutomationDir`). NOT frozen: `isBundleDir` /
 * `resolveBundleManifestPath` / `resolveCatalog*` / `listAutomationSlugs` /
 * `readInstalledAutomationDisplays` / `resolveAutomationWorkflowHistoryDir` /
 * `resolveAutomationAssetPath*` / `splitAutomationAssetRef` — no migration
 * touches the builtin catalog, asset paths, or display metadata.
 *
 * Dependency substitutions from the original:
 *  - `AUTOMATION_MANIFEST_FILENAME` / `BUNDLE_MANIFEST_FILENAME` /
 *    `isValidAutomationSlug` (`lib/shared/schemas/automations.ts`, retired)
 *    → also-frozen at `legacy/frozen/schemas_automations.ts`. (The original
 *    also imported `AutomationManifestI18n` / `automationManifestSchema` —
 *    both only used by `readInstalledAutomationDisplays`, outside the
 *    trimmed surface, so neither is needed here.)
 *  - `getConfigRoot` / `safeJoinWithinDir` / `validateOrgSlug`
 *    (`convex/lib/file_io.ts`) are STILL LIVE — imported directly, unchanged.
 *    `errnoCode` / `verifyPathWithinBase` (also live) are NOT needed — they
 *    only back `listAutomationSlugs` / `resolveAutomationAssetPathChecked`,
 *    outside the trimmed surface.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  getConfigRoot,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../../lib/file_io';
import {
  AUTOMATION_MANIFEST_FILENAME,
  BUNDLE_MANIFEST_FILENAME,
  isValidAutomationSlug,
} from './schemas_automations';

const DOMAIN_DIR = 'automations';

export function resolveAutomationsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot(DOMAIN_DIR), orgSlug, DOMAIN_DIR);
}

/**
 * Resolve the manifest file within an already-located bundle dir. Prefers a
 * BUNDLE's `bundle.json` (an aggregator) over an automation's
 * `automation.json`.
 */
function resolveManifestFilePath(bundleDir: string): string {
  const bundle = path.join(bundleDir, BUNDLE_MANIFEST_FILENAME);
  if (existsSync(bundle)) return bundle;
  return path.join(bundleDir, AUTOMATION_MANIFEST_FILENAME);
}

function resolveAutomationDir(orgSlug: string, slug: string): string {
  if (!isValidAutomationSlug(slug)) {
    throw new Error(`Invalid automation slug: ${slug}`);
  }
  return safeJoinWithinDir(resolveAutomationsDir(orgSlug), slug);
}

export function resolveAutomationManifestPath(
  orgSlug: string,
  slug: string,
): string {
  return resolveManifestFilePath(resolveAutomationDir(orgSlug, slug));
}

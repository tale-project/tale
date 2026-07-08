import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.93 / 01 — rename `appSlug`/`appName` → `automationSlug`/`automationName`
 * on automation install tables, optional ownership columns on agent/workflow
 * install rows, and `threadMetadata.automationSlug` (+ install-scoped
 * `subjectType: 'app'` → `'automation'`).
 *
 * Shipped with the Phase-R schema recolumn: indexes `by_org_slug` /
 * `by_org_slug_project` / `by_org_automation_subject` now key on
 * `automationSlug`. Pure field rename — fully reversible, no information lost.
 *
 * Reference-only: Convex validates rows against today's schema at push; the
 * runner never executes a `reference` migration. Kept under round-trip test for
 * the audit trail.
 */
export const meta: MigrationMeta = {
  id: '0.2.93/01_automation_slug_fields',
  semver: '0.2.93',
  numericId: 1,
  slug: 'automation_slug_fields',
  title: 'Rename appSlug/appName to automationSlug/automationName',
  description:
    'Renames appSlug→automationSlug and appName→automationName on ' +
    'appInstallations. Runs on deploy before new code reads the recolumned ' +
    'by_org_slug index. Reversible.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

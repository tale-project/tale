import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.88 / 01 — copy an app's ORG-LEVEL config (`appInstallations.config`) onto
 * each of its project bindings (`appProjectBindings.config`).
 *
 * Per-project config is now authoritative for a `scope: 'project'` app, so an
 * existing single-config install is folded down to per-binding config (the org
 * row keeps its copy as the legacy fallback). Idempotent — skips a binding that
 * already has config. `down` clears only the bindings whose config still equals
 * the org copy, leaving any post-migration per-project edit intact.
 */
export const meta: MigrationMeta = {
  id: '0.2.88/01_app_config_to_bindings',
  semver: '0.2.88',
  numericId: 1,
  slug: 'app_config_to_bindings',
  title: 'Copy org-level app config onto each project binding',
  description:
    "Copies each installed app's appInstallations.config onto its " +
    'appProjectBindings rows so a scope:project app holds config per-project. ' +
    'Idempotent — skips a binding that already has config. down clears only the ' +
    'bindings whose config still equals the org copy.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

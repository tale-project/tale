import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.93 / 02 — rename `appProjectBindings.appSlug` → `automationSlug`.
 */
export const meta: MigrationMeta = {
  id: '0.2.93/02_app_project_bindings_automation_slug',
  semver: '0.2.93',
  numericId: 2,
  slug: 'app_project_bindings_automation_slug',
  title: 'Rename appProjectBindings.appSlug to automationSlug',
  description:
    'Copies appSlug→automationSlug on every appProjectBindings row and clears ' +
    'the legacy field. Reversible. Runs on deploy before new code reads the ' +
    'recolumned by_org_slug_project index.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

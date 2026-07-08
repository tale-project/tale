import type { MigrationMeta } from '../../../framework/types';

/** 0.2.93 / 05 — `appProjectBindings` → `automationProjectBindings`. */
export const meta: MigrationMeta = {
  id: '0.2.93/05_app_project_bindings_table',
  semver: '0.2.93',
  numericId: 5,
  slug: 'app_project_bindings_table',
  title: 'Rename appProjectBindings table to automationProjectBindings',
  description:
    'Copies each appProjectBindings row into automationProjectBindings and ' +
    'deletes the legacy row. Idempotent.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

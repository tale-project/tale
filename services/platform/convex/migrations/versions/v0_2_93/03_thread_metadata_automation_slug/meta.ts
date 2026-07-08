import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.93 / 03 — rename `threadMetadata.appSlug` → `automationSlug` and map
 * install-scoped `subjectType: 'app'` → `'automation'`.
 */
export const meta: MigrationMeta = {
  id: '0.2.93/03_thread_metadata_automation_slug',
  semver: '0.2.93',
  numericId: 3,
  slug: 'thread_metadata_automation_slug',
  title: 'Rename threadMetadata app-subject columns to automation naming',
  description:
    'Copies appSlug→automationSlug on app_discussion rows and rewrites ' +
    "install-scoped subjectType 'app' to 'automation'. Reversible.",
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

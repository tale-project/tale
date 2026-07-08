import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.93 / 08 — rename `threadMetadata.kind` literal `app_discussion` →
 * `automation_discussion`.
 */
export const meta: MigrationMeta = {
  id: '0.2.93/08_thread_metadata_automation_discussion',
  semver: '0.2.93',
  numericId: 8,
  slug: 'thread_metadata_automation_discussion',
  title:
    "Rename threadMetadata kind 'app_discussion' to 'automation_discussion'",
  description:
    "Rewrites kind: 'app_discussion' → 'automation_discussion' on threadMetadata " +
    'rows. Reversible.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

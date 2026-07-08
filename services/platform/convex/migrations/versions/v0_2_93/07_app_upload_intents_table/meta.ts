import type { MigrationMeta } from '../../../framework/types';

/** 0.2.93 / 07 — `appUploadIntents` → `automationUploadIntents`. */
export const meta: MigrationMeta = {
  id: '0.2.93/07_app_upload_intents_table',
  semver: '0.2.93',
  numericId: 7,
  slug: 'app_upload_intents_table',
  title: 'Rename appUploadIntents table to automationUploadIntents',
  description:
    'Copies each appUploadIntents row into automationUploadIntents and deletes ' +
    'the legacy row. Idempotent.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

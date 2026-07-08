import type { MigrationMeta } from '../../../framework/types';

/** 0.2.93 / 06 — `appUploadClaims` → `automationUploadClaims`. */
export const meta: MigrationMeta = {
  id: '0.2.93/06_app_upload_claims_table',
  semver: '0.2.93',
  numericId: 6,
  slug: 'app_upload_claims_table',
  title: 'Rename appUploadClaims table to automationUploadClaims',
  description:
    'Copies each appUploadClaims row into automationUploadClaims and deletes ' +
    'the legacy row. Idempotent.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

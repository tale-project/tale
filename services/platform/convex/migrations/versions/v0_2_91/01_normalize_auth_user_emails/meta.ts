import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.91 / 01 — normalize Better Auth user emails to lowercase and merge
 * case-variant duplicate accounts (e.g. SCIM IdP casing vs email/password signup).
 *
 * `up` renames lone mixed-case rows and conservatively merges duplicate groups
 * (skipping dual-owner conflicts). Snapshots deleted duplicate user rows into
 * `migrationSnapshots` before removal. `down` restores snapshotted component
 * rows via adapter.create (fresh `_id`s — membership edges are not fully rewound).
 */
export const meta: MigrationMeta = {
  id: '0.2.91/01_normalize_auth_user_emails',
  semver: '0.2.91',
  numericId: 1,
  slug: 'normalize_auth_user_emails',
  title: 'Normalize auth user emails and merge case-variant duplicates',
  description:
    'Lowercases Better Auth user emails and merges accounts that differ only ' +
    'by email casing. Skips unsafe groups (e.g. two owners in one org). ' +
    'Snapshots removed duplicate user rows before deletion; down recreates ' +
    'snapshotted user/member/account payloads (fresh ids).',
  kind: 'component',
  reversible: true,
  destructive: true,
  snapshot: 'table-rows',
};

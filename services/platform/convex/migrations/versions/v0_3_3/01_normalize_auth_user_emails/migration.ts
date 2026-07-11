/**
 * Component migration: normalize Better Auth user emails to lowercase and
 * merge case-variant duplicate accounts (e.g. SCIM IdP casing vs
 * email/password signup).
 *
 * `up` renames lone mixed-case rows and conservatively merges duplicate groups
 * (skipping dual-owner conflicts). Snapshots deleted duplicate user rows into
 * `migrationSnapshots` before removal. `down` restores snapshotted component
 * rows via adapter.create (fresh `_id`s — membership edges are not fully
 * rewound).
 */

import { applyAuthEmailNormalizationBatch } from '../../../../lib/auth/resolve_auth_user_email_group';
import { defineComponentMigration } from '../../../framework/define';

export const migration = defineComponentMigration({
  title: 'Normalize auth user emails and merge case-variant duplicates',
  description:
    'Lowercases Better Auth user emails and merges accounts that differ only ' +
    'by email casing. Skips unsafe groups (e.g. two owners in one org). ' +
    'Snapshots removed duplicate user rows before deletion; down recreates ' +
    'snapshotted user/member/account payloads (fresh ids).',
  destructive: true,
  snapshot: 'table-rows',
  subjects: {
    tables: [
      'betterAuth:user',
      'betterAuth:member',
      'betterAuth:account',
      'betterAuth:teamMember',
      'betterAuth:session',
    ],
  },
  batchSize: 50,

  async up(ctx, cursor, batchSize, run) {
    const batch = await applyAuthEmailNormalizationBatch(
      ctx,
      cursor,
      batchSize,
      run.id,
    );
    return {
      isDone: batch.isDone,
      processed: batch.processed,
      renamed: batch.stats.renamed,
      merged: batch.stats.merged,
      skipped: batch.stats.skipped,
      noop: batch.stats.noop,
      continueCursor: batch.continueCursor,
    };
  },

  async down(ctx, cursor) {
    // Component rollback is handled by restoreComponentSnapshotBatch in the runner.
    void ctx;
    void cursor;
    return {
      isDone: true,
      processed: 0,
      renamed: 0,
      merged: 0,
      skipped: 0,
      noop: 0,
      continueCursor: null,
    };
  },
});

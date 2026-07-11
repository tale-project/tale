'use node';

/**
 * 0.2.87 / 03 — export the DB-backed `modelSyncSettings` row to the file-based
 * `model_sync` governance policy.
 *
 * Expand step of the model-sync cutover: exports each org's legacy
 * `modelSyncSettings` row to its per-org `model-sync.json` (now the source of
 * truth), then re-syncs the `configCache` mirror so V8 readers (the providers
 * UI + the weekly cron) see the file. Non-destructive — the legacy rows are
 * dropped later by 0.2.87/05.
 *
 * Idempotent per org: re-running overwrites the same file with the same
 * content. `down` restores the pre-migration governance directory from the
 * fs-tree snapshot captured in `up`.
 */

import { internal } from '../../../../_generated/api';
import {
  resolveGovernanceDir,
  resolvePolicyFilePath,
  serializePolicyJson,
} from '../../../../governance/file_utils';
import { defineNodeMigration } from '../../../framework/define';
import type { LegacyModelSyncSettingsRow } from '../legacy_run_code_model_sync';

const DOMAIN = 'governance';

export const migration = defineNodeMigration({
  title:
    'Export modelSyncSettings to the file-based model_sync governance policy',
  description:
    'For each org with a legacy modelSyncSettings row, writes its ' +
    'model-sync.json (autoSyncEnabled) under <org>/governance/, then re-syncs ' +
    'the configCache mirror. Non-destructive to the database — the legacy rows ' +
    'are dropped by 0.2.87/05. A per-org fs-tree snapshot of the governance ' +
    'directory is taken first so down can restore the prior files.',
  destructive: false,
  snapshot: 'fs-tree',
  subjects: { tables: ['modelSyncSettings'], domains: ['governance'] },

  async up(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(dir);

    const rows: LegacyModelSyncSettingsRow[] = await ctx.runQuery(
      internal.migrations.versions.v0_2_87.legacy_run_code_model_sync
        .listModelSyncSettingsByOrg,
      { organizationId: org.id },
    );
    const row = rows[0];
    if (row) {
      const content = serializePolicyJson('model_sync', {
        autoSyncEnabled: row.autoSyncEnabled,
      });
      await helpers.atomicWrite(
        resolvePolicyFilePath(org.slug, 'model_sync'),
        content,
      );
    }

    await ctx.runAction(
      internal.lib.config_cache.actions.syncConfigDomainFromFiles,
      { organizationId: org.id, domain: DOMAIN },
    );
  },

  async down(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.restoreFsTree(dir);
    await ctx.runAction(
      internal.lib.config_cache.actions.syncConfigDomainFromFiles,
      { organizationId: org.id, domain: DOMAIN },
    );
  },
});

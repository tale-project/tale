'use node';

/**
 * Node migration: export each org's legacy `modelSyncSettings` row to its
 * per-org `model-sync.json` (now the source of truth), then re-sync the
 * `configCache` mirror so V8 readers (the providers UI + the weekly cron) see
 * the file.
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
import type { NodeMigration } from '../../../framework/types';
import type { LegacyModelSyncSettingsRow } from '../legacy_run_code_model_sync';
import { meta } from './meta';

const DOMAIN = 'governance';

export const migration: NodeMigration = {
  meta,
  async up(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

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
    await helpers.restoreFsTree(meta.id, org.slug, dir);
    await ctx.runAction(
      internal.lib.config_cache.actions.syncConfigDomainFromFiles,
      { organizationId: org.id, domain: DOMAIN },
    );
  },
};

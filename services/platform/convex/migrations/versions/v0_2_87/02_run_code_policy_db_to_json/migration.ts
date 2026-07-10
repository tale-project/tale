'use node';

/**
 * 0.2.87 / 02 — export the DB-backed `orgPackagePolicy` row to the file-based
 * `run_code` governance policy.
 *
 * Expand step of the run_code cutover: exports each org's legacy
 * `orgPackagePolicy` row to its per-org `run-code.json` (now the source of
 * truth), then re-syncs the `configCache` mirror so V8 readers (the run_code
 * tool gate) see the file. Non-destructive — the legacy rows are dropped later
 * by 0.2.87/04.
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
import type { LegacyOrgPackagePolicyRow } from '../legacy_run_code_model_sync';

const DOMAIN = 'governance';

export const migration = defineNodeMigration({
  title: 'Export orgPackagePolicy to the file-based run_code governance policy',
  description:
    'For each org with a legacy orgPackagePolicy row, writes its ' +
    'run-code.json (defaultMode + python/node allow/deny lists) under ' +
    '<org>/governance/, then re-syncs the configCache mirror. Non-destructive ' +
    'to the database — the legacy rows are dropped by 0.2.87/04. A per-org ' +
    'fs-tree snapshot of the governance directory is taken first so down can ' +
    'restore the prior files.',
  destructive: false,
  snapshot: 'fs-tree',
  subjects: { tables: ['orgPackagePolicy'], domains: ['governance'] },

  async up(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(dir);

    const rows: LegacyOrgPackagePolicyRow[] = await ctx.runQuery(
      internal.migrations.versions.v0_2_87.legacy_run_code_model_sync
        .listOrgPackagePolicyByOrg,
      { organizationId: org.id },
    );
    // At most one row per org; serializePolicyJson applies schema defaults.
    const row = rows[0];
    if (row) {
      const content = serializePolicyJson('run_code', {
        defaultMode: row.defaultMode,
        pythonAllow: row.pythonAllow,
        pythonDeny: row.pythonDeny,
        nodeAllow: row.nodeAllow,
        nodeDeny: row.nodeDeny,
      });
      await helpers.atomicWrite(
        resolvePolicyFilePath(org.slug, 'run_code'),
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

'use node';

/**
 * 0.2.85 / 01 — export DB-backed governance policies to per-org JSON files.
 *
 * The first half of the DB→files cutover (expand): exports each org's legacy
 * `governancePolicies` rows to the per-org JSON files that are now the source
 * of truth, then re-syncs the `configCache` mirror so V8 readers see the files
 * immediately. Leaves the legacy rows untouched — the DSAR pending split (02)
 * and the legacy-table drop (03) complete the cutover.
 *
 * Idempotent per org: re-running overwrites the same files with the same
 * content. `down` restores the pre-migration governance directory from the
 * fs-tree snapshot captured in `up`.
 */

import { isFilePolicyType } from '../../../../../lib/shared/schemas/governance';
import { internal } from '../../../../_generated/api';
import {
  resolveGovernanceDir,
  resolvePolicyFilePath,
  serializePolicyJson,
} from '../../../../governance/file_utils';
import { defineNodeMigration } from '../../../framework/define';
import type { LegacyGovernancePolicyRow } from '../legacy_governance';

const DOMAIN = 'governance';

export const migration = defineNodeMigration({
  title: 'Export governance policies from the database to per-org JSON files',
  description:
    'For every organization, reads each legacy governancePolicies row and ' +
    'writes it to its canonical per-org JSON file under <org>/governance/, ' +
    'then re-syncs the configCache mirror. Non-destructive to the database — ' +
    'the legacy rows are dropped later by 0.2.85/03. A per-org filesystem ' +
    'snapshot of the governance directory is taken first so down can restore ' +
    'the prior files.',
  destructive: false,
  snapshot: 'fs-tree',
  subjects: { tables: ['governancePolicies'], domains: ['governance'] },

  async up(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(dir);

    const rows: LegacyGovernancePolicyRow[] = await ctx.runQuery(
      internal.migrations.versions.v0_2_85.legacy_governance
        .listGovernancePoliciesByOrg,
      { organizationId: org.id },
    );

    for (const row of rows) {
      // Only the flat per-file policy types live as <type>.json. Anything else
      // (e.g. the retention bounds catalog) has its own representation and is
      // out of scope for this export.
      if (!isFilePolicyType(row.policyType)) continue;
      const filePath = resolvePolicyFilePath(org.slug, row.policyType);
      const content = serializePolicyJson(row.policyType, row.config);
      await helpers.atomicWrite(filePath, content);
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

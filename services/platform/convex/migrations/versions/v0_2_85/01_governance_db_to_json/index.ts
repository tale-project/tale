'use node';

/**
 * Node migration: export each org's legacy `governancePolicies` rows to the
 * per-org JSON files that are now the source of truth, then re-sync the
 * `configCache` mirror so V8 readers see the files immediately.
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
import type { NodeMigration } from '../../../framework/types';
import type { LegacyGovernancePolicyRow } from '../legacy_governance';
import { meta } from './meta';

const DOMAIN = 'governance';

export const migration: NodeMigration = {
  meta,
  async up(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

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
    await helpers.restoreFsTree(meta.id, org.slug, dir);
    await ctx.runAction(
      internal.lib.config_cache.actions.syncConfigDomainFromFiles,
      { organizationId: org.id, domain: DOMAIN },
    );
  },
};

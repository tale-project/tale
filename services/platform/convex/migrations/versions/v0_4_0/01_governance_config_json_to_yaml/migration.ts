'use node';

/**
 * Convert each org's governance config tree from JSON to the canonical YAML
 * form, in place.
 *
 * `up` rewrites, per organization, every KNOWN file under
 * `<org>/governance/`:
 *
 *   - one file per governance policy type (`<policy-type>.json` →
 *     `<policy-type>.yml`), validated against its policy schema,
 *   - the retention bounds catalog (`retention.json` → `retention.yml`),
 *   - the nested SSO connection (`sso/connection.json` →
 *     `sso/connection.yml`),
 *
 * writing the `.yml` first and removing the `.json` only after that write
 * succeeded, then re-syncing the `configCache` mirrors for the `governance`
 * and `sso` domains. Readers already resolve yml-then-json, so orgs read
 * correctly before, during, and after this conversion.
 *
 * Deliberately untouched:
 *   - secrets sidecars (`*.secrets.json`, e.g. `sso/connection.secrets.json`)
 *     — secret material is excluded from the YAML conversion across the
 *     board: SOPS-managed blobs must stay byte-stable for their recipients,
 *     and the sign-in adapters read the sidecar by its exact name;
 *   - unknown `.json` files — a file no schema claims cannot be validated,
 *     so converting it would launder unchecked bytes into the canonical
 *     format. It stays as-is and keeps reading via the json fallback.
 *
 * Idempotent per org: a converted tree has no `.json` originals left, so a
 * re-run finds nothing to convert; a crash between write and remove leaves
 * both siblings, and the re-run simply converts the `.json` again. A corrupt
 * known file fails the org loudly rather than converting garbage.
 *
 * `down` restores the pre-conversion governance tree byte-for-byte from the
 * fs-tree snapshot taken at the start of `up`, then re-syncs both cache
 * domains.
 */

import { FILE_POLICY_TYPES } from '../../../../../lib/shared/schemas/governance';
import { internal } from '../../../../_generated/api';
import {
  parseSsoConnectionJson,
  resolveSsoConnectionFilePath,
  resolveSsoConnectionYamlFilePath,
  serializeSsoConnectionYaml,
} from '../../../../enterprise_sso/file_utils';
import {
  parsePolicyJson,
  parseRetentionJson,
  resolveGovernanceDir,
  resolvePolicyFilePath,
  resolvePolicyYamlFilePath,
  resolveRetentionFilePath,
  resolveRetentionYamlFilePath,
  serializePolicyYaml,
  serializeRetentionYaml,
} from '../../../../governance/file_utils';
import type { BoundNodeHelpers } from '../../../framework/define';
import { defineNodeMigration } from '../../../framework/define';
import type { NodeMigrationCtx } from '../../../framework/types';

/** Convert one `<base>.json` → `<base>.yml` and remove the original. A
 *  missing source is the idempotent no-op; a corrupt source throws. */
async function convertFile(
  helpers: BoundNodeHelpers,
  jsonPath: string,
  yamlPath: string,
  toYaml: (content: string) => string,
): Promise<void> {
  const content = await helpers.readFileSafe(jsonPath);
  if (content === null) return;
  await helpers.atomicWrite(yamlPath, toYaml(content));
  await helpers.removeFileSafe(jsonPath);
}

async function syncCaches(ctx: NodeMigrationCtx, orgId: string): Promise<void> {
  for (const domain of ['governance', 'sso']) {
    await ctx.runAction(
      internal.lib.config_cache.actions.syncConfigDomainFromFiles,
      { organizationId: orgId, domain },
    );
  }
}

export const migration = defineNodeMigration({
  title: 'Convert org governance config files from JSON to YAML',
  description:
    'For each organization, rewrites every known file under ' +
    '<org>/governance/ (the policy files, the retention bounds catalog, and ' +
    'the nested sso/connection.json) from JSON to the canonical YAML form ' +
    'and removes the JSON original; secrets sidecars are untouched. down ' +
    'restores the pre-conversion governance tree byte-for-byte from the ' +
    'fs-tree snapshot.',
  destructive: true,
  snapshot: 'fs-tree',
  // The sso files live inside the governance subtree, so one domain subject
  // covers both cache domains the handlers re-sync.
  subjects: { domains: ['governance'] },

  async up(ctx, org, helpers) {
    const dir = resolveGovernanceDir(org.slug);
    await helpers.snapshotFsTree(dir);

    for (const policyType of FILE_POLICY_TYPES) {
      await convertFile(
        helpers,
        resolvePolicyFilePath(org.slug, policyType),
        resolvePolicyYamlFilePath(org.slug, policyType),
        (content) =>
          serializePolicyYaml(policyType, parsePolicyJson(policyType, content)),
      );
    }

    await convertFile(
      helpers,
      resolveRetentionFilePath(org.slug),
      resolveRetentionYamlFilePath(org.slug),
      (content) => serializeRetentionYaml(parseRetentionJson(content)),
    );

    await convertFile(
      helpers,
      resolveSsoConnectionFilePath(org.slug),
      resolveSsoConnectionYamlFilePath(org.slug),
      (content) => serializeSsoConnectionYaml(parseSsoConnectionJson(content)),
    );

    await syncCaches(ctx, org.id);
  },

  async down(ctx, org, helpers) {
    await helpers.restoreFsTree(resolveGovernanceDir(org.slug));
    await syncCaches(ctx, org.id);
  },
});

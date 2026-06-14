import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.73 / 03 — fork the org-default `personalization` governance policy into
 * separate `custom_instructions` + `user_memories` policies.
 *
 * Shipped in v0.2.73 (verified against `git grep personalization v0.2.72` vs
 * `v0.2.73` over `convex/governance/` + `lib/shared/schemas/governance.ts`):
 * the `'personalization'` policyType was replaced by `'custom_instructions'`
 * and `'user_memories'` (the legacy literal was retained only as a deploy-window
 * slot the schema comment ties to `migrations/split_personalization_toggle`).
 * Operates on the legacy untyped `governancePolicies` table.
 *
 * up: for each row with `policyType === 'personalization'`, insert two rows
 * (`custom_instructions` and `user_memories`) copying its `config` + metadata,
 * then delete the original. Idempotent (skips if the forked rows already exist
 * for the org).
 * down: re-merge — for each org that has BOTH `custom_instructions` and
 * `user_memories` rows, reinsert a single `personalization` row (config taken
 * from the `custom_instructions` side, which `up` cloned identically) and
 * delete the two split rows.
 *
 * Reversible, no data loss (both forked rows carry the same cloned config).
 * Reference-only: the runner never executes it.
 */
export const meta: MigrationMeta = {
  id: '0.2.73/03_governance_personalization_policy_split',
  semver: '0.2.73',
  numericId: 3,
  slug: 'governance_personalization_policy_split',
  title: 'Fork personalization governance policy into per-feature policies',
  description:
    "Forks each governancePolicies row of policyType 'personalization' into two " +
    "rows ('custom_instructions' and 'user_memories') copying its config, then " +
    'deletes the original. down re-merges the two rows back into a single ' +
    'personalization row. Operates on the legacy untyped governancePolicies ' +
    'table. Reversible, no data loss.',
  kind: 'reference',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};

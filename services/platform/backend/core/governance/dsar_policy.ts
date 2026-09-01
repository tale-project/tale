import {
  DEFAULT_DSAR_GOVERNANCE,
  type DsarGovernanceConfig,
  dsarGovernanceConfigSchema,
} from '../../../lib/shared/schemas/governance';
import { readConfigCacheRow } from '../lib/config_cache/read';
import type { QueryCtx } from '../lib/ctx';

/**
 * Read the per-org `dsar_governance` policy's CURRENT effective config from
 * the file-derived `configCache`. A staged loosening change lives in
 * `dsarPolicyPendingChanges` and does NOT take effect until
 * `applyPendingDsarPolicyChange` flips the file; consumers that gate on policy
 * (e.g. `requestErasure`) only see the active config.
 *
 * Defaults: 24h cooling-off, no dual approval, 5 requests/admin/day.
 */
export async function getDsarPolicy(
  ctx: QueryCtx,
  organizationId: string,
): Promise<DsarGovernanceConfig> {
  const row = await readConfigCacheRow(
    ctx.db,
    organizationId,
    'governance',
    'dsar_governance',
  );

  if (!row) return DEFAULT_DSAR_GOVERNANCE;

  const parsed = dsarGovernanceConfigSchema.safeParse(row.config);
  if (!parsed.success) {
    console.warn(
      `Invalid dsar_governance config for org ${organizationId}; using defaults`,
      parsed.error,
    );
    return DEFAULT_DSAR_GOVERNANCE;
  }

  return parsed.data;
}

/**
 * Returns true when `next` is *strictly weaker* than `current` along
 * any axis — anyone editing a knob in the direction that makes erasure
 * easier or wider triggers the 24h grace window. Equal values along
 * every axis return false (no real change). Mixed (some stricter, some
 * looser) also returns true — the looser axis dominates.
 */
export function isLoosening(
  current: DsarGovernanceConfig,
  next: DsarGovernanceConfig,
): boolean {
  // Shorter cooling-off → easier to file destructive action sooner.
  if (next.coolingOffHours < current.coolingOffHours) return true;
  // Disabling the dual-approval gate.
  if (current.requireDualApproval && !next.requireDualApproval) return true;
  // Higher daily ceiling → more requests per actor.
  if (next.dailyLimitPerAdmin > current.dailyLimitPerAdmin) return true;
  return false;
}

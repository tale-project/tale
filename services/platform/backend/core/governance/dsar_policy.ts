import type { DsarGovernanceConfig } from '../../../lib/shared/schemas/governance';

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

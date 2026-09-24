/**
 * The competence register's shared vocabulary — what the backend register
 * (`backend/domains/governance/competence.ts`) enforces and the governance
 * screen shows: the reserved platform capabilities an organization admin can
 * delegate without an admin seat, and when a record vouches for its holder.
 */

/**
 * The reserved namespace: a slug under it names a platform capability,
 * never an organization's own qualification. A grant matches it without
 * regard to case, so `TALE:…` cannot pose as a capability it does not
 * confer. `removeMembershipCascade` (auth/membership.ts) revokes the live
 * grants under it by this same prefix.
 */
export const PLATFORM_CAPABILITY_PREFIX = 'tale:';

/**
 * Every platform capability the register can carry — a closed set: a grant
 * under the reserved namespace naming anything else is refused
 * (`COMPETENCE_CAPABILITY_UNKNOWN`). A slug joins it together with the door
 * that checks it through `holdsCapability`.
 */
export const PLATFORM_CAPABILITIES = [
  'tale:notifications.export',
  /** The REST door may act FOR another verified member the request names
   * (`actor` on a run's ask answer and a task's review decision —
   * `rest/actor.ts`), so a relayed gesture carries the person, not the key. */
  'tale:rest.act-as',
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

/** Whether `slug` is under the reserved namespace, whatever its case. */
export function isReservedCompetenceSlug(slug: string): boolean {
  return slug.trim().toLowerCase().startsWith(PLATFORM_CAPABILITY_PREFIX);
}

/** Whether `slug` names one of the platform capabilities exactly. */
export function isPlatformCapability(slug: string): slug is PlatformCapability {
  return (PLATFORM_CAPABILITIES as readonly string[]).includes(slug);
}

export type CompetenceRecordStatus = 'active' | 'expired' | 'revoked';

/**
 * Where a record stands at `now`: only an `active` one vouches for its
 * holder. A revocation outranks an expiry that came first.
 */
export function competenceRecordStatus(
  record: { expiresAt: number | null; revokedAt: number | null },
  now: number,
): CompetenceRecordStatus {
  if (record.revokedAt !== null) return 'revoked';
  if (record.expiresAt !== null && record.expiresAt <= now) return 'expired';
  return 'active';
}

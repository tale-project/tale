/**
 * The competence register's shared vocabulary — what the backend register
 * (`backend/domains/governance/competence.ts`) enforces and the governance
 * screen shows: the reserved platform capabilities an organization admin can
 * delegate without an admin seat, and when a record vouches for its holder.
 */

import type { OrgWideAudienceMode } from '@tale/shared/schemas/governance';

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
  /** Call the organization's models with a personal API key through the
   * OpenAI- and Anthropic-compatible endpoints, once the model-access
   * policy turns them on — the right owners, admins and developers carry by
   * role (`backend/domains/model_api/access.ts` `mayCallModelApi`). */
  'tale:models.api',
  'tale:notifications.export',
  /** The REST door may act FOR another verified member the request names
   * (`actor` on a run's ask answer and a task's review decision —
   * `rest/actor.ts`), so a relayed gesture carries the person, not the key. */
  'tale:rest.act-as',
  /** Give a skill an organization-wide audience whatever the
   * organization's `skill_sharing` policy reserves it for — create one,
   * widen one, change one in place (`backend/core/lib/audience.ts`
   * `mayChooseOrgWideAudience`). */
  'tale:skills.publish',
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

/**
 * What a member's role alone says at a platform capability's door, before
 * any grant is read: `admits` — the role carries the right; `refuses` — a
 * disabled seat, which no grant opens; `grant` — only a live grant in the
 * register admits them. Each door decides its role through a function it
 * exports, and a member's rights read the same function
 * (`backend/domains/governance/member-rights.ts`).
 */
export type RoleStanding = 'admits' | 'refuses' | 'grant';

/**
 * Why a member has or lacks a platform capability: the facts the door that
 * checks it weighs, in the order it weighs them, as the server reads them.
 * A client renders them and never derives one.
 */
export type MemberRightReason =
  /** The organization's model endpoints switch (`tale:models.api`): off,
   * or a policy that cannot be read, shuts the door for every member. */
  | {
      kind: 'organization';
      setting: 'model_api';
      state: 'on' | 'off' | 'unreadable';
    }
  /** The skill sharing policy's mode (`tale:skills.publish`): the roles
   * that share a skill with the whole organization without a grant. */
  | { kind: 'policy'; policy: 'skill_sharing'; mode: OrgWideAudienceMode }
  /** What the member's role alone says. */
  | { kind: 'role'; standing: RoleStanding }
  /** The member's own unrevoked grant in the register: `active`, or
   * `expired` and so no longer vouching. */
  | {
      kind: 'grant';
      recordId: string;
      /** The granting admin's user id. */
      grantedBy: string;
      grantedAt: number;
      expiresAt: number | null;
      status: 'active' | 'expired';
    }
  /** An unrevoked grant to a team the member was added to by an admin, the
   * rule `holdsCapability` reads (`vouchesForUser`): `active`, or `expired`
   * and so no longer vouching. One for each such team. */
  | {
      kind: 'team';
      recordId: string;
      teamId: string;
      /** The team's name; `null` once the team is gone. */
      teamName: string | null;
      /** The granting admin's user id. */
      grantedBy: string;
      grantedAt: number;
      expiresAt: number | null;
      status: 'active' | 'expired';
    }
  /** No unrevoked grant, of the member's own or a team's, where only a
   * grant would admit the member. */
  | { kind: 'no-grant' };

/** One platform capability as it stands for one member. */
export interface MemberRight {
  capability: PlatformCapability;
  /** The door's own verdict for the member now. */
  held: boolean;
  /** The active grant a revocation ends, or `null`. */
  grantId: string | null;
  reasons: MemberRightReason[];
}

/** A member's platform rights, every capability in
 * {@link PLATFORM_CAPABILITIES} order
 * (`GET /api/app/governance/members/:userId/rights`). */
export interface MemberRights {
  userId: string;
  /** The member's organization role, lowercase. */
  role: string;
  rights: MemberRight[];
}

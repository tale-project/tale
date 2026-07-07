import type { BetterAuthMember, BetterAuthUser } from '../../members/types';
import {
  isNormalizedAuthEmail,
  normalizeAuthEmail,
} from './normalize_auth_email';

export type MergeSkipReason = 'dual-owner' | 'role-conflict' | 'empty-group';

const ROLE_RANK: Record<string, number> = {
  owner: 6,
  admin: 5,
  developer: 4,
  editor: 3,
  member: 2,
  disabled: 1,
};

function roleRank(role: string | undefined): number {
  return ROLE_RANK[(role ?? '').toLowerCase()] ?? 0;
}

export function pickHigherMemberRole(
  roleA: string | undefined,
  roleB: string | undefined,
): string {
  const a = (roleA ?? 'member').toLowerCase();
  const b = (roleB ?? 'member').toLowerCase();
  if (a === 'owner' || b === 'owner') {
    return 'owner';
  }
  return roleRank(a) >= roleRank(b) ? a : b;
}

/**
 * Choose the surviving user row when several share the same normalized email.
 */
export function selectCanonicalAuthUser(
  users: readonly BetterAuthUser[],
): BetterAuthUser | undefined {
  if (users.length === 0) return undefined;
  const sorted = [...users].sort((a, b) => {
    const aNorm = isNormalizedAuthEmail(a.email) ? 1 : 0;
    const bNorm = isNormalizedAuthEmail(b.email) ? 1 : 0;
    if (aNorm !== bNorm) return bNorm - aNorm;
    const aVerified = a.emailVerified ? 1 : 0;
    const bVerified = b.emailVerified ? 1 : 0;
    if (aVerified !== bVerified) return bVerified - aVerified;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a._id.localeCompare(b._id);
  });
  return sorted[0];
}

export function groupAuthUsersByNormalizedEmail(
  users: readonly BetterAuthUser[],
): Map<string, BetterAuthUser[]> {
  const groups = new Map<string, BetterAuthUser[]>();
  for (const user of users) {
    const key = normalizeAuthEmail(user.email);
    const bucket = groups.get(key) ?? [];
    bucket.push(user);
    groups.set(key, bucket);
  }
  return groups;
}

/**
 * Refuse automatic merge when two owner memberships would land in the same org.
 */
export function assessAuthUserMergeSafety(
  membershipsByUserId: ReadonlyMap<string, readonly BetterAuthMember[]>,
  userIds: readonly string[],
): { safe: true } | { safe: false; reason: MergeSkipReason } {
  const ownersByOrg = new Map<string, number>();
  for (const userId of userIds) {
    for (const member of membershipsByUserId.get(userId) ?? []) {
      if ((member.role ?? '').toLowerCase() !== 'owner') continue;
      const count = (ownersByOrg.get(member.organizationId) ?? 0) + 1;
      ownersByOrg.set(member.organizationId, count);
      if (count > 1) {
        return { safe: false, reason: 'dual-owner' };
      }
    }
  }
  return { safe: true };
}

export type ResolvedEmailGroupAction = 'noop' | 'rename' | 'merge' | 'skip';

export function resolveEmailGroupAction(
  users: readonly BetterAuthUser[],
  safety: { safe: true } | { safe: false; reason: MergeSkipReason },
): ResolvedEmailGroupAction {
  if (users.length === 0) return 'noop';
  if (users.length === 1) {
    return isNormalizedAuthEmail(users[0].email) ? 'noop' : 'rename';
  }
  return safety.safe ? 'merge' : 'skip';
}

export type CanonicalUserFieldMerge = {
  email: string;
  emailVerified: boolean;
  lastActiveOrganizationId?: string;
  name: string;
};

/** Merge scalar user fields onto the canonical row after duplicate absorption. */
export function mergeCanonicalUserFields(
  canonical: BetterAuthUser,
  duplicate: BetterAuthUser,
  normalizedEmail: string,
): CanonicalUserFieldMerge {
  const lastActiveOrganizationId =
    canonical.lastActiveOrganizationId ?? duplicate.lastActiveOrganizationId;
  const name =
    canonical.name.trim().length > 0
      ? canonical.name
      : (duplicate.name ?? canonical.name);
  return {
    email: normalizedEmail,
    emailVerified: canonical.emailVerified || duplicate.emailVerified,
    ...(lastActiveOrganizationId ? { lastActiveOrganizationId } : {}),
    name,
  };
}

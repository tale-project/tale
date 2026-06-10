import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

export type Member = ConvexItemOf<
  typeof api.members.queries.listByOrganization
>;

export type MemberPasskey = ConvexItemOf<
  typeof api.two_factor.queries.listPasskeysForMember
>;

export function useMembers(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.members.queries.listByOrganization,
    { organizationId },
  );

  return {
    members: data,
    isLoading,
  };
}

/**
 * Admin view of a member's registered passkeys (#1508). Pass `undefined`
 * to skip — the member edit dialog only fetches while it is open.
 */
export function useMemberPasskeys(memberId: string | undefined) {
  return useConvexQuery(
    api.two_factor.queries.listPasskeysForMember,
    memberId ? { memberId } : 'skip',
  );
}

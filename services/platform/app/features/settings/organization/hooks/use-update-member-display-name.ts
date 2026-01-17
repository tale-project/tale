import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateMemberDisplayName(organizationId: string) {
  return useMutation(api.mutations.member.updateMemberDisplayName).withOptimisticUpdate(
    (localStore, args) => {
      // Validate display name before optimistic update
      const trimmed = args.displayName?.trim();
      if (!trimmed) {
        return;
      }

      const current = localStore.getQuery(api.queries.member.listByOrganization, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.queries.member.listByOrganization,
          { organizationId },
          current.map((member) =>
            member._id === args.memberId
              ? { ...member, displayName: trimmed }
              : member,
          ),
        );
      }
    },
  );
}

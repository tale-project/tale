import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateMemberRole(organizationId: string) {
  return useMutation(api.mutations.member.updateMemberRole).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.members.queries.listByOrganization, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.members.queries.listByOrganization,
          { organizationId },
          current.map((member) =>
            member._id === args.memberId
              ? { ...member, role: args.role }
              : member
          )
        );
      }
    }
  );
}

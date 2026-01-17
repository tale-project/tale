import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useRemoveMember(organizationId: string) {
  return useMutation(api.mutations.member.removeMember).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.members.queries.listByOrganization, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.members.queries.listByOrganization,
          { organizationId },
          current.filter((member) => member._id !== args.memberId)
        );
      }
    }
  );
}

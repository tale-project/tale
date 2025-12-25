import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

export function useUpdateMemberRole() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.member.updateMemberRole).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.member.listByOrganization, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.member.listByOrganization,
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

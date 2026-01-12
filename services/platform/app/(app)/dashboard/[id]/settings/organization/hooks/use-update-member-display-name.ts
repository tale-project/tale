import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

export function useUpdateMemberDisplayName() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.member.updateMemberDisplayName).withOptimisticUpdate(
    (localStore, args) => {
      // Validate display name before optimistic update
      const trimmed = args.displayName?.trim();
      if (!trimmed) {
        return;
      }

      const current = localStore.getQuery(api.member.listByOrganization, {
        organizationId,
      });
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.member.listByOrganization,
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

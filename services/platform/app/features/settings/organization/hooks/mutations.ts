import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexOptimisticMutation } from '@/app/hooks/use-convex-optimistic-mutation';
import { api } from '@/convex/_generated/api';

export function useSetMemberPassword() {
  return useConvexMutation(api.users.mutations.setMemberPassword);
}

export function useCreateMember() {
  return useConvexOptimisticMutation(
    api.users.mutations.createMember,
    api.members.queries.listByOrganization,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ organizationId, email, displayName, role }, { insert }) =>
        insert({
          organizationId,
          userId: '',
          role: role ?? 'member',
          createdAt: Date.now(),
          displayName,
          email,
        }),
    },
  );
}

export function useRemoveMember() {
  return useConvexOptimisticMutation(
    api.members.mutations.removeMember,
    api.members.queries.listByOrganization,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ memberId }, { remove }) => remove(memberId),
    },
  );
}

export function useUpdateMemberRole() {
  return useConvexOptimisticMutation(
    api.members.mutations.updateMemberRole,
    api.members.queries.listByOrganization,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ memberId, ...changes }, { update }) =>
        update(memberId, changes),
    },
  );
}

export function useUpdateMemberDisplayName() {
  return useConvexOptimisticMutation(
    api.members.mutations.updateMemberDisplayName,
    api.members.queries.listByOrganization,
    {
      queryArgs: (organizationId) => ({ organizationId }),
      onMutate: ({ memberId, ...changes }, { update }) =>
        update(memberId, changes),
    },
  );
}

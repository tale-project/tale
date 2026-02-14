import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useSetMemberPassword() {
  return useConvexMutation(api.users.mutations.setMemberPassword);
}

export function useCreateMember() {
  return useConvexMutation(api.users.mutations.createMember);
}

export function useRemoveMember() {
  const { mutateAsync } = useConvexMutation(api.members.mutations.removeMember);
  return mutateAsync;
}

export function useUpdateMemberRole() {
  const { mutateAsync } = useConvexMutation(
    api.members.mutations.updateMemberRole,
  );
  return mutateAsync;
}

export function useUpdateMemberDisplayName() {
  const { mutateAsync } = useConvexMutation(
    api.members.mutations.updateMemberDisplayName,
  );
  return mutateAsync;
}

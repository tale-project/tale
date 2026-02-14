import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useSetMemberPassword() {
  return useConvexMutation(api.users.mutations.setMemberPassword);
}

export function useCreateMember() {
  return useConvexMutation(api.users.mutations.createMember);
}

export function useRemoveMember() {
  return useConvexMutation(api.members.mutations.removeMember);
}

export function useUpdateMemberRole() {
  return useConvexMutation(api.members.mutations.updateMemberRole);
}

export function useUpdateMemberDisplayName() {
  return useConvexMutation(api.members.mutations.updateMemberDisplayName);
}

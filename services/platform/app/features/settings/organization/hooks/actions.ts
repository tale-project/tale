import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useSetMemberPassword() {
  return useConvexAction(api.users.actions.setMemberPassword);
}

export function useCreateMember() {
  return useConvexAction(api.users.actions.createMember);
}

export function useAddMember() {
  return useConvexAction(api.members.actions.addMember);
}

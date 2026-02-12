import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useAddTeamMember() {
  return useConvexAction(api.team_members.actions.addMember);
}

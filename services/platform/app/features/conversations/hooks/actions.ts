import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useImproveMessage() {
  return useConvexActionMutation(api.conversations.actions.improveMessage);
}

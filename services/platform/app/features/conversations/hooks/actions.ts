import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useImproveMessage() {
  return useConvexAction(api.conversations.actions.improveMessage);
}

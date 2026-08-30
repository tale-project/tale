import { useConvexAction } from '@/app/hooks/use-convex-action';

export function useImproveMessage() {
  return useConvexAction('conversations/actions:improveMessage');
}

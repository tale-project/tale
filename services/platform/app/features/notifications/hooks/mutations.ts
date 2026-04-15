import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useMarkNotificationRead() {
  return useConvexMutation(api.notifications.mutations.markRead);
}

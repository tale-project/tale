import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useSetNotificationPreferences() {
  return useConvexMutation('collab/preferences:setNotificationPreferences');
}

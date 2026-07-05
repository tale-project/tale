import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useSetNotificationPreferences() {
  return useConvexMutation(api.collab.preferences.setNotificationPreferences);
}

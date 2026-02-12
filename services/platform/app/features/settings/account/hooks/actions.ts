import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useUpdatePassword() {
  return useConvexAction(api.users.actions.updateUserPassword);
}

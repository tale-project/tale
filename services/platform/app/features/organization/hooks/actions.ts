import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useInitializeDefaultWorkflows() {
  return useConvexAction(api.organizations.actions.initializeDefaultWorkflows);
}

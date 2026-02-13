import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useInitializeDefaultWorkflows() {
  return useConvexActionMutation(
    api.organizations.actions.initializeDefaultWorkflows,
  );
}

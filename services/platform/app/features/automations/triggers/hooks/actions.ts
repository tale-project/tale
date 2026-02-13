import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateCron() {
  return useConvexActionMutation(
    api.workflows.triggers.actions.generateCronExpression,
  );
}

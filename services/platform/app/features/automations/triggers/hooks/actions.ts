import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useGenerateCron() {
  return useConvexAction(api.workflows.triggers.actions.generateCronExpression);
}

export function useCreateWebhook() {
  return useConvexAction(api.workflows.triggers.actions.createWebhook);
}

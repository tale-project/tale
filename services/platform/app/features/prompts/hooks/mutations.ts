import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreatePrompt() {
  return useConvexMutation(api.prompts.mutations.createPrompt);
}

export function useUpdatePrompt() {
  return useConvexMutation(api.prompts.mutations.updatePrompt);
}

export function useDeletePrompt() {
  return useConvexMutation(api.prompts.mutations.deletePrompt);
}

export function useIncrementPromptUsage() {
  return useConvexMutation(api.prompts.mutations.incrementUsage);
}

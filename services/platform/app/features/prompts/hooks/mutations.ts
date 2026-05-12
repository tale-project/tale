import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreatePrompt() {
  return useConvexMutation(api.prompts.mutations.createPrompt);
}

/**
 * Save a prompt with an AI-generated title (10s timeout, PROMPT-XXXXX fallback).
 * Prefer this over useCreatePrompt when the user is saving without entering a title.
 */
export function useSavePrompt() {
  return useConvexAction(api.prompts.actions.savePrompt);
}

/**
 * Update prompt metadata and/or content. Each content change is an instant
 * publish that bumps the version and pushes the prior content into history.
 */
export function useUpdatePrompt() {
  return useConvexMutation(api.prompts.mutations.updatePrompt);
}

export function useDeletePrompt() {
  return useConvexMutation(api.prompts.mutations.deletePrompt);
}

export function useIncrementPromptUsage() {
  return useConvexMutation(api.prompts.mutations.incrementUsage);
}

export function useRestorePromptFromVersion() {
  return useConvexMutation(api.prompts.mutations.restoreFromVersion);
}

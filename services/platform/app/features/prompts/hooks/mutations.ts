import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Save a prompt with an AI-generated title (10s timeout, PROMPT-XXXXX fallback).
 * Used by the chat "save from message bubble" flow where the user hasn't
 * authored a title yet.
 */
export function useSavePrompt() {
  return useConvexAction(api.prompts.actions.savePrompt);
}

/**
 * Create a prompt directly with a user-supplied title. Used by the library
 * "Create prompt" flow which renders the full PromptFormDialog.
 */
export function useCreatePrompt() {
  return useConvexMutation(api.prompts.mutations.createPrompt);
}

/**
 * Update prompt metadata and/or content. Each change (content OR metadata)
 * bumps the version and pushes the prior state into history.
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

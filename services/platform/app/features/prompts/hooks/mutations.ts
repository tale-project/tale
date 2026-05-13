import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Save a prompt with an AI-generated title (10s timeout, PROMPT-XXXXX fallback).
 * The only create path used by the UI — direct callers of createPrompt are
 * server-side (e.g. the chat "save as prompt" action).
 */
export function useSavePrompt() {
  return useConvexAction(api.prompts.actions.savePrompt);
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

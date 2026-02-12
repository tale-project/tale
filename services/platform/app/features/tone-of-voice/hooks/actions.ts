import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

// Note: useAction returns AI-generated content - can't predict result
export function useGenerateTone() {
  return useConvexAction(api.tone_of_voice.actions.generateToneOfVoice);
}

export function useUpsertTone() {
  return useConvexAction(api.tone_of_voice.actions.upsertToneOfVoice);
}

export function useUpdateExample() {
  return useConvexAction(api.tone_of_voice.actions.updateExampleMessage);
}

export function useDeleteExample() {
  return useConvexAction(api.tone_of_voice.actions.deleteExampleMessage);
}

export function useAddExample() {
  return useConvexAction(api.tone_of_voice.actions.addExampleMessage);
}

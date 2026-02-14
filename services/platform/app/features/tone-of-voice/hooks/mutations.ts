import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertTone() {
  return useConvexMutation(api.tone_of_voice.mutations.upsertToneOfVoice);
}

export function useUpdateExample() {
  return useConvexMutation(api.tone_of_voice.mutations.updateExampleMessage);
}

export function useDeleteExample() {
  return useConvexMutation(api.tone_of_voice.mutations.deleteExampleMessage);
}

export function useAddExample() {
  return useConvexMutation(api.tone_of_voice.mutations.addExampleMessage);
}

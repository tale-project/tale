import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useUpsertTone() {
  return useConvexMutation(api.tone_of_voice.mutations.upsertToneOfVoice, {
    invalidates: [api.tone_of_voice.queries.getToneOfVoiceWithExamples],
  });
}

export function useUpdateExample() {
  return useConvexMutation(api.tone_of_voice.mutations.updateExampleMessage, {
    invalidates: [api.tone_of_voice.queries.getToneOfVoiceWithExamples],
  });
}

export function useDeleteExample() {
  return useConvexMutation(api.tone_of_voice.mutations.deleteExampleMessage, {
    invalidates: [api.tone_of_voice.queries.getToneOfVoiceWithExamples],
  });
}

export function useAddExample() {
  return useConvexMutation(api.tone_of_voice.mutations.addExampleMessage, {
    invalidates: [api.tone_of_voice.queries.getToneOfVoiceWithExamples],
  });
}

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpsertTone(organizationId: string) {
  return useMutation(api.tone_of_voice.mutations.upsert_tone_of_voice.upsertToneOfVoice).withOptimisticUpdate(
    (localStore, args) => {
      if (!args.generatedTone) return;

      const current = localStore.getQuery(
        api.tone_of_voice.queries.get_tone_of_voice.getToneOfVoiceWithExamples,
        { organizationId }
      );
      if (current !== undefined && current !== null && current.toneOfVoice) {
        localStore.setQuery(
          api.tone_of_voice.queries.get_tone_of_voice.getToneOfVoiceWithExamples,
          { organizationId },
          {
            ...current,
            toneOfVoice: { ...current.toneOfVoice, generatedTone: args.generatedTone },
          }
        );
      }
    }
  );
}

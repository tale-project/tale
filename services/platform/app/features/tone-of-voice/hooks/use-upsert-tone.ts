import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpsertTone() {
  return useMutation(api.tone_of_voice.mutations.upsertToneOfVoice).withOptimisticUpdate(
    (localStore, args) => {
      if (!args.generatedTone) return;

      const current = localStore.getQuery(
        api.tone_of_voice.queries.getToneOfVoiceWithExamples,
        { organizationId: args.organizationId }
      );
      if (current !== undefined && current !== null && current.toneOfVoice) {
        localStore.setQuery(
          api.tone_of_voice.queries.getToneOfVoiceWithExamples,
          { organizationId: args.organizationId },
          {
            ...current,
            toneOfVoice: { ...current.toneOfVoice, generatedTone: args.generatedTone },
          }
        );
      }
    }
  );
}

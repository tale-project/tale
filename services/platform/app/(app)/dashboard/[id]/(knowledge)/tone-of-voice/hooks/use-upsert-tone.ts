import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

export function useUpsertTone() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.tone_of_voice.upsertToneOfVoice).withOptimisticUpdate(
    (localStore, args) => {
      if (!args.generatedTone) return;

      const current = localStore.getQuery(
        api.tone_of_voice.getToneOfVoiceWithExamples,
        { organizationId }
      );
      if (current !== undefined && current !== null && current.toneOfVoice) {
        localStore.setQuery(
          api.tone_of_voice.getToneOfVoiceWithExamples,
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

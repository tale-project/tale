import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useDeleteExample(organizationId: string) {
  return useMutation(api.tone_of_voice.mutations.example_messages.deleteExampleMessage).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(
        api.tone_of_voice.queries.get_tone_of_voice.getToneOfVoiceWithExamples,
        { organizationId }
      );
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.tone_of_voice.queries.get_tone_of_voice.getToneOfVoiceWithExamples,
          { organizationId },
          {
            ...current,
            examples: current.examples.filter(
              (example: { _id: string }) => example._id !== args.messageId
            ),
          }
        );
      }
    }
  );
}

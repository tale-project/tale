import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

export function useDeleteExample() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.tone_of_voice.deleteExampleMessage).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(
        api.tone_of_voice.getToneOfVoiceWithExamples,
        { organizationId }
      );
      if (current !== undefined && current !== null) {
        localStore.setQuery(
          api.tone_of_voice.getToneOfVoiceWithExamples,
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

import { useMutation } from 'convex/react';
import { useParams } from 'next/navigation';
import { api } from '@/convex/_generated/api';

export function useUpdateExample() {
  const params = useParams();
  const organizationId = params?.id as string;

  return useMutation(api.tone_of_voice.updateExampleMessage).withOptimisticUpdate(
    (localStore, args) => {
      if (!args.content) return;

      const current = localStore.getQuery(
        api.tone_of_voice.getToneOfVoiceWithExamples,
        { organizationId }
      );
      if (current !== undefined && current !== null) {
        type Example = (typeof current.examples)[number];
        localStore.setQuery(
          api.tone_of_voice.getToneOfVoiceWithExamples,
          { organizationId },
          {
            ...current,
            examples: current.examples.map((example: Example) =>
              example._id === args.messageId
                ? { ...example, content: args.content! }
                : example
            ),
          }
        );
      }
    }
  );
}

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export function useToneOfVoiceWithExamples(organizationId: string) {
  return useConvexQuery(api.tone_of_voice.queries.getToneOfVoiceWithExamples, {
    organizationId,
  });
}

export function useHasExampleMessages(organizationId: string) {
  return useConvexQuery(api.tone_of_voice.queries.hasExampleMessages, {
    organizationId,
  });
}

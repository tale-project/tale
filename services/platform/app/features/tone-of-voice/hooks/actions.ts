import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useGenerateTone() {
  return useConvexAction(api.tone_of_voice.actions.generateToneOfVoice, {
    invalidates: [api.tone_of_voice.queries.getToneOfVoiceWithExamples],
  });
}

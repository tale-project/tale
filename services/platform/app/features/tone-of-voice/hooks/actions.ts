import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

// Note: useAction returns AI-generated content - can't predict result
export function useGenerateTone() {
  return useConvexAction(api.tone_of_voice.actions.generateToneOfVoice);
}

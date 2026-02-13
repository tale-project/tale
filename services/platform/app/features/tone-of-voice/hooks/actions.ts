import { useConvexActionMutation } from '@/app/hooks/use-convex-action-mutation';
import { api } from '@/convex/_generated/api';

export function useGenerateTone() {
  return useConvexActionMutation(api.tone_of_voice.actions.generateToneOfVoice);
}

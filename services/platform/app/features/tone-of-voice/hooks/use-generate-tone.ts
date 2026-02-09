import { useAction } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: useAction returns AI-generated content - can't predict result
export function useGenerateTone() {
  return useAction(api.tone_of_voice.actions.generateToneOfVoice);
}

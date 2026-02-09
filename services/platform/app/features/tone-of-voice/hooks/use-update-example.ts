import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUpdateExample() {
  return useMutation(api.tone_of_voice.mutations.updateExampleMessage);
}

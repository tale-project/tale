import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useDeleteExample() {
  return useMutation(api.tone_of_voice.mutations.deleteExampleMessage);
}

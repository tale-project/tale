import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Create operation - creates draft version from active workflow
export function useCreateDraftFromActive() {
  return useMutation(api.wf_definitions.mutations.createDraftFromActive.createDraftFromActivePublic);
}

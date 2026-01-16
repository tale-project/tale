import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Complex state change - converts draft to active version
export function usePublishAutomationDraft() {
  return useMutation(api.wf_definitions.mutations.publishDraft.publishDraftPublic);
}

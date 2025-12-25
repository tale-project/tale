import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Create operation - navigates to new draft page after creation
export function useCreateAutomationDraft() {
  return useMutation(api.wf_definitions.createWorkflowDraftPublic);
}

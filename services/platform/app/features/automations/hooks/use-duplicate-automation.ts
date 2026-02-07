import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Create operation - clones workflow with new ID
export function useDuplicateAutomation() {
  return useMutation(api.wf_definitions.mutations.duplicateWorkflow);
}

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Create operation - navigates to new automation page after creation
export function useCreateAutomation() {
  return useMutation(api.wf_definitions.mutations.createWorkflowWithStepsPublic);
}

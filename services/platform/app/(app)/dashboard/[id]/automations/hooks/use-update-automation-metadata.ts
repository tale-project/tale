import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Updates single workflow - uses dedicated getWorkflow query, not list
export function useUpdateAutomationMetadata() {
  return useMutation(api.wf_definitions.updateWorkflowMetadata);
}

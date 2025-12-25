import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Optimistic updates not added - automations table uses local state for filtering
export function useDeleteAutomation() {
  return useMutation(api.wf_definitions.deleteWorkflowPublic);
}

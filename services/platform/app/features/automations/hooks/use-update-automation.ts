import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

// Note: Updates workflow steps/config - complex nested structure
export function useUpdateAutomation() {
  return useMutation(api.wf_definitions.mutations.updateWorkflow);
}

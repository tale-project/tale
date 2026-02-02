/**
 * Hook for updating workflow step definitions
 */

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useUpdateStep() {
  return useMutation(api.wf_step_defs.mutations.updateStepPublic);
}

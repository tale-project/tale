/**
 * Hook for creating workflow step definitions
 */

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useCreateStep() {
  // @ts-expect-error TS2589: Convex API type instantiation is excessively deep
  return useMutation(api.wf_step_defs.mutations.createStepPublic);
}

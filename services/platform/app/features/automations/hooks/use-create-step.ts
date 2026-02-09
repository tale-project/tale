import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useCreateStep() {
  return useMutation(api.wf_step_defs.mutations.createStep);
}

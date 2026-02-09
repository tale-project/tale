import { useMutation } from 'convex/react';

import { api } from '@/convex/_generated/api';

export function useUnpublishAutomation() {
  return useMutation(api.wf_definitions.mutations.unpublishWorkflow);
}

import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

export function useRepublishAutomation() {
  return useMutation(api.wf_definitions.mutations.republishWorkflow);
}

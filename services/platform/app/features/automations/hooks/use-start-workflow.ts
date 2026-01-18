import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Triggers workflow execution - creates execution record
export function useStartWorkflow() {
  return useMutation(api.workflow_engine.engine.startWorkflow);
}

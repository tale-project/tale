import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: useAction - execution status updated via realtime subscription
export function useCancelExecution() {
  return useAction(api.wf_executions.cancelExecution);
}

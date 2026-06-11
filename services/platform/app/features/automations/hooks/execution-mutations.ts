import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Resume a debug-paused execution: 'step' runs the paused node and pauses
 * again before the next one, 'continue' runs to the end (#1490).
 */
export function useResumeDebugStep() {
  return useConvexMutation(api.wf_executions.mutations.resumeDebugStep);
}

/** Cancel a running execution (also serves as debug "Stop"). */
export function useCancelExecution() {
  return useConvexMutation(api.wf_executions.mutations.cancelExecution);
}

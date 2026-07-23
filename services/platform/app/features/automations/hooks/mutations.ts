import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

/**
 * Write hooks for the automations surface.
 *
 * Every one of these opts out of the generic error toast: each has a refusal
 * the author needs to READ, not a generic failure. Saving a version can be
 * refused by the store's naming rules; deploying is refused by the deploy gate
 * when the version was saved with failing tests; starting a live run is refused
 * when nothing is deployed. The call sites surface the server's own message,
 * because "something went wrong" would hide the one sentence that says what to
 * do next.
 *
 * The listings are reactive queries, so none of these invalidate anything.
 */

/** Append a version of the automation's document. */
export function useSaveAutomation() {
  return useConvexMutation(api.automations.mutations.saveWorkflow, {
    errorToast: false,
  });
}

/** Promote one version to the single live version of the automation. */
export function useDeployAutomation() {
  return useConvexMutation(api.automations.mutations.deployWorkflow, {
    errorToast: false,
  });
}

/** Start a run — `mock` performs no IO, `live` may reach the outside world. */
export function useStartAutomationRun() {
  return useConvexMutation(api.automations.mutations.startRun, {
    errorToast: false,
  });
}

/** Stop a run that has not finished. */
export function useCancelAutomationRun() {
  return useConvexMutation(api.automations.mutations.cancelRun, {
    errorToast: false,
  });
}

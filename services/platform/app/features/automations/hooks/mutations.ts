import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

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
  return useBackendMutation('automations/mutations:saveAutomation', {
    errorToast: false,
  });
}

/** Promote one version to the single live version of the automation. */
export function useDeployAutomation() {
  return useBackendMutation('automations/mutations:deployAutomation', {
    errorToast: false,
  });
}

/** Resolve a run's write-approval card: approve lets the parked node act on
 * the next stepper poll; reject fails it. */
export function useResolveRunApproval() {
  return useBackendMutation('approvals/mutations:updateApprovalStatus', {
    errorToast: false,
  });
}

/** Answer a run's pending `ask_human` question — records the answer and
 * resumes the parked agent conversation. */
export function useAnswerHumanAsk() {
  return useBackendMutation('automations/human_asks:answerAsk', {
    errorToast: false,
  });
}

/** Start a run — `mock` performs no IO, `live` may reach the outside world. */
export function useStartAutomationRun() {
  return useBackendMutation('automations/mutations:startRun', {
    errorToast: false,
  });
}

/** Stop a run that has not finished. */
export function useCancelAutomationRun() {
  return useBackendMutation('automations/mutations:cancelRun', {
    errorToast: false,
  });
}

/** Bind (or re-bind) what starts the automation. The result may carry a
 * webhook token — shown exactly once, so the call site must display it. */
export function useSetAutomationTrigger() {
  return useBackendMutation('automations/mutations:setTrigger', {
    errorToast: false,
  });
}

/** Unbind the automation's trigger; versions and run history stay. */
export function useDeleteAutomationTrigger() {
  return useBackendMutation('automations/mutations:deleteTrigger', {
    errorToast: false,
  });
}

/** Reconcile the automation's project bindings to exactly the given set —
 * empty makes it org-level. */
export function useSetAutomationProjects() {
  return useBackendMutation('automations/mutations:setAutomationProjects', {
    errorToast: false,
  });
}

/** Delete the automation — versions, deployment, triggers and bindings.
 * Refused while a run is still live; run history is kept. */
export function useDeleteAutomation() {
  return useBackendMutation('automations/mutations:deleteAutomation', {
    errorToast: false,
  });
}

/**
 * Run one authoring session from a goal. An ACTION, not a mutation — a
 * session spans minutes of model turns. TanStack's mutation state carries the
 * pending/error UX; the automation listing updates reactively as the session
 * saves versions, so the resolved value is only the closing summary.
 */
export function useStartBuilderSession() {
  return useBackendAction('automations_builder/actions:startBuilderSession');
}

import { backendErrorCode, backendErrorField } from '@/lib/utils/backend-error';

/** The sentence for a start the organization's policy refused, or
 * undefined for any other error. Covers handing a task to the standard
 * agent too: picking it creates it in the project, with the same refusals. */
export function taskRunErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  switch (backendErrorCode(error)) {
    case 'TASK_AUTOMATION_DISABLED':
      return t('agentRun.automationDisabled');
    case 'TASK_AUTOMATION_UNAVAILABLE':
      return t('agentRun.automationUnavailable');
    case 'STANDARD_AGENT_OFF':
      return t('agentRun.standardAgent.switchedOff');
    case 'STANDARD_AGENT_UNAVAILABLE':
      switch (backendErrorField(error, 'reason')) {
        case 'pin-unavailable':
          return t('agentRun.standardAgent.pinUnavailable');
        case 'harness-invalid':
          return t('agentRun.standardAgent.harnessInvalid');
        case 'unreadable':
          return t('agentRun.standardAgent.unreadable');
        default:
          return t('agentRun.standardAgent.noModel');
      }
    case 'STANDARD_AGENT_NOT_NEEDED':
      return t('agentRun.standardAgent.notNeeded');
    default:
      return undefined;
  }
}

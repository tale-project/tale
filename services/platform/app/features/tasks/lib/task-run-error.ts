import { backendErrorCode } from '@/lib/utils/backend-error';

export function taskRunErrorMessage(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  switch (backendErrorCode(error)) {
    case 'TASK_AUTOMATION_DISABLED':
      return t('agentRun.automationDisabled');
    case 'TASK_AUTOMATION_UNAVAILABLE':
      return t('agentRun.automationUnavailable');
    default:
      return undefined;
  }
}

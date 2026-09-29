import { backendErrorCode } from '@/lib/utils/backend-error';

/** The open-subtask guard's own words for a close it refused — a parent
 * cannot close while its subtasks remain open — or undefined for any other
 * failure. Only Done and Cancelled close a task. */
export function parentCloseRefusal(
  error: unknown,
  t: (key: string) => string,
): string | undefined {
  return backendErrorCode(error) === 'TASK_HAS_OPEN_SUBTASKS'
    ? t('detail.parentCloseGuard')
    : undefined;
}

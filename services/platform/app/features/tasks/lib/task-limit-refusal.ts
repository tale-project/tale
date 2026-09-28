import {
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
} from '@/backend/core/tasks/helpers';
import { backendErrorCode } from '@/lib/utils/backend-error';

/**
 * Localized copy for a task title or description the server refused for its
 * length — `TASK_TITLE_INVALID` (empty or over the cap) and
 * `TASK_DESCRIPTION_INVALID`, whose own sentence is English. It names the
 * cap in the reader's number format instead of the generic error toast: a
 * description an older import stored whole, past 20,000 units, could not be
 * saved from the board, and nothing said why.
 */
export function taskLimitRefusalMessage(
  error: unknown,
  t: (key: string, values?: Record<string, unknown>) => string,
  formatNumber: (value: number) => string,
): string | undefined {
  switch (backendErrorCode(error)) {
    case 'TASK_TITLE_INVALID':
      return t('errors.TASK_TITLE_INVALID', {
        max: formatNumber(TASK_TITLE_MAX),
      });
    case 'TASK_DESCRIPTION_INVALID':
      return t('errors.TASK_DESCRIPTION_INVALID', {
        max: formatNumber(TASK_DESCRIPTION_MAX),
      });
    default:
      return undefined;
  }
}

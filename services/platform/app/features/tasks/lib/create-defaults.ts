import { startOfTodayIn } from '@/lib/shared/task-repeat';
import { localTimeZone } from '@/lib/shared/zoned-time';

import type { TaskPriority } from './display';

/**
 * What a task made in the app starts with before anyone picks: Medium
 * priority and a start of today. Both are the app's choice, made where the
 * form opens — the create endpoint, an agent's `task_create`, imports and
 * repeat copies keep their own (no priority, no start), so nothing outside
 * the form changes meaning.
 */
export const DEFAULT_NEW_TASK_PRIORITY: TaskPriority = 'p2';

/** Today's local midnight — the value the date picker writes for "today". */
export function defaultNewTaskStartDate(now: number = Date.now()): number {
  return startOfTodayIn(localTimeZone(), now);
}

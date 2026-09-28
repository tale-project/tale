'use client';

import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';
import { taskRepeatCreateOn, type TaskRepeat } from '@/lib/shared/task-repeat';

/**
 * A task's rule in words, with when its next task is created — "Monthly on
 * day 30, next task on the due date" — in the reader's language. The rule's
 * own words are the design system's; the zone takes no part: it says where
 * the rule was set, not which days it names.
 */
export function useTaskRepeatLabel(): (rule: TaskRepeat) => string {
  const { t } = useT('tasks');
  const { sentence } = useRecurrenceFormat();
  return useCallback(
    (rule: TaskRepeat) => {
      const words = sentence(rule);
      return taskRepeatCreateOn(rule) === 'dueDate'
        ? t('repeat.ruleOnDue', { rule: words })
        : words;
    },
    [t, sentence],
  );
}

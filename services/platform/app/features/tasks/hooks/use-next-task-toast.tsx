'use client';

import * as ToastPrimitives from '@radix-ui/react-toast';
import { Button } from '@tale/ui/button';
import { useFormatDate } from '@tale/ui/use-format-date';
import { toast } from '@tale/ui/use-toast';

import type { TaskStatusWriteResult } from '@/app/lib/backend/contract/tasks';
import { useT } from '@/lib/i18n/client';

import { useStopTaskRepeat } from './use-stop-task-repeat';

/** Long enough to read the toast and reach its action (Radix also pauses
 *  the timer while the toast is hovered or focused). */
const NEXT_TASK_TOAST_MS = 10_000;

/**
 * Closing a repeating task creates its next task. Say so wherever the close
 * happened — the status picker, a board drag, the subject panel — from the
 * two write hooks every one of them goes through, with the way back: "Stop
 * repeating" ends the series from the closed task, and takes the next task
 * back while nobody has touched it yet. The toast is brief and, over a
 * dialog, outside its focus trap, so the same action stays on the task
 * beside its "Next task" link — and the toast's alternative text says so.
 */
export function useNextTaskToast(): (
  result: TaskStatusWriteResult,
  variables: { taskId: string },
) => void {
  const { t } = useT('tasks');
  const { formatDate } = useFormatDate();
  const { stop } = useStopTaskRepeat();

  return (result, { taskId }) => {
    const next = result?.nextTask;
    if (next === undefined) return;
    const stopLabel = t('repeat.stop.action');
    toast({
      title: t('repeat.nextCreated'),
      description:
        next.dueDate === undefined
          ? undefined
          : t('dueDate.due', {
              date: formatDate(new Date(next.dueDate), 'medium'),
            }),
      variant: 'success',
      duration: NEXT_TASK_TOAST_MS,
      action: (
        <ToastPrimitives.Action
          altText={t('repeat.stop.altText')}
          asChild
          onClick={() => void stop(taskId, next)}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
          >
            {stopLabel}
          </Button>
        </ToastPrimitives.Action>
      ),
    });
  };
}

'use client';

import { Button } from '@tale/ui/button';
import { CircleStop } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useTask } from '../hooks/queries';
import { useStopTaskRepeat } from '../hooks/use-stop-task-repeat';

/**
 * Whether focus is stranded where the stop left it: still on the button,
 * or dropped to something that contains it — the dialog, or the page —
 * while the button sat disabled or left. Focus someone moved to another
 * control since stays there.
 */
function focusStranded(button: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body) return true;
  return button !== null && active.contains(button);
}

/**
 * "Stop repeating" beside a task's "Next task" link: the "Next task
 * created" toast's action, kept on the task for as long as the series goes
 * on — the toast lasts seconds and, over a dialog, sits outside its focus
 * trap. It ends the series from this task, and takes the next task back
 * while nobody has touched it yet.
 *
 * The caller shows it only to someone who may change the task. It renders
 * nothing until the next task has loaded still carrying the rule, and
 * nothing once the stop has gone through, before the reads catch up — so
 * focus goes to `returnFocusTo`, the row's Repeat control, rather than
 * falling back to the dialog.
 */
export function TaskRepeatStopButton({
  taskId,
  nextTaskId,
  returnFocusTo,
}: {
  taskId: string;
  nextTaskId: string;
  /** The id of the control that takes focus once the stop goes through. */
  returnFocusTo?: string;
}) {
  const { t } = useT('tasks');
  const { task: next } = useTask(nextTaskId);
  const { stop, isPending } = useStopTaskRepeat();
  const [stopped, setStopped] = useState<{
    taskId: string;
    nextTaskId: string;
  } | null>(null);
  const currentTaskRef = useRef<{ taskId: string; nextTaskId: string } | null>({
    taskId,
    nextTaskId,
  });
  useLayoutEffect(() => {
    currentTaskRef.current = { taskId, nextTaskId };
    return () => {
      currentTaskRef.current = null;
    };
  }, [taskId, nextTaskId]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (
    (stopped?.taskId === taskId && stopped.nextTaskId === nextTaskId) ||
    next?.repeat === undefined
  )
    return null;
  const onStopped = (done: boolean) => {
    // A task panel can move on while this request is pending. Its result
    // belongs to the task that started it, never the new action or focus.
    if (
      !done ||
      currentTaskRef.current?.taskId !== taskId ||
      currentTaskRef.current.nextTaskId !== nextTaskId
    )
      return;
    if (returnFocusTo !== undefined && focusStranded(buttonRef.current)) {
      document.getElementById(returnFocusTo)?.focus();
    }
    setStopped({ taskId, nextTaskId });
  };
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground flex h-7 w-fit gap-1.5 px-1.5 font-normal"
      // The spinner takes the icon's place and size while the stop runs.
      icon={CircleStop}
      iconClassName="mr-0 size-3.5"
      isLoading={isPending}
      onClick={() =>
        void stop(taskId, { id: nextTaskId, number: next.number }).then(
          onStopped,
        )
      }
    >
      {t('repeat.stop.action')}
    </Button>
  );
}

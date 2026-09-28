import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Button } from '@tale/ui/button';
import { CornerDownRight } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useTask } from '../hooks/queries';

/**
 * The way from a closed repeating task to the copy it produced: "Next task:
 * KEY-12" under its Repeat row, opening the copy in the same surface. The
 * copy lives in the same project, so the project's key names it. Renders
 * nothing while the copy loads or once it is gone.
 */
export function TaskRepeatNextLink({
  nextTaskId,
  projectKey,
  onOpenTask,
}: {
  nextTaskId: string;
  projectKey: string | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useT('tasks');
  const { task: next, isLoading, notFound } = useTask(nextTaskId);
  if (notFound || (next === null && isLoading)) return null;
  const identifier = next
    ? formatTaskIdentifier(projectKey, next.number)
    : null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground flex h-7 w-fit gap-1.5 px-1.5 font-normal"
      onClick={() => onOpenTask?.(nextTaskId)}
      disabled={!onOpenTask}
      title={next?.title}
    >
      <CornerDownRight className="size-3.5" aria-hidden="true" />
      {identifier
        ? t('repeat.nextTask', { task: identifier })
        : t('repeat.openNextTask')}
    </Button>
  );
}

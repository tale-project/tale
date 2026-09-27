import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Button } from '@tale/ui/button';
import { CornerLeftUp } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useTask } from '../hooks/queries';

/**
 * The way back from a subtask to its parent: "Part of KEY-12" in the detail
 * header, opening the parent in the same dialog. Names the parent by its
 * identifier, else its title; renders nothing until the parent has loaded.
 */
export function TaskParentLink({
  parentTaskId,
  projectKey,
  onOpenTask,
}: {
  parentTaskId: string;
  projectKey: string | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const { t } = useT('tasks');
  const { task: parent } = useTask(parentTaskId);
  if (!parent) return null;
  const identifier = formatTaskIdentifier(projectKey, parent.number);
  const label = t('detail.partOf', { task: identifier ?? parent.title });
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground -mx-2 h-7 self-start px-2 font-normal"
      onClick={() => onOpenTask?.(parent._id)}
      disabled={!onOpenTask}
      title={parent.title}
    >
      <CornerLeftUp className="size-3.5" aria-hidden="true" />
      {label}
    </Button>
  );
}

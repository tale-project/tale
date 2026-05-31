import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { TaskStatus } from '../lib/display';
import { TaskCard, type TaskRow } from './task-card';

export function BoardColumn({
  status,
  tasks,
  onOpenTask,
  projectKey,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const { t } = useT('tasks');
  // Column is itself a drop target so cards can be dropped into an empty lane.
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { status },
  });

  return (
    <div className="bg-muted/40 flex w-72 shrink-0 flex-col rounded-xl">
      <div className="flex items-center justify-between px-3 py-2">
        <Text as="span" variant="label" className="text-muted-foreground">
          {t(`status.${status}`)}
        </Text>
        <Text as="span" variant="muted" className="text-xs">
          {tasks.length}
        </Text>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2',
          isOver && 'rounded-lg bg-accent/30 ring-1 ring-inset ring-border',
        )}
      >
        <SortableContext
          items={tasks.map((task) => task._id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task._id}
              task={task}
              onOpen={onOpenTask}
              projectKey={projectKey}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

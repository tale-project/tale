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
import { TaskStatusBadge } from './task-status-badge';

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
    <section className="bg-muted/40 flex w-[80vw] max-w-72 shrink-0 snap-start flex-col rounded-lg sm:w-72">
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <TaskStatusBadge status={status} />
        <Text as="span" variant="caption" className="pr-1 tabular-nums">
          {tasks.length}
        </Text>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2',
          isOver && 'bg-accent/40 ring-border rounded-lg ring-1 ring-inset',
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
        {tasks.length === 0 && (
          <div className="border-border text-muted-foreground m-1 flex flex-1 items-center justify-center rounded-lg border border-dashed px-3 py-6 text-center text-xs">
            {t('board.noTasks')}
          </div>
        )}
      </div>
    </section>
  );
}

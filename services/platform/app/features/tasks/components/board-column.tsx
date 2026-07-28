import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { TaskStatus } from '../lib/display';
import { TaskCard, type TaskRow } from './task-card';
import { TaskStatusBadge } from './task-status-badge';

export function BoardColumn({
  status,
  tasks,
  childrenByParent,
  onOpenTask,
  projectKey,
  canEdit = false,
  dropHint = null,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  childrenByParent?: Map<string, TaskRow[]>;
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  /** Caller may write to the project — gates drag-reorder and inline pickers. */
  canEdit?: boolean;
  /** The verb dropping the currently-dragged card here would carry ("Starts
   * the … run.") — announced in the header while the drag is active. */
  dropHint?: string | null;
}) {
  const { t } = useT('tasks');
  // Column is itself a drop target so cards can be dropped into an empty lane.
  // The droppable id is the bare status string so the board's container-lookup
  // can treat `over.id` uniformly (a status = a column, anything else = a card).
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: 'column', status },
  });

  return (
    <Stack
      as="section"
      gap={0}
      className="bg-muted/40 w-[80vw] max-w-72 shrink-0 snap-start rounded-lg sm:w-72"
    >
      <Row gap={2} justify="between" className="px-2.5 py-2">
        <TaskStatusBadge status={status} />
        <Text as="span" variant="caption" className="pr-1 tabular-nums">
          {tasks.length}
        </Text>
      </Row>
      {dropHint !== null && (
        <Text
          as="p"
          role="status"
          className={cn(
            'px-2.5 pb-1.5 text-[11px] text-pretty',
            isOver ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {dropHint}
        </Text>
      )}
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
              subtasks={childrenByParent?.get(task._id)}
              onOpen={onOpenTask}
              projectKey={projectKey}
              canEdit={canEdit}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <Row
            gap={0}
            justify="center"
            className="border-border text-muted-foreground m-1 flex-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs"
          >
            {t('board.noTasks')}
          </Row>
        )}
      </div>
    </Stack>
  );
}

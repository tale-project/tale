import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { GitBranch } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import { useAssignTask, useUpdateTask } from '../hooks/mutations';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneePicker } from './assignee-picker';
import { PriorityPicker } from './priority-picker';
import { useTaskBoardContext } from './task-board-context';
import {
  BlockedIndicator,
  CommentCountIndicator,
  SubtaskProgress,
} from './task-indicators';

export type TaskRow = Doc<'tasks'>;

export function TaskCard({
  task,
  subtasks,
  onOpen,
  dragging,
  projectKey,
}: {
  task: TaskRow;
  /** This task's subtasks, when known — drives the progress ring. */
  subtasks?: TaskRow[];
  onOpen?: (task: TaskRow) => void;
  /** True when rendered inside the DragOverlay (floating clone). */
  dragging?: boolean;
  projectKey?: string | null;
}) {
  const { t } = useT('tasks');
  const identifier = formatTaskIdentifier(projectKey, task.number);
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const { isBlocked, getTask } = useTaskBoardContext();
  const blocked = isBlocked(task._id);
  const { done, total } = subtaskProgress(subtasks);

  // The subtask glyph names its parent ("Part of TAL-2") — fall back to the
  // parent's title, then a generic label, when the id/parent isn't resolvable.
  const parent = task.parentTaskId ? getTask(task.parentTaskId) : undefined;
  const parentIdentifier = parent
    ? formatTaskIdentifier(projectKey, parent.number)
    : null;
  const parentLabel = parentIdentifier
    ? t('detail.partOf', { task: parentIdentifier })
    : parent
      ? t('detail.partOf', { task: parent.title })
      : t('detail.subtask');
  const sortable = useSortable({ id: task._id, data: { status: task.status } });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- draggable kanban card; dnd-kit's {...sortable.attributes} injects role/tabIndex at runtime and keyboard activation is handled via onKeyDown
    <div
      ref={sortable.setNodeRef}
      style={style}
      {...sortable.attributes}
      {...sortable.listeners}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(task);
        }
      }}
      className={cn(
        'group border-border bg-card cursor-pointer rounded-lg border p-3 text-left shadow-sm transition-[colors,box-shadow]',
        'hover:border-border-strong hover:shadow-md focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        // While dragging, the in-place card becomes a faint placeholder marking
        // the slot the floating overlay will land in.
        sortable.isDragging && 'opacity-40',
        // The floating overlay clone lifts off the board: stronger shadow + ring.
        dragging && 'ring-border rotate-1 shadow-lg ring-1',
      )}
    >
      {identifier && (
        <Text
          as="span"
          variant="caption"
          className="font-mono text-[10px] tracking-wide"
        >
          {identifier}
        </Text>
      )}
      <Text as="p" variant="label" className="line-clamp-2 leading-snug">
        {task.title}
      </Text>

      {task.labels && task.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 4).map((label) => (
            <Badge key={label} variant="outline" className="text-[10px]">
              {label}
            </Badge>
          ))}
          {task.labels.length > 4 && (
            <Badge variant="outline" className="text-[10px]">
              +{task.labels.length - 4}
            </Badge>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <PriorityPicker
            priority={task.priority ?? null}
            onChange={(priority) =>
              updateTask.mutate({ taskId: task._id, priority })
            }
          />
          {task.parentTaskId && (
            <Tooltip content={parentLabel}>
              <span className="inline-flex" aria-label={parentLabel}>
                <GitBranch
                  className="text-muted-foreground size-3.5"
                  aria-hidden="true"
                />
              </span>
            </Tooltip>
          )}
          <BlockedIndicator blocked={blocked} />
          {total > 0 && <SubtaskProgress done={done} total={total} />}
          <CommentCountIndicator count={task.commentCount} />
        </div>
        <AssigneePicker
          organizationId={task.organizationId}
          projectId={task.projectId}
          assigneeType={task.assigneeType}
          assigneeId={task.assigneeId}
          onAssign={(assigneeType, assigneeId) =>
            assignTask.mutate({ taskId: task._id, assigneeType, assigneeId })
          }
          onUnassign={() => assignTask.mutate({ taskId: task._id })}
        />
      </div>
    </div>
  );
}

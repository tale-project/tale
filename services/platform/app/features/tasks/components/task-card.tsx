import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { GitBranch } from 'lucide-react';

import type { Doc } from '@/convex/_generated/dataModel';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import { AssigneeAvatar } from './assignee-avatar';
import { TaskPriorityBadge } from './task-priority-badge';

export type TaskRow = Doc<'tasks'>;

export function TaskCard({
  task,
  onOpen,
  dragging,
  projectKey,
}: {
  task: TaskRow;
  onOpen?: (task: TaskRow) => void;
  dragging?: boolean;
  projectKey?: string | null;
}) {
  const identifier = formatTaskIdentifier(projectKey, task.number);
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
        'group border-border bg-card cursor-pointer rounded-lg border p-3 text-left shadow-sm transition-colors',
        'hover:border-border-strong focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        (sortable.isDragging || dragging) && 'opacity-50',
        dragging && 'shadow-md',
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
          {task.priority && <TaskPriorityBadge priority={task.priority} />}
          {task.parentTaskId && (
            <GitBranch
              className="text-muted-foreground size-3.5"
              aria-hidden="true"
            />
          )}
        </div>
        <AssigneeAvatar
          assigneeType={task.assigneeType}
          assigneeId={task.assigneeId}
        />
      </div>
    </div>
  );
}

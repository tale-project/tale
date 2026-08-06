import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@tale/ui/card';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { GitBranch } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import { useAssignTask, useUpdateTask } from '../hooks/mutations';
import { useActorDirectory } from '../hooks/use-actor-directory';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneePicker } from './assignee-picker';
import { PriorityPicker } from './priority-picker';
import { TaskAutomationBadge } from './task-automation-badge';
import { useTaskBoardContext } from './task-board-context';
import {
  AgentWorkingIndicator,
  BlockedIndicator,
  CommentCountIndicator,
  DueDateIndicator,
  NeedsReviewIndicator,
  SubtaskProgress,
} from './task-indicators';
import { TaskLabelBadge, TaskLabelOverflow } from './task-label-badge';

export type TaskRow = Doc<'tasks'> & {
  /** Folder-input subject facts stamped by the board list query (see
   * `collectFolderFacts`) — absent on surfaces that don't stamp them. */
  folderExists?: boolean;
  hasFiles?: boolean;
};

export function TaskCard({
  task,
  subtasks,
  onOpen,
  dragging,
  projectKey,
  canEdit = false,
}: {
  task: TaskRow;
  /** This task's subtasks, when known — drives the progress ring. */
  subtasks?: TaskRow[];
  onOpen?: (task: TaskRow) => void;
  /** True when rendered inside the DragOverlay (floating clone). */
  dragging?: boolean;
  projectKey?: string | null;
  /** Caller may write to the project — gates drag and the inline pickers. */
  canEdit?: boolean;
}) {
  const { t } = useT('tasks');
  const identifier = formatTaskIdentifier(projectKey, task.number);
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const editable = canEdit && task.archivedAt == null;
  const {
    isBlocked,
    getTask,
    isAgentWorking,
    needsReview,
    reviewRequestedFor,
  } = useTaskBoardContext();
  const blocked = isBlocked(task._id);
  const { done, total } = subtaskProgress(subtasks);
  // Name the reviewer the review-gate chip waits on ("You" for the viewer).
  const { resolveActor, currentUserId } = useActorDirectory(
    task.organizationId,
  );
  const reviewerUserId = reviewRequestedFor(task._id);
  const reviewerIsMe =
    reviewerUserId !== undefined && reviewerUserId === currentUserId;
  const reviewerName =
    reviewerUserId !== undefined && !reviewerIsMe
      ? resolveActor('user', reviewerUserId).name
      : undefined;

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
  // Read-only viewers can't reorder: disabling the sortable drops the drag
  // listeners (the server rejects the move anyway).
  const sortable = useSortable({
    id: task._id,
    data: { status: task.status },
    disabled: !editable,
  });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <Card
      asChild
      padding="sm"
      shadow="sm"
      interactive
      className={cn(
        'group cursor-pointer text-left hover:shadow-md',
        task.archivedAt != null && 'opacity-70',
        // While dragging, the in-place card becomes a faint placeholder marking
        // the slot the floating overlay will land in.
        sortable.isDragging && 'opacity-40',
        // The floating overlay clone lifts off the board: stronger shadow + ring.
        dragging && 'ring-border rotate-1 shadow-lg ring-1',
      )}
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- draggable kanban card; dnd-kit's {...sortable.attributes} injects role/tabIndex at runtime and keyboard activation is handled via onKeyDown */}
      <div
        ref={sortable.setNodeRef}
        style={style}
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={() => onOpen?.(task)}
        onKeyDown={(e) => {
          // Enter always opens the task. Space starts a keyboard drag via
          // dnd-kit's KeyboardSensor activator (kept in `sortable.listeners`),
          // so we must forward to it rather than shadow it — but only when the
          // card is draggable. For read-only cards Space opens instead.
          if (e.key === 'Enter' || (e.key === ' ' && !editable)) {
            e.preventDefault();
            onOpen?.(task);
            return;
          }
          sortable.listeners?.onKeyDown?.(e);
        }}
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
          <Row gap={1} align="stretch" wrap className="mt-2">
            {task.labels.slice(0, 4).map((label) => (
              <TaskLabelBadge
                key={label}
                label={label}
                projectId={task.projectId}
                className="px-1.5 py-px text-[10px]"
              />
            ))}
            <TaskLabelOverflow labels={task.labels.slice(4)} />
          </Row>
        )}

        <Row gap={2} justify="between" className="mt-3">
          <div className="flex items-center gap-1.5">
            <PriorityPicker
              priority={task.priority ?? null}
              disabled={!editable}
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
            <TaskAutomationBadge
              organizationId={task.organizationId}
              task={task}
              runActive={isAgentWorking(task._id)}
            />
            <AgentWorkingIndicator working={isAgentWorking(task._id)} />
            <NeedsReviewIndicator
              needsReview={needsReview(task._id)}
              reviewerName={reviewerName}
              reviewerIsMe={reviewerIsMe}
            />
            <DueDateIndicator dueDate={task.dueDate} status={task.status} />
            {total > 0 && <SubtaskProgress done={done} total={total} />}
            <CommentCountIndicator count={task.commentCount} />
          </div>
          <AssigneePicker
            organizationId={task.organizationId}
            projectId={task.projectId}
            taskId={task._id}
            assigneeType={task.assigneeType}
            assigneeId={task.assigneeId}
            disabled={!editable}
            onAssign={(assigneeType, assigneeId) =>
              assignTask.mutate({ taskId: task._id, assigneeType, assigneeId })
            }
            onUnassign={() => assignTask.mutate({ taskId: task._id })}
          />
        </Row>
      </div>
    </Card>
  );
}

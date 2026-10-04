import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import { GitBranch } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useAssignTask, useUpdateTask } from '../hooks/mutations';
import { useActorDirectory } from '../hooks/use-actor-directory';
import type { TaskDoc } from '../lib/display';
import { subtaskProgress } from '../lib/subtasks';
import { AssigneePicker } from './assignee-picker';
import { PriorityPicker } from './priority-picker';
import { TaskArchivedBadge } from './task-archived-badge';
import { TaskAutomationBadge } from './task-automation-badge';
import {
  type TaskActorNames,
  useBoardActorDirectory,
  useTaskBoardContext,
} from './task-board-context';
import {
  AgentNeedsAnswerIndicator,
  AgentWorkingIndicator,
  BlockedIndicator,
  CommentCountIndicator,
  DueDateIndicator,
  NeedsReviewIndicator,
  RepeatIndicator,
  SubtaskProgress,
} from './task-indicators';
import { TaskLabelBadge, TaskLabelOverflow } from './task-label-badge';
import { TaskTitleButton } from './task-title-button';

/** The board's default decision: no task is workable. */
export const readOnlyBoard = (): boolean => false;

export type TaskRow = TaskDoc & {
  /** Folder-input subject facts stamped by the board list query (see
   * `collectFolderFacts`) — absent on surfaces that don't stamp them. */
  folderExists?: boolean;
  hasFiles?: boolean;
  /** Stamped by the all-projects board so cards show `KEY-123` per task. */
  projectKey?: string;
};

interface TaskCardProps {
  task: TaskRow;
  /** This task's subtasks, when known — drives the progress ring. */
  subtasks?: TaskRow[];
  onOpen?: (task: TaskRow) => void;
  /** True when rendered inside the DragOverlay (floating clone). */
  dragging?: boolean;
  projectKey?: string | null;
  /** Whether the viewer may work the task (`useTaskAccess`) — gates drag
   * and the inline pickers. Absent, the card is read-only. */
  canWorkTask?: (task: TaskRow) => boolean;
}

/** A board card. It names its assignee and reviewer from the board's actor
 * directory when that covers the task's project, else from one of its own
 * (the all-projects board), which it hands its assignee picker too. */
export function TaskCard(props: TaskCardProps) {
  const boardActors = useBoardActorDirectory(props.task.projectId);
  return boardActors !== undefined ? (
    <TaskCardView {...props} actors={boardActors} />
  ) : (
    <TaskCardWithOwnActors {...props} />
  );
}

function TaskCardWithOwnActors(props: TaskCardProps) {
  const { resolveActor, currentUserId } = useActorDirectory(
    props.task.organizationId,
    props.task.projectId,
  );
  return <TaskCardView {...props} actors={{ resolveActor, currentUserId }} />;
}

function TaskCardView({
  task,
  subtasks,
  onOpen,
  dragging,
  projectKey,
  canWorkTask = readOnlyBoard,
  actors,
}: TaskCardProps & { actors: TaskActorNames }) {
  const { t } = useT('tasks');
  const resolvedProjectKey = task.projectKey ?? projectKey;
  const identifier = formatTaskIdentifier(resolvedProjectKey, task.number);
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const {
    isBlocked,
    getTask,
    isAgentWorking,
    isAgentAsking,
    needsReview,
    reviewRecipient,
  } = useTaskBoardContext();
  // Drag and the inline pickers are for whoever may work this task.
  const editable = canWorkTask(task) && task.archivedAt == null;
  const blocked = isBlocked(task._id);
  const { done, total } = subtaskProgress(subtasks);
  // Name the reviewer the review-gate chip waits on ("You" for the viewer).
  const { resolveActor, currentUserId } = actors;
  const reviewer = reviewRecipient(task._id);
  const reviewerIsMe =
    reviewer?.kind === 'user' && reviewer.userId === currentUserId;
  const reviewerName =
    reviewer !== undefined && !reviewerIsMe
      ? resolveActor(
          reviewer.kind,
          reviewer.kind === 'user' ? reviewer.userId : reviewer.agentId,
        ).name
      : undefined;

  // The subtask glyph names its parent ("Part of TAL-2") — fall back to the
  // parent's title, then a generic label, when the id/parent isn't resolvable.
  const parent = task.parentTaskId ? getTask(task.parentTaskId) : undefined;
  const parentIdentifier = parent
    ? formatTaskIdentifier(
        parent.projectKey ?? resolvedProjectKey,
        parent.number,
      )
    : null;
  const parentLabel = parentIdentifier
    ? t('detail.partOf', { task: parentIdentifier })
    : parent
      ? t('detail.partOf', { task: parent.title })
      : t('detail.subtask');
  // A viewer who may not work the task can't move it: disabling the
  // sortable drops the drag listeners (the server rejects the move anyway).
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
        // `relative`: the title button's stretched ::after covers the card,
        // so a click anywhere on it opens the task without the card itself
        // being a button (a button may not contain the pickers' buttons).
        'group relative cursor-pointer text-left hover:shadow-md',
        task.archivedAt != null && 'opacity-70',
        // While dragging, the in-place card becomes a faint placeholder marking
        // the slot the floating overlay will land in.
        sortable.isDragging && 'opacity-40',
        // The floating overlay clone lifts off the board: stronger shadow + ring.
        dragging && 'ring-border rotate-1 shadow-lg ring-1',
      )}
    >
      <div ref={sortable.setNodeRef} style={style}>
        {identifier || task.archivedAt != null ? (
          <Row gap={1} align="center">
            {identifier && (
              <Text
                as="span"
                variant="caption"
                className="font-mono text-[10px] tracking-wide"
              >
                {identifier}
              </Text>
            )}
            {task.archivedAt != null && (
              <TaskArchivedBadge className="px-1.5 py-px text-[10px]" />
            )}
          </Row>
        ) : null}
        {/* The ONE interactive element of the card: its sortable activator
            (dnd-kit's role/tabIndex/keyboard listeners land here) and its
            open target. The stretched ::after makes the whole card its hit
            area; the pickers below sit above it (`relative z-10`). A
            read-only card is a plain button: dnd-kit's attributes would
            announce it disabled ("sortable", aria-disabled) although it
            still opens the task. */}
        <TaskTitleButton
          title={task.title}
          sortable={sortable}
          draggable={editable}
          onOpen={() => onOpen?.(task)}
          className="text-foreground line-clamp-2 w-full text-left text-sm leading-snug font-medium"
        />

        {task.labels && task.labels.length > 0 && (
          <Row gap={1} align="stretch" wrap className="mt-2">
            {task.labels.slice(0, 4).map((label) => (
              <TaskLabelBadge
                key={label.id ?? label.name}
                label={label.name}
                color={label.color}
                className="px-1.5 py-px text-[10px]"
              />
            ))}
            <TaskLabelOverflow labels={task.labels.slice(4)} />
          </Row>
        )}

        {/* Above the title's stretched hit layer: the pickers keep their own
            clicks, and the indicators' tooltips still get their hover. */}
        <Row gap={2} justify="between" className="relative z-10 mt-3">
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
            {/* A run parked on a question is the viewer's move — the ask chip
                replaces the working pulse rather than pulsing next to it. */}
            <AgentWorkingIndicator
              working={isAgentWorking(task._id) && !isAgentAsking(task._id)}
            />
            <AgentNeedsAnswerIndicator asking={isAgentAsking(task._id)} />
            <NeedsReviewIndicator
              needsReview={needsReview(task._id)}
              reviewerName={reviewerName}
              reviewerIsMe={reviewerIsMe}
            />
            <RepeatIndicator
              repeat={task.repeat}
              status={task.status}
              continued={task.repeatContinued}
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
            actors={actors}
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

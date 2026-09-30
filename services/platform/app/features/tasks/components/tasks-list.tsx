import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { cn } from '@tale/ui/cn';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ChevronRight } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useT } from '@/lib/i18n/client';

import { useAssignTask, useUpdateTask } from '../hooks/mutations';
import { useTaskBoardDnd } from '../hooks/use-task-board-dnd';
import { BOARD_TASK_STATUSES, type TaskStatus } from '../lib/display';
import { partitionSubtasks, subtaskProgress } from '../lib/subtasks';
import { AssigneePicker } from './assignee-picker';
import { PriorityPicker } from './priority-picker';
import { useRunCancelConfirm } from './run-cancel-confirm';
import { TaskArchivedBadge } from './task-archived-badge';
import { useTaskBoardContext } from './task-board-context';
import { readOnlyBoard, type TaskRow } from './task-card';
import {
  BlockedIndicator,
  CommentCountIndicator,
  DueDateIndicator,
  RepeatIndicator,
  SubtaskProgress,
} from './task-indicators';
import { TaskLabelBadge, TaskLabelOverflow } from './task-label-badge';
import { TaskStatusBadge } from './task-status-badge';
import { TaskTitleButton } from './task-title-button';

/**
 * Linear-style single-column list grouped by status. Each status is a
 * COLLAPSIBLE section (a slim header — chevron · status · count — over
 * hairline-separated rows) so the whole thread reads lightly and the user can
 * fold away statuses they don't care about. Subtasks nest under (and expand
 * from) their parent rather than getting their own section row. Drag mechanics
 * are shared with the board via {@link useTaskBoardDnd}; a top-level row can be
 * dragged into any expanded lane.
 *
 * Memoized, like the board: a task dialog opening or closing never re-renders
 * the rows (#3939).
 */
export const TasksList = memo(function TasksList({
  tasks,
  onOpenTask,
  projectKey,
  canWorkTask = readOnlyBoard,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  /** Whether the viewer may work a task (`useTaskAccess`) — gates its
   * drag-reorder and inline pickers. Absent, every row is read-only. */
  canWorkTask?: (task: TaskRow) => boolean;
}) {
  const { topLevel, childrenByParent } = useMemo(
    () => partitionSubtasks(tasks),
    [tasks],
  );
  const { confirmCancel, dialog: cancelConfirmDialog } = useRunCancelConfirm();
  const dnd = useTaskBoardDnd(topLevel, { confirmCancel, projectKey });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // Collapsed status sections, persisted per project so a fold survives reloads.
  const [collapsedStatuses, setCollapsedStatuses] = usePersistedState<
    TaskStatus[]
  >(`tale.platform.tasks.${projectKey ?? 'all'}.collapsedStatuses`, []);
  const collapsed = useMemo(
    () => new Set(collapsedStatuses),
    [collapsedStatuses],
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleCollapsed = useCallback(
    (status: TaskStatus) => {
      setCollapsedStatuses((prev) =>
        prev.includes(status)
          ? prev.filter((s) => s !== status)
          : [...prev, status],
      );
    },
    [setCollapsedStatuses],
  );

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
      autoScroll={dnd.autoScroll}
      accessibility={dnd.accessibility}
    >
      <div className="h-full min-h-0 overflow-auto overscroll-contain">
        {BOARD_TASK_STATUSES.map((status) => {
          const rows = dnd.columns[status]
            .map((id) => dnd.byId.get(id))
            .filter((t): t is TaskRow => t != null);
          return (
            <ListSwimlane
              key={status}
              status={status}
              rows={rows}
              childrenByParent={childrenByParent}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              isCollapsed={collapsed.has(status)}
              onToggleCollapsed={toggleCollapsed}
              onOpenTask={onOpenTask}
              projectKey={projectKey}
              canWorkTask={canWorkTask}
            />
          );
        })}
      </div>
      <DragOverlay>
        {dnd.activeTask ? (
          <TaskListRow
            task={dnd.activeTask}
            subtasks={childrenByParent.get(dnd.activeTask._id)}
            projectKey={projectKey}
            dragging
            canWorkTask={canWorkTask}
          />
        ) : null}
      </DragOverlay>
      {cancelConfirmDialog}
    </DndContext>
  );
});

function ListSwimlane({
  status,
  rows,
  childrenByParent,
  expanded,
  onToggleExpanded,
  isCollapsed,
  onToggleCollapsed,
  onOpenTask,
  projectKey,
  canWorkTask,
}: {
  status: TaskStatus;
  rows: TaskRow[];
  childrenByParent: Map<string, TaskRow[]>;
  expanded: ReadonlySet<string>;
  onToggleExpanded: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapsed: (status: TaskStatus) => void;
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  canWorkTask: (task: TaskRow) => boolean;
}) {
  const { t } = useT('tasks');
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: 'column', status },
  });

  return (
    <section>
      {/* Slim, Linear-style section header: a single full-width toggle
          (chevron + status + count). */}
      <Row gap={2} className="bg-background sticky top-0 z-10 px-3 py-1.5">
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => onToggleCollapsed(status)}
          className="text-muted-foreground hover:text-foreground -ml-1 flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              !isCollapsed && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <TaskStatusBadge status={status} />
          <Text as="span" variant="caption" className="tabular-nums">
            {rows.length}
          </Text>
        </button>
      </Row>
      {!isCollapsed && (
        <div ref={setNodeRef} className={cn(isOver && 'bg-accent/30')}>
          <SortableContext
            items={rows.map((r) => r._id)}
            strategy={verticalListSortingStrategy}
          >
            {rows.map((task) => {
              const children = childrenByParent.get(task._id);
              const isExpanded = expanded.has(task._id);
              return (
                <div key={task._id}>
                  <TaskListRow
                    task={task}
                    subtasks={children}
                    isExpanded={isExpanded}
                    onToggleExpanded={onToggleExpanded}
                    onOpen={onOpenTask}
                    projectKey={projectKey}
                    canWorkTask={canWorkTask}
                  />
                  {isExpanded &&
                    children?.map((child) => (
                      <TaskListRow
                        key={child._id}
                        task={child}
                        nested
                        onOpen={onOpenTask}
                        projectKey={projectKey}
                        canWorkTask={canWorkTask}
                      />
                    ))}
                </div>
              );
            })}
          </SortableContext>
          {rows.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 pl-9 text-xs">
              {t('board.noTasks')}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TaskListRow({
  task,
  subtasks,
  isExpanded,
  onToggleExpanded,
  onOpen,
  dragging,
  nested,
  projectKey,
  canWorkTask = readOnlyBoard,
}: {
  task: TaskRow;
  subtasks?: TaskRow[];
  isExpanded?: boolean;
  onToggleExpanded?: (id: string) => void;
  onOpen?: (task: TaskRow) => void;
  dragging?: boolean;
  /** Rendered as a nested subtask row (indented, non-draggable). */
  nested?: boolean;
  projectKey?: string | null;
  /** Whether the viewer may work the task — gates drag and the pickers. */
  canWorkTask?: (task: TaskRow) => boolean;
}) {
  const { t } = useT('tasks');
  const identifier = formatTaskIdentifier(
    task.projectKey ?? projectKey,
    task.number,
  );
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const blocked = useTaskBoardContext().isBlocked(task._id);
  const hasSubtasks = (subtasks?.length ?? 0) > 0;
  const { done, total } = subtaskProgress(subtasks);
  // Drag and the inline pickers are for whoever may work this task.
  const editable = canWorkTask(task) && task.archivedAt == null;
  const draggable = !nested && editable;

  // Subtask rows are not draggable; only top-level rows participate in the DnD
  // sortable context. `useSortable` is still called unconditionally to respect
  // the rules of hooks, but its wiring is ignored for nested rows.
  // Nested rows never drag; top-level rows drag only when the viewer may
  // work the task (disabling the sortable drops its drag listeners — the
  // server rejects the move anyway).
  const sortable = useSortable({
    id: task._id,
    data: { status: task.status },
    disabled: !draggable,
  });
  const style = nested
    ? undefined
    : {
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- pointer convenience for sibling metadata; the native title button owns keyboard opening
    <div
      ref={nested ? undefined : sortable.setNodeRef}
      style={style}
      onClick={() => onOpen?.(task)}
      className={cn(
        // Keep raised inline controls below the sticky section header.
        'group relative isolate flex w-full cursor-pointer items-center gap-2.5 py-1.5 pr-3 text-left transition-colors',
        // Hairline between rows, like a regular table; the floating drag clone
        // keeps its card chrome instead.
        !dragging && 'border-border/60 border-b',
        task.archivedAt != null && 'opacity-70',
        // Indent so row content lines up just past the section header's chevron.
        nested ? 'pl-12' : 'pl-9',
        nested ? 'hover:bg-muted/30' : 'hover:bg-muted/40',
        !nested && sortable.isDragging && 'opacity-40',
        dragging &&
          'bg-card ring-border rounded-lg shadow-lg ring-1 backdrop-blur',
      )}
    >
      {hasSubtasks && onToggleExpanded ? (
        <button
          type="button"
          aria-label={t('detail.subtasks')}
          aria-expanded={isExpanded}
          className="text-muted-foreground hover:text-foreground relative z-10 -ml-5 shrink-0 rounded p-0.5"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded(task._id);
          }}
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              isExpanded && 'rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
      ) : null}
      {/* Priority leads the row (Linear-style); the picker is icon-only here. */}
      <span className="relative z-10 inline-flex shrink-0">
        <PriorityPicker
          priority={task.priority ?? null}
          align="start"
          disabled={!editable}
          onChange={(priority) =>
            updateTask.mutate({ taskId: task._id, priority })
          }
        />
      </span>
      {identifier && (
        <Text
          as="span"
          variant="caption"
          className="hidden w-14 shrink-0 font-mono text-[11px] tracking-wide sm:block"
        >
          {identifier}
        </Text>
      )}
      {/* The title owns opening and dragging, with the same stretched hit
          area as Board. Pickers and expanders remain sibling controls. */}
      <TaskTitleButton
        title={task.title}
        sortable={sortable}
        draggable={draggable}
        onOpen={() => onOpen?.(task)}
        className={cn(
          'text-foreground line-clamp-1 min-w-0 flex-1 text-left text-sm focus-visible:after:ring-inset',
          nested && 'text-muted-foreground',
        )}
      />
      {task.archivedAt != null && (
        <TaskArchivedBadge className="shrink-0 px-1.5 py-px text-[10px]" />
      )}
      {task.labels && task.labels.length > 0 && (
        <span className="relative z-10 hidden shrink-0 items-center gap-1 md:flex">
          {task.labels.slice(0, 3).map((label) => (
            <TaskLabelBadge
              key={label.id ?? label.name}
              label={label.name}
              color={label.color}
              className="px-1.5 py-px text-[10px]"
            />
          ))}
          <TaskLabelOverflow labels={task.labels.slice(3)} />
        </span>
      )}
      {hasSubtasks && (
        <SubtaskProgress
          done={done}
          total={total}
          className="relative z-10 shrink-0"
        />
      )}
      <BlockedIndicator blocked={blocked} className="relative z-10 shrink-0" />
      <CommentCountIndicator
        count={task.commentCount}
        className="relative z-10 shrink-0"
      />
      <RepeatIndicator
        repeat={task.repeat}
        status={task.status}
        continued={task.repeatContinued}
        className="relative z-10 shrink-0"
      />
      <DueDateIndicator
        dueDate={task.dueDate}
        status={task.status}
        className="relative z-10 shrink-0"
      />
      <span className="relative z-10 inline-flex shrink-0">
        <AssigneePicker
          organizationId={task.organizationId}
          projectId={task.projectId}
          taskId={task._id}
          assigneeType={task.assigneeType}
          assigneeId={task.assigneeId}
          align="end"
          disabled={!editable}
          onAssign={(assigneeType, assigneeId) =>
            assignTask.mutate({ taskId: task._id, assigneeType, assigneeId })
          }
          onUnassign={() => assignTask.mutate({ taskId: task._id })}
        />
      </span>
    </div>
  );
}

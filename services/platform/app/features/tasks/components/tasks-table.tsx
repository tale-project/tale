import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Text } from '@tale/ui/text';
import { ChevronRight } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { formatTaskIdentifier } from '@/lib/shared/project_key';
import { cn } from '@/lib/utils/cn';

import { useAssignTask, useUpdateTask } from '../hooks/mutations';
import { useTaskBoardDnd } from '../hooks/use-task-board-dnd';
import { TASK_STATUS_ORDER, type TaskStatus } from '../lib/display';
import { partitionSubtasks, subtaskProgress } from '../lib/subtasks';
import { AssigneePicker } from './assignee-picker';
import { PriorityPicker } from './priority-picker';
import { useTaskBoardContext } from './task-board-context';
import type { TaskRow } from './task-card';
import {
  BlockedIndicator,
  CommentCountIndicator,
  SubtaskProgress,
} from './task-indicators';
import { TaskStatusBadge } from './task-status-badge';

// Shared grid template so columns line up across every swimlane. The id column
// is dropped on mobile for responsiveness (its cell is `hidden sm:block`).
const ROW_GRID =
  'grid grid-cols-[1fr_auto_auto] sm:grid-cols-[5rem_1fr_auto_auto] items-center gap-3';

/**
 * Table view: a columnar layout grouped into status swimlanes. Subtasks are not
 * shown as their own rows — they are nested under (and expandable from) their
 * parent, which carries a subtask-progress ring. Top-level rows reorder and move
 * across lanes via the shared {@link useTaskBoardDnd}; assignee/priority edit
 * inline.
 */
export function TasksTable({
  tasks,
  onOpenTask,
  projectKey,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const { t } = useT('tasks');
  const { topLevel, childrenByParent } = useMemo(
    () => partitionSubtasks(tasks),
    [tasks],
  );
  const dnd = useTaskBoardDnd(topLevel);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      onDragStart={dnd.onDragStart}
      onDragOver={dnd.onDragOver}
      onDragEnd={dnd.onDragEnd}
      onDragCancel={dnd.onDragCancel}
      autoScroll={dnd.autoScroll}
    >
      <div className="border-border h-full min-h-0 overflow-auto overscroll-contain rounded-lg border">
        <div
          className={cn(
            ROW_GRID,
            'bg-muted text-muted-foreground sticky top-0 z-20 min-h-10 border-b px-3 text-sm font-medium',
          )}
        >
          <span className="hidden sm:block">{t('fields.id')}</span>
          <span>{t('fields.title')}</span>
          <span className="text-right">{t('fields.priority')}</span>
          <span className="text-right">{t('fields.assignee')}</span>
        </div>
        {TASK_STATUS_ORDER.map((status) => {
          const rows = dnd.columns[status]
            .map((id) => dnd.byId.get(id))
            .filter((row): row is TaskRow => row != null);
          return (
            <TableSwimlane
              key={status}
              status={status}
              rows={rows}
              childrenByParent={childrenByParent}
              expanded={expanded}
              onToggleExpanded={toggleExpanded}
              onOpenTask={onOpenTask}
              projectKey={projectKey}
            />
          );
        })}
      </div>
      <DragOverlay>
        {dnd.activeTask ? (
          <TaskTableRow
            task={dnd.activeTask}
            subtasks={childrenByParent.get(dnd.activeTask._id)}
            projectKey={projectKey}
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TableSwimlane({
  status,
  rows,
  childrenByParent,
  expanded,
  onToggleExpanded,
  onOpenTask,
  projectKey,
}: {
  status: TaskStatus;
  rows: TaskRow[];
  childrenByParent: Map<string, TaskRow[]>;
  expanded: ReadonlySet<string>;
  onToggleExpanded: (id: string) => void;
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const { t } = useT('tasks');
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: 'column', status },
  });

  return (
    <div>
      <div className="bg-muted/60 sticky top-9 z-10 flex items-center gap-2 border-b px-3 py-1.5">
        <TaskStatusBadge status={status} />
        <Text as="span" variant="caption" className="tabular-nums">
          {rows.length}
        </Text>
      </div>
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
                <TaskTableRow
                  task={task}
                  subtasks={children}
                  isExpanded={isExpanded}
                  onToggleExpanded={onToggleExpanded}
                  onOpen={onOpenTask}
                  projectKey={projectKey}
                />
                {isExpanded &&
                  children?.map((child) => (
                    <TaskSubRow
                      key={child._id}
                      task={child}
                      onOpen={onOpenTask}
                      projectKey={projectKey}
                    />
                  ))}
              </div>
            );
          })}
        </SortableContext>
        {rows.length === 0 && (
          <div className="text-muted-foreground px-3 py-2.5 text-xs">
            {t('board.noTasks')}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskTableRow({
  task,
  subtasks,
  isExpanded,
  onToggleExpanded,
  onOpen,
  dragging,
  projectKey,
}: {
  task: TaskRow;
  subtasks?: TaskRow[];
  isExpanded?: boolean;
  onToggleExpanded?: (id: string) => void;
  onOpen?: (task: TaskRow) => void;
  dragging?: boolean;
  projectKey?: string | null;
}) {
  const { t } = useT('tasks');
  const identifier = formatTaskIdentifier(projectKey, task.number);
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const blocked = useTaskBoardContext().isBlocked(task._id);
  const sortable = useSortable({ id: task._id, data: { status: task.status } });
  const style = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
  };
  const hasSubtasks = (subtasks?.length ?? 0) > 0;
  const { done, total } = subtaskProgress(subtasks);

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- draggable table row; dnd-kit injects role/tabIndex via attributes and keyboard activation is handled via onKeyDown
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
        ROW_GRID,
        'group bg-background hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-ring/50 cursor-pointer border-b px-3 py-2.5 text-left transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
        sortable.isDragging && 'opacity-40',
        dragging &&
          'bg-card ring-border rounded-lg border border-transparent shadow-lg ring-1',
      )}
    >
      <Text
        as="span"
        variant="caption"
        className="hidden truncate font-mono text-[11px] tracking-wide sm:block"
      >
        {identifier ?? '—'}
      </Text>
      <div className="flex min-w-0 items-center gap-1.5">
        {hasSubtasks && onToggleExpanded ? (
          <button
            type="button"
            aria-label={t('detail.subtasks')}
            aria-expanded={isExpanded}
            className="text-muted-foreground hover:text-foreground -ml-1 rounded p-0.5"
            onClick={(e) => {
              e.stopPropagation();
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
        <Text as="span" variant="label" className="line-clamp-1">
          {task.title}
        </Text>
        {hasSubtasks && (
          <SubtaskProgress done={done} total={total} className="shrink-0" />
        )}
        <BlockedIndicator blocked={blocked} className="shrink-0" />
        <CommentCountIndicator count={task.commentCount} className="shrink-0" />
      </div>
      <div className="flex justify-end">
        <PriorityPicker
          priority={task.priority ?? null}
          align="end"
          onChange={(priority) =>
            updateTask.mutate({ taskId: task._id, priority })
          }
        />
      </div>
      <div className="flex justify-end">
        <AssigneePicker
          organizationId={task.organizationId}
          projectId={task.projectId}
          assigneeType={task.assigneeType}
          assigneeId={task.assigneeId}
          align="end"
          onAssign={(assigneeType, assigneeId) =>
            assignTask.mutate({ taskId: task._id, assigneeType, assigneeId })
          }
          onUnassign={() => assignTask.mutate({ taskId: task._id })}
        />
      </div>
    </div>
  );
}

/** A nested subtask row: indented, non-draggable, opens the task on click. */
function TaskSubRow({
  task,
  onOpen,
  projectKey,
}: {
  task: TaskRow;
  onOpen?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const identifier = formatTaskIdentifier(projectKey, task.number);
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const blocked = useTaskBoardContext().isBlocked(task._id);

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- clickable row wraps the priority/assignee buttons, so it can't be a real <button>; role+tabIndex+onKeyDown is the correct ARIA
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(task);
        }
      }}
      className={cn(
        ROW_GRID,
        'group bg-muted/20 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-ring/50 cursor-pointer border-b px-3 py-2 text-left transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
      )}
    >
      <Text
        as="span"
        variant="caption"
        className="hidden truncate font-mono text-[11px] tracking-wide sm:block"
      >
        {identifier ?? '—'}
      </Text>
      <div className="flex min-w-0 items-center gap-1.5 pl-5">
        <span
          className="border-muted-foreground/40 h-3 w-2 shrink-0 rounded-bl-[3px] border-b border-l"
          aria-hidden="true"
        />
        <Text
          as="span"
          variant="body"
          className="text-muted-foreground line-clamp-1"
        >
          {task.title}
        </Text>
        <BlockedIndicator blocked={blocked} className="shrink-0" />
        <CommentCountIndicator count={task.commentCount} className="shrink-0" />
      </div>
      <div className="flex justify-end">
        <PriorityPicker
          priority={task.priority ?? null}
          align="end"
          onChange={(priority) =>
            updateTask.mutate({ taskId: task._id, priority })
          }
        />
      </div>
      <div className="flex justify-end">
        <AssigneePicker
          organizationId={task.organizationId}
          projectId={task.projectId}
          assigneeType={task.assigneeType}
          assigneeId={task.assigneeId}
          align="end"
          onAssign={(assigneeType, assigneeId) =>
            assignTask.mutate({ taskId: task._id, assigneeType, assigneeId })
          }
          onUnassign={() => assignTask.mutate({ taskId: task._id })}
        />
      </div>
    </div>
  );
}

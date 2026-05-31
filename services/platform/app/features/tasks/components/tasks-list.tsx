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
import type { TaskRow } from './task-card';
import { CommentCountIndicator, SubtaskProgress } from './task-indicators';
import { TaskStatusBadge } from './task-status-badge';

/**
 * Compact single-column list grouped by status. Subtasks aren't shown as their
 * own rows — they nest under (and expand from) their parent, which carries a
 * subtask-progress ring. Every status renders as a section so a top-level row
 * can be dragged into any lane; drag mechanics are shared with the board via
 * {@link useTaskBoardDnd}.
 */
export function TasksList({
  tasks,
  onOpenTask,
  projectKey,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
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
        {TASK_STATUS_ORDER.map((status) => {
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
              onOpenTask={onOpenTask}
              projectKey={projectKey}
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
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ListSwimlane({
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
    <section>
      <div className="bg-muted sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
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
                <TaskListRow
                  task={task}
                  subtasks={children}
                  isExpanded={isExpanded}
                  onToggleExpanded={onToggleExpanded}
                  onOpen={onOpenTask}
                  projectKey={projectKey}
                />
                {isExpanded &&
                  children?.map((child) => (
                    <TaskListRow
                      key={child._id}
                      task={child}
                      nested
                      onOpen={onOpenTask}
                      projectKey={projectKey}
                    />
                  ))}
              </div>
            );
          })}
        </SortableContext>
        {rows.length === 0 && (
          <div className="text-muted-foreground px-3 py-3 text-xs">
            {t('board.noTasks')}
          </div>
        )}
      </div>
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
}) {
  const { t } = useT('tasks');
  const identifier = formatTaskIdentifier(projectKey, task.number);
  const assignTask = useAssignTask();
  const updateTask = useUpdateTask();
  const hasSubtasks = (subtasks?.length ?? 0) > 0;
  const { done, total } = subtaskProgress(subtasks);

  // Subtask rows are not draggable; only top-level rows participate in the DnD
  // sortable context. `useSortable` is still called unconditionally to respect
  // the rules of hooks, but its wiring is ignored for nested rows.
  const sortable = useSortable({ id: task._id, data: { status: task.status } });
  const style = nested
    ? undefined
    : {
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      };

  const dragProps = nested
    ? {}
    : {
        ref: sortable.setNodeRef,
        style,
        ...sortable.attributes,
        ...sortable.listeners,
      };

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/prefer-tag-over-role -- clickable row wraps the priority/assignee buttons so it can't be a real <button>; top-level rows get role/tabIndex from dnd-kit, nested rows declare them here; keyboard handled via onKeyDown
    <div
      {...dragProps}
      role={nested ? 'button' : undefined}
      tabIndex={nested ? 0 : undefined}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen?.(task);
        }
      }}
      className={cn(
        'group focus-visible:ring-ring/50 flex w-full cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
        nested
          ? 'bg-muted/20 hover:bg-muted/40 focus-visible:bg-muted/40'
          : 'bg-background hover:bg-muted/40 focus-visible:bg-muted/40',
        !nested && sortable.isDragging && 'opacity-40',
        dragging &&
          'bg-card ring-border rounded-lg border border-transparent shadow-lg ring-1',
      )}
    >
      {hasSubtasks && onToggleExpanded ? (
        <button
          type="button"
          aria-label={t('detail.subtasks')}
          aria-expanded={isExpanded}
          className="text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded p-0.5"
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
      {nested && (
        <span
          className="border-muted-foreground/40 ml-1 h-3 w-2 shrink-0 rounded-bl-[3px] border-b border-l"
          aria-hidden="true"
        />
      )}
      {identifier && (
        <Text
          as="span"
          variant="caption"
          className="hidden w-16 shrink-0 font-mono text-[11px] tracking-wide sm:block"
        >
          {identifier}
        </Text>
      )}
      <Text
        as="span"
        variant="body"
        className={cn('line-clamp-1 flex-1', nested && 'text-muted-foreground')}
      >
        {task.title}
      </Text>
      {hasSubtasks && (
        <SubtaskProgress done={done} total={total} className="shrink-0" />
      )}
      <CommentCountIndicator count={task.commentCount} className="shrink-0" />
      <PriorityPicker
        priority={task.priority ?? null}
        align="end"
        onChange={(priority) =>
          updateTask.mutate({ taskId: task._id, priority })
        }
      />
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
  );
}

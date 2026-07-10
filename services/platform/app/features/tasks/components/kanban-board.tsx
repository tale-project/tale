import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Row } from '@tale/ui/layout';
import { useMemo } from 'react';

import { useTaskBoardDnd } from '../hooks/use-task-board-dnd';
import { BOARD_TASK_STATUSES } from '../lib/display';
import { partitionSubtasks } from '../lib/subtasks';
import { BoardColumn } from './board-column';
import { TaskCard, type TaskRow } from './task-card';

/**
 * Kanban board. All drag mechanics (cross-column landing preview, within-column
 * reorder, empty-lane drops, bounce-free optimistic move, gentle autoscroll)
 * live in {@link useTaskBoardDnd}, shared with the list and table layouts.
 */
export function KanbanBoard({
  tasks,
  onOpenTask,
  projectKey,
  canEdit = false,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  /** Caller may write to the project — gates drag-reorder and inline pickers. */
  canEdit?: boolean;
}) {
  const dnd = useTaskBoardDnd(tasks);
  // The board keeps every task as a card (grouped by status); this map only
  // feeds the per-card subtask-progress ring.
  const childrenByParent = useMemo(
    () => partitionSubtasks(tasks).childrenByParent,
    [tasks],
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
    >
      <Row
        gap={3}
        align="stretch"
        className="h-full snap-x overflow-x-auto px-0.5 pb-4"
      >
        {BOARD_TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={dnd.columns[status]
              .map((id) => dnd.byId.get(id))
              .filter((t): t is TaskRow => t != null)}
            childrenByParent={childrenByParent}
            onOpenTask={onOpenTask}
            projectKey={projectKey}
            canEdit={canEdit}
          />
        ))}
      </Row>
      <DragOverlay>
        {dnd.activeTask ? (
          <TaskCard
            task={dnd.activeTask}
            subtasks={childrenByParent.get(dnd.activeTask._id)}
            dragging
            projectKey={projectKey}
            canEdit={canEdit}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

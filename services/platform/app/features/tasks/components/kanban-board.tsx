import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useMemo, useState } from 'react';

import { useMoveTask } from '../hooks/mutations';
import { TASK_STATUS_ORDER, type TaskStatus } from '../lib/display';
import { BoardColumn } from './board-column';
import { TaskCard, type TaskRow } from './task-card';

function groupByStatus(tasks: TaskRow[]): Record<TaskStatus, TaskRow[]> {
  const groups = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    cancelled: [],
  } as Record<TaskStatus, TaskRow[]>;
  for (const task of tasks) groups[task.status].push(task);
  for (const status of TASK_STATUS_ORDER) {
    groups[status].sort((a, b) => a.rank.localeCompare(b.rank));
  }
  return groups;
}

export function KanbanBoard({
  tasks,
  onOpenTask,
  projectKey,
}: {
  tasks: TaskRow[];
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
}) {
  const moveTask = useMoveTask();
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag-and-drop: focus a card and use Space to pick up, arrows to
    // move between/within columns, Space to drop (WCAG — no pointer-only DnD).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const groups = useMemo(() => groupByStatus(tasks), [tasks]);
  const byId = useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const task of tasks) map.set(task._id, task);
    return map;
  }, [tasks]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveTask(byId.get(String(event.active.id)) ?? null);
    },
    [byId],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const dragged = byId.get(String(active.id));
      if (!dragged) return;

      const overId = String(over.id);
      // Dropped onto itself — nothing moved.
      if (overId === dragged._id) return;

      const rawStatus = over.data.current?.status;
      const targetStatus =
        TASK_STATUS_ORDER.find((s) => s === rawStatus) ?? null;
      if (!targetStatus) return;

      // Target column with the dragged card removed, so insert math ignores it.
      const targetColumn = groups[targetStatus];
      const column = targetColumn.filter((t) => t._id !== dragged._id);

      // Insert position: before the card we dropped onto, else append.
      const overIndex = column.findIndex((t) => t._id === overId);
      const insertIndex = overIndex === -1 ? column.length : overIndex;

      const before = column[insertIndex - 1];
      const after = column[insertIndex];

      // No-op: dropped back into its current slot (same status, same
      // neighbours). Compare the new neighbours to the dragged card's current
      // ones in the *unfiltered* column so we don't fire a needless mutation.
      if (dragged.status === targetStatus) {
        const currentIndex = targetColumn.findIndex(
          (t) => t._id === dragged._id,
        );
        const currentBefore = targetColumn[currentIndex - 1];
        const currentAfter = targetColumn[currentIndex + 1];
        if (
          before?._id === currentBefore?._id &&
          after?._id === currentAfter?._id
        ) {
          return;
        }
      }

      moveTask.mutate({
        taskId: dragged._id,
        status: targetStatus,
        beforeTaskId: before?._id,
        afterTaskId: after?._id,
      });
    },
    [byId, groups, moveTask],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full snap-x gap-3 overflow-x-auto px-0.5 pb-4">
        {TASK_STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={groups[status]}
            onOpenTask={onOpenTask}
            projectKey={projectKey}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <TaskCard task={activeTask} dragging projectKey={projectKey} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

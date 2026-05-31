import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
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

      const rawStatus = over.data.current?.status;
      const targetStatus =
        TASK_STATUS_ORDER.find((s) => s === rawStatus) ?? null;
      if (!targetStatus) return;

      // Target column order excluding the dragged card.
      const column = groups[targetStatus].filter((t) => t._id !== dragged._id);

      // Insert position: before the card we dropped onto, else append.
      const overId = String(over.id);
      const overIndex = column.findIndex((t) => t._id === overId);
      const insertIndex = overIndex === -1 ? column.length : overIndex;

      const before = column[insertIndex - 1];
      const after = column[insertIndex];

      // No-op: same status and same neighbours.
      if (
        dragged.status === targetStatus &&
        before?._id === groups[targetStatus][insertIndex - 1]?._id &&
        after?._id === dragged._id
      ) {
        return;
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
      <div className="flex h-full gap-3 overflow-x-auto pb-4">
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

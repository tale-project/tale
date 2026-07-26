import {
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TaskRow } from '../components/task-card';
import { TASK_STATUS_ORDER, type TaskStatus } from '../lib/display';
import { useMoveTask } from './mutations';
import { useTaskStatusChoreography } from './use-task-status-choreography';

export type TaskColumns = Record<TaskStatus, string[]>;

function emptyColumns(): TaskColumns {
  return {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    cancelled: [],
  };
}

function buildColumns(tasks: TaskRow[]): TaskColumns {
  const cols = emptyColumns();
  // Sort once globally by rank, then partition — each column inherits rank order
  // without a per-column O(n²) lookup.
  const sorted = [...tasks].sort((a, b) => a.rank.localeCompare(b.rank));
  for (const task of sorted) cols[task.status].push(task._id);
  return cols;
}

function findContainer(cols: TaskColumns, id: string): TaskStatus | undefined {
  // `id` is either a column id (a status string) or a task id living in a column.
  const asStatus = TASK_STATUS_ORDER.find((status) => status === id);
  if (asStatus) return asStatus;
  return TASK_STATUS_ORDER.find((status) => cols[status].includes(id));
}

export interface TaskBoardDnd {
  /** Working copy of column → task-id ordering (reflects in-progress drags). */
  columns: TaskColumns;
  byId: Map<string, TaskRow>;
  activeId: string | null;
  activeTask: TaskRow | null;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  autoScroll: { acceleration: number; threshold: { x: number; y: number } };
}

/**
 * Shared drag-and-drop engine for every task layout (board, list, table).
 *
 * Keeps a local column→ids working copy so a drag reorders within a column
 * (arrayMove on drop), previews the landing slot live across columns and into
 * empty lanes (`onDragOver`), and never bounces back (the copy already reflects
 * the drop; a failed write reverts via the prop resync). Consumers render their
 * own `<DndContext>` with these props plus per-status `<SortableContext>`s.
 */
export function useTaskBoardDnd(tasks: TaskRow[]): TaskBoardDnd {
  const moveTask = useMoveTask();
  // Cross-column drags on automation-owned tasks route through the owning
  // workflow's choreography (drag to In progress = start, drag out = cancel)
  // instead of a bare status write. Rows all belong to one org + project.
  const choreograph = useTaskStatusChoreography(
    tasks[0]?.organizationId ?? '',
    tasks[0]?.projectId,
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Space picks up / drops a card and arrow keys move it; Escape cancels.
      // Enter is deliberately NOT a drag key so the card/row keydown handler can
      // use it to OPEN the task — without this, dnd-kit's default (Space+Enter
      // start a drag) would collide with opening.
      keyboardCodes: {
        start: ['Space'],
        cancel: ['Escape'],
        end: ['Space'],
      },
    }),
  );

  const byId = useMemo(() => {
    const map = new Map<string, TaskRow>();
    for (const task of tasks) map.set(task._id, task);
    return map;
  }, [tasks]);

  const columnsFromProps = useMemo(() => buildColumns(tasks), [tasks]);

  const [columns, setColumnsState] = useState(columnsFromProps);
  const columnsRef = useRef(columnsFromProps);
  const draggingRef = useRef(false);

  const setColumns = useCallback((next: TaskColumns) => {
    columnsRef.current = next;
    setColumnsState(next);
  }, []);

  useEffect(() => {
    if (!draggingRef.current) setColumns(columnsFromProps);
  }, [columnsFromProps, setColumns]);

  const onDragStart = useCallback((event: DragStartEvent) => {
    draggingRef.current = true;
    setActiveId(String(event.active.id));
  }, []);

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);

      const cols = columnsRef.current;
      const activeContainer = findContainer(cols, activeIdStr);
      const overContainer = findContainer(cols, overIdStr);
      if (
        !activeContainer ||
        !overContainer ||
        activeContainer === overContainer
      ) {
        return;
      }

      const activeItems = cols[activeContainer];
      const overItems = cols[overContainer];
      const overIndex =
        overIdStr === overContainer
          ? overItems.length
          : overItems.indexOf(overIdStr);
      const insertAt = overIndex < 0 ? overItems.length : overIndex;

      setColumns({
        ...cols,
        [activeContainer]: activeItems.filter((id) => id !== activeIdStr),
        [overContainer]: [
          ...overItems.slice(0, insertAt),
          activeIdStr,
          ...overItems.slice(insertAt),
        ],
      });
    },
    [setColumns],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingRef.current = false;
      setActiveId(null);
      const { active, over } = event;
      if (!over) {
        setColumns(columnsFromProps);
        return;
      }

      const activeIdStr = String(active.id);
      const overIdStr = String(over.id);
      const cols = columnsRef.current;
      const container =
        findContainer(cols, overIdStr) ?? findContainer(cols, activeIdStr);
      if (!container) {
        setColumns(columnsFromProps);
        return;
      }

      const current = cols[container];
      const oldIndex = current.indexOf(activeIdStr);
      if (oldIndex === -1) {
        setColumns(columnsFromProps);
        return;
      }
      const newIndex =
        overIdStr === container
          ? current.length - 1
          : (() => {
              const i = current.indexOf(overIdStr);
              return i === -1 ? current.length - 1 : i;
            })();

      const finalArr =
        oldIndex === newIndex
          ? current
          : arrayMove(current, oldIndex, newIndex);
      setColumns({ ...cols, [container]: finalArr });

      const pos = finalArr.indexOf(activeIdStr);
      const beforeIdStr = finalArr[pos - 1];
      const afterIdStr = finalArr[pos + 1];

      // Skip the write when nothing changed (dropped back in place).
      const origContainer = findContainer(columnsFromProps, activeIdStr);
      const origArr = origContainer ? columnsFromProps[origContainer] : [];
      const origPos = origArr.indexOf(activeIdStr);
      if (
        origContainer === container &&
        origArr[origPos - 1] === beforeIdStr &&
        origArr[origPos + 1] === afterIdStr
      ) {
        return;
      }

      // Resolve back to typed task ids via the row map (no unsafe casts).
      const row = byId.get(activeIdStr);
      if (!row) return;
      const move = () =>
        moveTask.mutate({
          taskId: row._id,
          status: container,
          beforeTaskId: beforeIdStr ? byId.get(beforeIdStr)?._id : undefined,
          afterTaskId: afterIdStr ? byId.get(afterIdStr)?._id : undefined,
        });
      if (origContainer === container) {
        move();
        return;
      }
      // Cross-column: let the owning automation's choreography interpret the
      // board verb first. 'move' → the plain write still lands the drop;
      // 'handled' → the workflow drives the status (keep the optimistic
      // placement); 'blocked' → snap the card back where it came from.
      void choreograph(row, container).then((outcome) => {
        if (outcome === 'move') move();
        else if (outcome === 'blocked') setColumns(columnsFromProps);
      });
    },
    [byId, choreograph, columnsFromProps, moveTask, setColumns],
  );

  const onDragCancel = useCallback(() => {
    draggingRef.current = false;
    setActiveId(null);
    setColumns(columnsFromProps);
  }, [columnsFromProps, setColumns]);

  const activeTask = activeId ? (byId.get(activeId) ?? null) : null;

  return {
    columns,
    byId,
    activeId,
    activeTask,
    sensors,
    collisionDetection: closestCorners,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    autoScroll: { acceleration: 5, threshold: { x: 0.15, y: 0.2 } },
  };
}

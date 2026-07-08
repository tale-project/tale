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

/** A settled drop: the dragged row, its target lane, and its new neighbours
 *  (each `undefined` at the corresponding end of the lane). */
export interface BoardMove<Row> {
  row: Row;
  lane: string;
  beforeRow?: Row;
  afterRow?: Row;
}

export interface BoardDndOptions<Row> {
  rows: Row[];
  /** Declared lane values, in render order. Rows whose lane isn't declared are
   *  excluded from `columns` (the caller decides how to surface them). */
  lanes: readonly string[];
  /** Stable unique id per row (the dnd-kit draggable id). */
  getId: (row: Row) => string;
  /** Which lane a row belongs to (e.g. its `status` field). */
  getLane: (row: Row) => string;
  /** Optional global ordering applied before partitioning into lanes (e.g. by
   *  LexoRank). Omit to keep the incoming row order. */
  sortRows?: (a: Row, b: Row) => number;
  /** Fired once per settled drop that actually changed lane or neighbours. */
  onMove: (move: BoardMove<Row>) => void;
}

export interface BoardDnd<Row> {
  /** Working copy of lane → row-id ordering (reflects in-progress drags). */
  columns: Record<string, string[]>;
  byId: Map<string, Row>;
  activeId: string | null;
  activeRow: Row | null;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  autoScroll: { acceleration: number; threshold: { x: number; y: number } };
  /** Discard the local working copy and resync from `rows` — call after a
   *  failed `onMove` write when no reactive rollback will arrive via props. */
  reset: () => void;
  /** Programmatic (keyboard-path) move: append the row to the END of `lane`,
   *  updating the working copy and emitting the same settled `onMove` as a
   *  drop onto the lane surface (`beforeRow` = the previously-last card,
   *  `afterRow` = `undefined`). No-op for unknown rows, undeclared lanes, or
   *  the row's own lane. */
  moveToLaneEnd: (id: string, lane: string) => void;
}

function buildColumns<Row>(
  rows: Row[],
  lanes: readonly string[],
  getId: (row: Row) => string,
  getLane: (row: Row) => string,
  sortRows?: (a: Row, b: Row) => number,
): Record<string, string[]> {
  const cols: Record<string, string[]> = {};
  for (const lane of lanes) cols[lane] = [];
  // Sort once globally, then partition — each lane inherits the order without
  // a per-lane O(n²) lookup.
  const ordered = sortRows ? [...rows].sort(sortRows) : rows;
  for (const row of ordered) {
    // Undeclared lane → the row is not on the board (hidden, not misfiled).
    cols[getLane(row)]?.push(getId(row));
  }
  return cols;
}

function findContainer(
  cols: Record<string, string[]>,
  lanes: readonly string[],
  id: string,
): string | undefined {
  // `id` is either a lane id (a lane value) or a row id living in a lane.
  const asLane = lanes.find((lane) => lane === id);
  if (asLane !== undefined) return asLane;
  return lanes.find((lane) => (cols[lane] ?? []).includes(id));
}

/**
 * Generic kanban drag-and-drop engine — the drag mechanics extracted from the
 * tasks board (`app/features/tasks/hooks/use-task-board-dnd.ts`), domain-free:
 * rows + a lane accessor + the declared lane order in; drag state and a settled
 * `onMove` ({row, lane, beforeRow?, afterRow?}) out.
 *
 * Keeps a local lane→ids working copy so a drag reorders within a lane
 * (arrayMove on drop), previews the landing slot live across lanes and into
 * empty lanes (`onDragOver`), and never bounces back (the copy already reflects
 * the drop; a failed write reverts via the prop resync — or `reset()` when the
 * write has no reactive rollback). Consumers render their own `<DndContext>`
 * with these props plus a per-lane `<SortableContext>`.
 *
 * `lanes`, `getId`, `getLane`, and `sortRows` must be referentially stable
 * (module constants or memoized) — they feed the props-resync effect, and an
 * identity churn there would resync on every render.
 */
export function useBoardDnd<Row>({
  rows,
  lanes,
  getId,
  getLane,
  sortRows,
  onMove,
}: BoardDndOptions<Row>): BoardDnd<Row> {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const byId = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of rows) map.set(getId(row), row);
    return map;
  }, [rows, getId]);

  const columnsFromProps = useMemo(
    () => buildColumns(rows, lanes, getId, getLane, sortRows),
    [rows, lanes, getId, getLane, sortRows],
  );

  const [columns, setColumnsState] = useState(columnsFromProps);
  const columnsRef = useRef(columnsFromProps);
  const draggingRef = useRef(false);

  const setColumns = useCallback((next: Record<string, string[]>) => {
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
      const activeContainer = findContainer(cols, lanes, activeIdStr);
      const overContainer = findContainer(cols, lanes, overIdStr);
      if (
        activeContainer === undefined ||
        overContainer === undefined ||
        activeContainer === overContainer
      ) {
        return;
      }

      const activeItems = cols[activeContainer] ?? [];
      const overItems = cols[overContainer] ?? [];
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
    [lanes, setColumns],
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
        findContainer(cols, lanes, overIdStr) ??
        findContainer(cols, lanes, activeIdStr);
      if (container === undefined) {
        setColumns(columnsFromProps);
        return;
      }

      const current = cols[container] ?? [];
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
      const origContainer = findContainer(columnsFromProps, lanes, activeIdStr);
      const origArr =
        origContainer !== undefined
          ? (columnsFromProps[origContainer] ?? [])
          : [];
      const origPos = origArr.indexOf(activeIdStr);
      if (
        origContainer === container &&
        origArr[origPos - 1] === beforeIdStr &&
        origArr[origPos + 1] === afterIdStr
      ) {
        return;
      }

      // Resolve back to rows via the map (no unsafe casts).
      const row = byId.get(activeIdStr);
      if (!row) return;
      onMove({
        row,
        lane: container,
        beforeRow:
          beforeIdStr !== undefined ? byId.get(beforeIdStr) : undefined,
        afterRow: afterIdStr !== undefined ? byId.get(afterIdStr) : undefined,
      });
    },
    [byId, columnsFromProps, lanes, onMove, setColumns],
  );

  const onDragCancel = useCallback(() => {
    draggingRef.current = false;
    setActiveId(null);
    setColumns(columnsFromProps);
  }, [columnsFromProps, setColumns]);

  const reset = useCallback(() => {
    setColumns(columnsFromProps);
  }, [columnsFromProps, setColumns]);

  const moveToLaneEnd = useCallback(
    (id: string, lane: string) => {
      const row = byId.get(id);
      if (!row || !lanes.includes(lane)) return;
      const cols = columnsRef.current;
      const from = findContainer(cols, lanes, id);
      if (from === undefined || from === lane) return;
      const target = cols[lane] ?? [];
      // Optimistic, like a settled drop: the working copy already reflects the
      // move and holds until the live query pushes the persisted order — a
      // failed write reverts via `reset()` (the caller's `onMove` failure path).
      setColumns({
        ...cols,
        [from]: (cols[from] ?? []).filter((existing) => existing !== id),
        [lane]: [...target, id],
      });
      // End-of-lane neighbours, exactly as `onDragEnd` computes them for a
      // drop on the lane surface: the previously-last card sits BEFORE the
      // moved one, nothing after it.
      const beforeId = target[target.length - 1];
      onMove({
        row,
        lane,
        beforeRow: beforeId !== undefined ? byId.get(beforeId) : undefined,
        afterRow: undefined,
      });
    },
    [byId, lanes, onMove, setColumns],
  );

  const activeRow = activeId !== null ? (byId.get(activeId) ?? null) : null;

  return {
    columns,
    byId,
    activeId,
    activeRow,
    sensors,
    collisionDetection: closestCorners,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    autoScroll: { acceleration: 5, threshold: { x: 0.15, y: 0.2 } },
    reset,
    moveToLaneEnd,
  };
}

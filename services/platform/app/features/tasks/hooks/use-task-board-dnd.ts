import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createBoardCollisionDetection } from '@/app/hooks/use-board-dnd';
import { useT } from '@/lib/i18n/client';

import type { TaskRow } from '../components/task-card';
import { TASK_STATUS_ORDER, type TaskStatus } from '../lib/display';
import { useMoveTask } from './mutations';
import {
  useTaskStatusChoreography,
  type TaskStatusChoreographyOptions,
} from './use-task-status-choreography';

export type TaskColumns = Record<TaskStatus, string[]>;

/** One object for every render, so `DndContext` never sees a new option. */
const AUTO_SCROLL = { acceleration: 5, threshold: { x: 0.15, y: 0.2 } };

// The sensors' options are module constants: `useSensor` memoizes on their
// identity, and a new object each render handed `DndContext` new sensors,
// which re-rendered every card and row subscribed to it on every render.
const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const KEYBOARD_SENSOR_OPTIONS = {
  coordinateGetter: sortableKeyboardCoordinates,
  // An expanded parent can be thousands of pixels from its next sortable
  // peer. Complete the scroll before a following key or drop uses its target.
  scrollBehavior: 'auto' as const,
  // Space picks up / drops a card and arrow keys move it; Escape cancels.
  // Enter is deliberately NOT a drag key so the card/row keydown handler can
  // use it to OPEN the task — without this, dnd-kit's default (Space+Enter
  // start a drag) would collide with opening.
  keyboardCodes: {
    start: ['Space'],
    cancel: ['Escape'],
    end: ['Space'],
  },
};

export interface TaskBoardDndOptions extends TaskStatusChoreographyOptions {
  /** The board's project key: drag announcements name a task `KEY-12` when
   * its row carries no key of its own. */
  projectKey?: string | null;
}

/** A task's place in a status: its 1-based position among `total` tasks. */
interface TaskSlot {
  status: TaskStatus;
  position: number;
  total: number;
}

/** What the last drop did, kept for its announcement. */
type DropOutcome =
  | { kind: 'placed'; slot: TaskSlot; moved: boolean }
  | { kind: 'refused'; slot: TaskSlot | null };

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

/**
 * Where dropping `activeId` over `overId` lands it, read from the working
 * copy: the lane's order after the drop, the task's index in it and its slot.
 * `null` when the target is in no lane or the task is not in it. The drop and
 * the move announcements both read it, so a screen reader hears the slot the
 * drop will actually take.
 */
function resolveDrop(cols: TaskColumns, activeId: string, overId: string) {
  const status = findContainer(cols, overId) ?? findContainer(cols, activeId);
  if (!status) return null;
  const lane = cols[status];
  const from = lane.indexOf(activeId);
  if (from === -1) return null;
  const overIndex = lane.indexOf(overId);
  // The lane surface itself (or an id it no longer holds) is its end.
  const index =
    overId === status || overIndex === -1 ? lane.length - 1 : overIndex;
  const order = from === index ? lane : arrayMove(lane, from, index);
  const slot: TaskSlot = { status, position: index + 1, total: order.length };
  return { order, index, slot };
}

function slotOf(cols: TaskColumns, id: string): TaskSlot | null {
  const status = findContainer(cols, id);
  if (!status) return null;
  const lane = cols[status];
  return { status, position: lane.indexOf(id) + 1, total: lane.length };
}

export interface TaskBoardDnd {
  /** Working copy of column → task-id ordering (reflects in-progress drags). */
  columns: TaskColumns;
  byId: Map<string, TaskRow>;
  activeId: string | null;
  /** Keep the source mounted until dnd-kit restores keyboard focus after a
   * drop or cancel, including when a lane change remounted its title. */
  pinnedTaskId: string | null;
  activeTask: TaskRow | null;
  sensors: ReturnType<typeof useSensors>;
  collisionDetection: CollisionDetection;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  autoScroll: { acceleration: number; threshold: { x: number; y: number } };
  /** The `<DndContext>` `accessibility` of every task layout: instructions
   * for the title and announcements that name the task, its status and its
   * position, never an internal id. */
  accessibility: {
    announcements: Announcements;
    screenReaderInstructions: ScreenReaderInstructions;
  };
}

/**
 * Shared drag-and-drop engine for every task layout (board, list, table).
 *
 * Keeps a local column→ids working copy so a drag reorders within a column
 * (arrayMove on drop), previews the landing slot live across columns and into
 * empty lanes (`onDragOver`), and never bounces back (the copy already reflects
 * the drop; a failed write reverts via the prop resync). Consumers render their
 * own `<DndContext>` with these props (its `accessibility` included, so every
 * layout speaks the same lines) plus per-status `<SortableContext>`s.
 */
export function useTaskBoardDnd(
  tasks: TaskRow[],
  options?: TaskBoardDndOptions,
): TaskBoardDnd {
  const { t } = useT('tasks');
  const projectKey = options?.projectKey;
  const moveTask = useMoveTask();
  // Cross-column drags on automation-owned tasks route through the owning
  // workflow's choreography (drag to In progress = start, drag out = cancel)
  // instead of a bare status write. A single-project board scopes the
  // contract catalog to that project; the all-projects board loads org +
  // project-bound automations (no projectId) so ownership still resolves.
  const choreographyProjectId = useMemo(() => {
    const first = tasks[0]?.projectId;
    if (first === undefined) return undefined;
    return tasks.every((task) => task.projectId === first) ? first : undefined;
  }, [tasks]);
  const choreograph = useTaskStatusChoreography(
    tasks[0]?.organizationId ?? '',
    choreographyProjectId,
    options,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pinnedTaskId, setPinnedTaskId] = useState<string | null>(null);
  const [pendingChoreographies, setPendingChoreographies] = useState(0);
  useEffect(() => {
    if (activeId !== null || pinnedTaskId === null || pendingChoreographies > 0)
      return undefined;
    // dnd-kit's focus restoration runs on the next animation frame. Retain
    // the newly registered source until the following frame; its focus pin
    // then takes over in the windowed list.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPinnedTaskId(null));
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, pinnedTaskId, pendingChoreographies]);

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
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
  const dropRef = useRef<DropOutcome | null>(null);
  // The slot the announcer spoke last. dnd-kit reports a picked-up task over
  // itself right away, which would drown the pickup line; a move to the slot
  // just spoken stays silent.
  const spokenSlotRef = useRef<string | null>(null);

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
    setPinnedTaskId(String(event.active.id));
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
      const activeIdStr = String(active.id);
      const cols = columnsRef.current;
      const drop = over
        ? resolveDrop(cols, activeIdStr, String(over.id))
        : null;
      if (!drop) {
        setColumns(columnsFromProps);
        dropRef.current = {
          kind: 'refused',
          slot: slotOf(columnsFromProps, activeIdStr),
        };
        return;
      }

      const container = drop.slot.status;
      const finalArr = drop.order;
      setColumns({ ...cols, [container]: finalArr });

      const beforeIdStr = finalArr[drop.index - 1];
      const afterIdStr = finalArr[drop.index + 1];

      // Skip the write when nothing changed (dropped back in place).
      const origContainer = findContainer(columnsFromProps, activeIdStr);
      const origArr = origContainer ? columnsFromProps[origContainer] : [];
      const origPos = origArr.indexOf(activeIdStr);
      const unchanged =
        origContainer === container &&
        origArr[origPos - 1] === beforeIdStr &&
        origArr[origPos + 1] === afterIdStr;
      dropRef.current = { kind: 'placed', slot: drop.slot, moved: !unchanged };
      if (unchanged) return;

      // Resolve back to typed task ids via the row map (no unsafe casts).
      const row = byId.get(activeIdStr);
      if (!row) return;
      const placement = {
        beforeTaskId: beforeIdStr ? byId.get(beforeIdStr)?._id : undefined,
        afterTaskId: afterIdStr ? byId.get(afterIdStr)?._id : undefined,
      };
      const move = () =>
        moveTask.mutate({ taskId: row._id, status: container, ...placement });
      if (origContainer === container) {
        move();
        return;
      }
      // Cross-column: let the owning automation's choreography interpret the
      // board verb first. 'move' → the plain write still lands the drop;
      // 'handled' → the stop already landed it at this placement, or the
      // workflow drives the status (keep the optimistic placement);
      // 'blocked' → snap the card back where it came from.
      setPendingChoreographies((count) => count + 1);
      void choreograph(row, container, placement)
        .then((outcome) => {
          if (outcome === 'move') move();
          else if (outcome === 'blocked') setColumns(columnsFromProps);
        })
        .finally(() => setPendingChoreographies((count) => count - 1));
    },
    [byId, choreograph, columnsFromProps, moveTask, setColumns],
  );

  const onDragCancel = useCallback(() => {
    draggingRef.current = false;
    setActiveId(null);
    setColumns(columnsFromProps);
  }, [columnsFromProps, setColumns]);

  const activeTask = activeId ? (byId.get(activeId) ?? null) : null;

  // Pointer-first: the lane under the pointer decides (an empty lane is a
  // valid target), never the nearest card of the neighbouring lane. Reads the
  // ref so a mid-drag lane change (onDragOver) is judged live.
  const collisionDetection = useMemo(
    () => createBoardCollisionDetection(() => columnsRef.current),
    [],
  );

  // dnd-kit calls the `DndContext` handlers above before its announcer, so
  // each line reads the working copy (and the drop's outcome) they left.
  const accessibility = useMemo(() => {
    // `GS-1, Title` when picked up; the key alone once it has been heard.
    const nameOf = (task: TaskRow, withTitle: boolean) => {
      const key = formatTaskIdentifier(
        task.projectKey ?? projectKey,
        task.number,
      );
      if (!key) return task.title;
      return withTitle ? `${key}, ${task.title}` : key;
    };
    const place = (slot: TaskSlot) => ({
      status: t(`status.${slot.status}`),
      position: slot.position,
      total: slot.total,
    });
    const keyOf = (slot: TaskSlot) =>
      `${slot.status}:${slot.position}:${slot.total}`;

    const announcements: Announcements = {
      onDragStart({ active }) {
        const id = String(active.id);
        const task = byId.get(id);
        const slot = slotOf(columnsRef.current, id);
        spokenSlotRef.current = slot ? keyOf(slot) : null;
        if (!task || !slot) return t('drag.gone');
        return t('drag.pickedUp', { task: nameOf(task, true), ...place(slot) });
      },
      onDragOver({ active, over }) {
        const slot = over
          ? resolveDrop(columnsRef.current, String(active.id), String(over.id))
              ?.slot
          : null;
        const key = slot ? keyOf(slot) : 'none';
        if (key === spokenSlotRef.current) return undefined;
        spokenSlotRef.current = key;
        return slot ? t('drag.over', place(slot)) : t('drag.noTarget');
      },
      onDragEnd({ active }) {
        const outcome = dropRef.current;
        dropRef.current = null;
        spokenSlotRef.current = null;
        const task = byId.get(String(active.id));
        // A task gone mid-drag is not written (`onDragEnd` finds no row).
        if (!task || !outcome?.slot) return t('drag.gone');
        const values = { task: nameOf(task, false), ...place(outcome.slot) };
        // Name the drop, not a new status: a workflow can still refuse it.
        if (outcome.kind === 'refused') return t('drag.droppedOutside', values);
        return outcome.moved
          ? t('drag.dropped', values)
          : t('drag.droppedInPlace', values);
      },
      onDragCancel({ active }) {
        spokenSlotRef.current = null;
        const id = String(active.id);
        const task = byId.get(id);
        const slot = slotOf(columnsRef.current, id);
        if (!task || !slot) return t('drag.gone');
        return t('drag.cancelled', {
          task: nameOf(task, false),
          ...place(slot),
        });
      },
    };
    const screenReaderInstructions: ScreenReaderInstructions = {
      draggable: t('drag.instructions'),
    };
    return { announcements, screenReaderInstructions };
  }, [byId, projectKey, t]);

  return {
    columns,
    byId,
    activeId,
    pinnedTaskId,
    activeTask,
    sensors,
    collisionDetection,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
    autoScroll: AUTO_SCROLL,
    accessibility,
  };
}

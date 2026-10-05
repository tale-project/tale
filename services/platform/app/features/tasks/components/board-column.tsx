import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '@tale/ui/cn';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from '@tanstack/react-virtual';
import { memo, type ReactNode, useCallback, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import type { TaskStatus } from '../lib/display';
import { readOnlyBoard, TaskCard, type TaskRow } from './task-card';
import { TaskStatusBadge } from './task-status-badge';

/**
 * A lane holding more cards than this mounts only the cards in and near its
 * scrollport ({@link WindowedLaneCards}); a shorter lane mounts every card,
 * so a board of ordinary size keeps all of its cards in the page (find in
 * page, a screen reader's browse mode). Mounting every card made a
 * 2,000-task board block the tab for 16–26 s on each open, search and
 * clear (#4062).
 */
export const WINDOWED_LANE_MIN_CARDS = 40;
/** A card's height before it is measured: the board's typical card. */
const CARD_HEIGHT_ESTIMATE = 128;
/** The lane's `gap-2`, which cards placed by the window no longer get. */
const CARD_GAP = 8;
/** Cards mounted past each edge of the scrollport, so a quick scroll or a
 * Tab to the next card never lands on a slot that is still empty. */
const CARD_OVERSCAN = 6;

export const BoardColumn = memo(function BoardColumn({
  status,
  taskIds,
  tasksById,
  activeId = null,
  childrenByParent,
  onOpenTask,
  projectKey,
  canWorkTask = readOnlyBoard,
  dropHint = null,
}: {
  status: TaskStatus;
  /** The lane's task ids in board order (the drag's working copy). */
  taskIds: readonly string[];
  tasksById: ReadonlyMap<string, TaskRow>;
  /** The card being dragged: a windowed lane keeps it mounted. */
  activeId?: string | null;
  childrenByParent?: Map<string, TaskRow[]>;
  onOpenTask?: (task: TaskRow) => void;
  projectKey?: string | null;
  /** Whether the viewer may work a task — gates its drag and pickers. */
  canWorkTask?: (task: TaskRow) => boolean;
  /** The verb dropping the currently-dragged card here would carry ("Starts
   * the … run.") — announced in the header while the drag is active. */
  dropHint?: string | null;
}) {
  const { t } = useT('tasks');
  // Column is itself a drop target so cards can be dropped into an empty lane.
  // The droppable id is the bare status string so the board's container-lookup
  // can treat `over.id` uniformly (a status = a column, anything else = a card).
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    data: { type: 'column', status },
  });
  // State, not a ref: the window's virtualizer sits below the lane, so its
  // layout effect runs before the lane's ref is attached, and only a render
  // after that attachment hands it the scrollport.
  const [laneElement, setLaneElement] = useState<HTMLDivElement | null>(null);
  const setLaneRef = useCallback(
    (node: HTMLDivElement | null) => {
      setLaneElement(node);
      setNodeRef(node);
    },
    [setNodeRef],
  );
  const tasks = useMemo(
    () =>
      taskIds
        .map((id) => tasksById.get(id))
        .filter((row): row is TaskRow => row != null),
    [taskIds, tasksById],
  );
  const ids = useMemo(() => tasks.map((task) => task._id), [tasks]);

  const renderCard = (task: TaskRow) => (
    <TaskCard
      key={task._id}
      task={task}
      subtasks={childrenByParent?.get(task._id)}
      onOpen={onOpenTask}
      projectKey={projectKey}
      canWorkTask={canWorkTask}
    />
  );

  return (
    <Stack
      as="section"
      gap={0}
      className="bg-muted/40 w-[80vw] max-w-72 shrink-0 snap-start rounded-lg sm:w-72"
    >
      <Row gap={2} justify="between" className="px-2.5 py-2">
        <TaskStatusBadge status={status} />
        <Text as="span" variant="caption" className="pr-1 tabular-nums">
          {tasks.length}
        </Text>
      </Row>
      {dropHint !== null && (
        <Text
          as="p"
          role="status"
          className={cn(
            'px-2.5 pb-1.5 text-[11px] text-pretty',
            isOver ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {dropHint}
        </Text>
      )}
      <div
        ref={setLaneRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2',
          isOver && 'bg-accent/40 ring-border rounded-lg ring-1 ring-inset',
        )}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {tasks.length > WINDOWED_LANE_MIN_CARDS ? (
            <WindowedLaneCards
              tasks={tasks}
              scrollElement={laneElement}
              activeId={activeId}
              renderCard={renderCard}
            />
          ) : (
            tasks.map(renderCard)
          )}
        </SortableContext>
        {tasks.length === 0 && (
          <Row
            gap={0}
            justify="center"
            className="border-border text-muted-foreground m-1 flex-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs"
          >
            {t('board.noTasks')}
          </Row>
        )}
      </div>
    </Stack>
  );
});

/**
 * A long lane's cards, windowed: only the cards in and near the lane's
 * scrollport are mounted, each placed at its measured offset. The card being
 * dragged and the card holding focus stay mounted wherever the lane scrolls —
 * dnd-kit measures the dragged node, and a focused card that unmounted would
 * drop the focus to the page. Tabbing on from a card scrolls the next one into
 * view, so the keyboard still reaches every card in order.
 */
function WindowedLaneCards({
  tasks,
  scrollElement,
  activeId,
  renderCard,
}: {
  tasks: readonly TaskRow[];
  scrollElement: HTMLDivElement | null;
  activeId: string | null;
  renderCard: (task: TaskRow) => ReactNode;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pinned = useMemo(() => {
    const indexes: number[] = [];
    for (const id of [activeId, focusedId]) {
      if (id === null) continue;
      const index = tasks.findIndex((task) => task._id === id);
      if (index >= 0 && !indexes.includes(index)) indexes.push(index);
    }
    return indexes;
  }, [tasks, activeId, focusedId]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      const extra = pinned.filter((index) => !indexes.includes(index));
      return extra.length === 0
        ? indexes
        : [...indexes, ...extra].sort((a, b) => a - b);
    },
    [pinned],
  );
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => CARD_HEIGHT_ESTIMATE,
    getItemKey: (index) => tasks[index]?._id ?? index,
    gap: CARD_GAP,
    overscan: CARD_OVERSCAN,
    rangeExtractor,
  });

  return (
    <div
      className="relative w-full shrink-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const task = tasks[item.index];
        if (task === undefined) return null;
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full"
            style={{ transform: `translateY(${item.start}px)` }}
            // React hands focus moves inside a card's portaled picker to
            // this card as well, so an open picker pins its card too.
            onFocus={() => setFocusedId(task._id)}
            onBlur={() =>
              setFocusedId((current) => (current === task._id ? null : current))
            }
          >
            {renderCard(task)}
          </div>
        );
      })}
    </div>
  );
}

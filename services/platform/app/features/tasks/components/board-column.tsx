import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FoldHorizontal, Plus, UnfoldHorizontal } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useT } from '@/lib/i18n/client';

import type { TaskStatus } from '../lib/display';
import { LaneQuickAdd, type LaneQuickAddConfig } from './lane-quick-add';
import { readOnlyBoard, TaskCard, type TaskRow } from './task-card';
import { TaskStatusGlyph } from './task-status-glyph';
import { useLaneWindowed, WindowedTaskRows } from './windowed-task-rows';

/** A card's height before it is measured: the board's typical card. */
const CARD_HEIGHT_ESTIMATE = 128;
/** The lane's `gap-2`, which cards placed by the window no longer get. */
const CARD_GAP = 8;
/** A lane's header actions wait for hover or focus, and always show on touch. */
const LANE_ACTION_CLASS =
  'text-muted-foreground hover:text-foreground size-7 opacity-0 transition-opacity group-focus-within/lane:opacity-100 group-hover/lane:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100';

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
  onAddTask,
  quickAdd,
  collapsed = false,
  onCollapsedChange,
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
  /** Open the create dialog with this lane's status — the header's "+". */
  onAddTask?: (status: TaskStatus) => void;
  /** Where the lane's own "Add task" row creates; absent for a viewer who
   * may not create here. */
  quickAdd?: LaneQuickAddConfig;
  /** Folded to a rail: the lane's name, count and a way to open it again,
   * still a place to drop a card. */
  collapsed?: boolean;
  /** Fold or unfold this lane; absent for a lane that cannot fold. Stable:
   * the lane is memoized. */
  onCollapsedChange?: (status: TaskStatus, collapsed: boolean) => void;
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
  const windowed = useLaneWindowed(tasks.length);

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

  const label = t(`status.${status}`);

  // Folding swaps one control for another: the header's fold button for the
  // rail, and back. Focus follows to the control in its new place, so a
  // keyboard reader is not dropped at the top of the page.
  const railButtonRef = useRef<HTMLButtonElement>(null);
  const foldButtonRef = useRef<HTMLButtonElement>(null);
  const refocusToggle = useRef(false);
  const toggleFolded = (fold: boolean) => {
    refocusToggle.current = true;
    onCollapsedChange?.(status, fold);
  };
  useEffect(() => {
    if (!refocusToggle.current) return;
    refocusToggle.current = false;
    (collapsed ? railButtonRef : foldButtonRef).current?.focus();
  }, [collapsed]);

  // A card dropped on the rail leaves with the drag, so dnd-kit has no card
  // to hand focus back to: it stays on the lane that took the card. A drop
  // that opened a dialog (a run to cancel) keeps that dialog's focus.
  const heldOnRail = useRef<string | null>(null);
  useEffect(() => {
    if (!collapsed) return undefined;
    if (activeId !== null) {
      heldOnRail.current = taskIds.includes(activeId) ? activeId : null;
      return undefined;
    }
    const dropped = heldOnRail.current;
    heldOnRail.current = null;
    if (dropped === null || !taskIds.includes(dropped)) return undefined;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        railButtonRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, collapsed, taskIds]);
  const railCountId = useId();

  if (collapsed && onCollapsedChange !== undefined) {
    const active =
      activeId !== null && taskIds.includes(activeId)
        ? tasksById.get(activeId)
        : undefined;
    return (
      <section
        ref={setNodeRef}
        aria-label={label}
        data-collapsed=""
        className={cn(
          'bg-muted/40 flex w-11 shrink-0 snap-start flex-col rounded-lg',
          isOver && 'bg-accent/40 ring-border ring-1 ring-inset',
        )}
      >
        {/* The whole rail opens the lane: its glyph, its count and its name
            standing on end. */}
        <button
          ref={railButtonRef}
          type="button"
          aria-expanded={false}
          aria-label={t('board.expandLane', { status: label })}
          aria-describedby={railCountId}
          title={t('board.expandLane', { status: label })}
          onClick={() => toggleFolded(false)}
          className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring flex flex-1 flex-col items-center gap-2 rounded-lg py-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
        >
          <UnfoldHorizontal aria-hidden className="size-4 shrink-0" />
          <TaskStatusGlyph status={status} className="size-3.5" />
          <span aria-hidden className="text-xs tabular-nums">
            {tasks.length}
          </span>
          <span id={railCountId} className="sr-only">
            {t('board.laneCount', { count: tasks.length })}
          </span>
          <span className="text-foreground text-sm font-medium whitespace-nowrap [writing-mode:vertical-rl]">
            {label}
          </span>
        </button>
        {dropHint !== null && (
          <span role="status" className="sr-only">
            {dropHint}
          </span>
        )}
        {/* A card dragged over the rail joins this lane's working copy; it
            stays mounted so the drag keeps its source, but takes no layout
            box: a measured placeholder would win the collision over the rail
            (and over the next rail) and pin the drop here. */}
        {active !== undefined && (
          <SortableContext items={[active._id]}>
            <div hidden>{renderCard(active)}</div>
          </SortableContext>
        )}
      </section>
    );
  }

  return (
    <Stack
      as="section"
      gap={0}
      aria-label={label}
      className="group/lane bg-muted/40 w-[80vw] max-w-72 shrink-0 snap-start rounded-lg sm:w-72"
    >
      {/* The lane names its status the way Home and the task header do: the
          status glyph and its word, then the count and the lane's own add. */}
      <Row gap={2} align="center" className="h-9 px-2.5">
        <TaskStatusGlyph status={status} className="size-3.5" />
        <Text
          as="span"
          className="text-foreground min-w-0 truncate text-sm font-medium"
        >
          {label}
        </Text>
        <Text as="span" variant="caption" className="tabular-nums">
          {tasks.length}
        </Text>
        <Row gap={0} align="center" className="-mr-1 ml-auto">
          {onCollapsedChange !== undefined && (
            <IconButton
              ref={foldButtonRef}
              icon={FoldHorizontal}
              size="sm"
              variant="ghost"
              aria-label={t('board.collapseLane', { status: label })}
              aria-expanded
              onClick={() => toggleFolded(true)}
              className={LANE_ACTION_CLASS}
            />
          )}
          {onAddTask !== undefined && (
            <IconButton
              icon={Plus}
              size="sm"
              variant="ghost"
              aria-label={t('board.addToLane', { status: label })}
              onClick={() => onAddTask(status)}
              className={LANE_ACTION_CLASS}
            />
          )}
        </Row>
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
          <WindowedTaskRows
            tasks={tasks}
            windowed={windowed}
            scrollElement={laneElement}
            estimateSize={CARD_HEIGHT_ESTIMATE}
            gap={CARD_GAP}
            activeId={activeId}
            renderTask={renderCard}
          />
        </SortableContext>
        {tasks.length === 0 && quickAdd === undefined && (
          <Row
            gap={0}
            justify="center"
            className="border-border text-muted-foreground m-1 flex-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs"
          >
            {t('board.noTasks')}
          </Row>
        )}
        {quickAdd !== undefined && (
          <LaneQuickAdd status={status} config={quickAdd} />
        )}
      </div>
    </Stack>
  );
});

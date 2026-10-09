import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Plus } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';

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

  return (
    <Stack
      as="section"
      gap={0}
      aria-label={t(`status.${status}`)}
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
          {t(`status.${status}`)}
        </Text>
        <Text as="span" variant="caption" className="tabular-nums">
          {tasks.length}
        </Text>
        {onAddTask !== undefined && (
          <IconButton
            icon={Plus}
            size="sm"
            variant="ghost"
            aria-label={t('board.addToLane', { status: t(`status.${status}`) })}
            onClick={() => onAddTask(status)}
            className="text-muted-foreground hover:text-foreground -mr-1 ml-auto size-7 opacity-0 transition-opacity group-focus-within/lane:opacity-100 group-hover/lane:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100"
          />
        )}
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

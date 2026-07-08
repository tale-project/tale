'use client';

/**
 * Connected `Board` block — a kanban over ANY allowlisted query
 * (`boardPropsSchema` in `lib/shared/schemas/automation_views.ts`). Lanes are declared
 * view data (`lanes[].value` matched against the row's `groupBy` field, headers
 * from `labelKey`), cards are a field map (`card`), and a drop dispatches the
 * `move` binding. The drag mechanics are the generic `useBoardDnd`
 * (`automation/hooks/use-board-dnd.ts`) — the engine extracted from the tasks board —
 * so a drop is optimistic: the local lane placement (keyed by row id) holds
 * until the live query pushes the persisted order; a failed dispatch reverts it
 * (the mutation layer owns the error toast). The card menu's "Move to" submenu
 * is the keyboard-operable path to the same binding: activating a target lane
 * runs the engine's `moveToLaneEnd` — identical to a drop onto the end of that
 * lane (same optimistic placement, same dispatch, same failure revert).
 *
 * MOVE-ARGS CONTRACT: the authored `move.args` resolve with the dragged row as
 * `$selected` and the drop lane as `$lane` (so a bundle maps e.g.
 * `{taskId: '$selected._id', status: '$lane'}`). The block then ALWAYS merges
 * the computed drop neighbours as `{beforeTaskId, afterTaskId}` — possibly
 * `undefined` (the Convex client omits undefined args) — AFTER the authored
 * keys, so computed position always wins an authored clash. A bound move
 * mutation must therefore accept optional `beforeTaskId`/`afterTaskId`
 * (`tasks/mutations:moveTask` rank semantics) or a between-cards drop fails
 * arg validation.
 *
 * Rows whose `groupBy` value matches no declared lane are HIDDEN (counted in a
 * muted header note); `truncated: true` in the query result surfaces a
 * truncation notice the same way.
 */
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Kanban } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useBoardDnd, type BoardMove } from '@/app/hooks/use-board-dnd';
import { useT } from '@/lib/i18n/client';
import type { FunctionMode } from '@/lib/shared/platform/function_bindings';
import { cn } from '@/lib/utils/cn';
import { isRecord, primitiveString } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useBoundQuery } from '../../hooks/use-bound-query';
import {
  useActionEffect,
  type ActionEffect,
} from '../../runtime/action-effects';
import { BindingStates, BlockFrame } from '../block-frame';
import {
  BoardCard,
  type BoardCardSpec,
  type BoardMoveToSpec,
} from './board-card';
import type { BoundActionSpec } from './bound-button';

export interface BoardLaneSpec {
  /** The `groupBy` value this lane collects. */
  value: string;
  /** Lane header — a literal display string, rendered verbatim. */
  labelKey: string;
}

export interface BoardProps {
  title?: string;
  query: { path: string; args?: unknown };
  /** Result key holding the rows array; omit when the result IS the array. */
  itemsKey?: string;
  /** Row field the lanes group by (e.g. `status`). */
  groupBy: string;
  lanes: BoardLaneSpec[];
  card: BoardCardSpec;
  /** When set, cards carry the subject run-status chip (id from the row). */
  subjectType?: string;
  /** The drop mutation — see the move-args contract in the file header. */
  move: { path: string; mode: FunctionMode; args?: unknown };
  /** Per-card actions (conditional via `when`), in the card overflow menu. */
  actions?: BoundActionSpec[];
  onCardClick?: ActionEffect;
}

type BoardRow = Record<string, unknown>;

/** The dnd/subject identity of a row — Convex `_id` first, then a plain `id`.
 *  Rows without either can't be placed on the board. */
function rowIdOf(row: BoardRow): string {
  const id = row._id ?? row.id;
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return String(id);
  return '';
}

/** Rows from the bound result: `itemsKey` when set, else the result itself
 *  when it is an array. Non-record and id-less entries are dropped. */
function extractRows(data: unknown, itemsKey: string | undefined): BoardRow[] {
  const raw =
    itemsKey !== undefined
      ? isRecord(data)
        ? data[itemsKey]
        : undefined
      : data;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).filter((row) => rowIdOf(row) !== '');
}

/**
 * The dispatched move args: the authored template first, then the computed
 * drop neighbours — ALWAYS merged (possibly `undefined`; the Convex client
 * omits undefined fields), so the block owns card position end-to-end. Pure,
 * exported for tests.
 */
export function composeMoveArgs(
  authored: unknown,
  beforeId: string | undefined,
  afterId: string | undefined,
): Record<string, unknown> {
  const base = isRecord(authored) ? authored : {};
  return { ...base, beforeTaskId: beforeId, afterTaskId: afterId };
}

/** One kanban lane: a drop target (the bare lane value as droppable id, so the
 *  engine's container lookup treats `over.id` uniformly) wrapping a
 *  `SortableContext` of cards — the tasks `BoardColumn` anatomy. */
function BoardLane({
  laneValue,
  label,
  rows,
  card,
  subjectType,
  actions,
  moveTo,
  onActivate,
}: {
  laneValue: string;
  label: string;
  rows: BoardRow[];
  card: BoardCardSpec;
  subjectType?: string;
  actions?: BoundActionSpec[];
  moveTo?: BoardMoveToSpec;
  onActivate?: (row: BoardRow) => void;
}) {
  const { t } = useT('automations');
  const { setNodeRef, isOver } = useDroppable({
    id: laneValue,
    data: { type: 'lane', lane: laneValue },
  });

  return (
    <Stack
      as="section"
      gap={0}
      className="bg-muted/40 w-[80vw] max-w-72 shrink-0 snap-start rounded-lg sm:w-72"
    >
      <Row gap={2} justify="between" className="px-2.5 py-2">
        <Text as="span" variant="label" className="truncate">
          {label}
        </Text>
        <Text as="span" variant="caption" className="pr-1 tabular-nums">
          {rows.length}
        </Text>
      </Row>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2',
          isOver && 'bg-accent/40 ring-border rounded-lg ring-1 ring-inset',
        )}
      >
        <SortableContext
          items={rows.map(rowIdOf)}
          strategy={verticalListSortingStrategy}
        >
          {rows.map((row) => (
            <BoardCard
              key={rowIdOf(row)}
              row={row}
              rowId={rowIdOf(row)}
              card={card}
              subjectType={subjectType}
              actions={actions}
              moveTo={moveTo}
              onActivate={onActivate}
            />
          ))}
        </SortableContext>
        {rows.length === 0 && (
          <Row
            gap={0}
            justify="center"
            className="border-border text-muted-foreground m-1 flex-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs"
          >
            {t('binding.empty')}
          </Row>
        )}
      </div>
    </Stack>
  );
}

export function Board({
  title,
  query,
  itemsKey,
  groupBy,
  lanes,
  card,
  subjectType,
  move,
  actions,
  onCardClick,
}: BoardProps) {
  const { t } = useT('automations');
  const { data, isLoading, blocked, needsConfig } = useBoundQuery(
    query.path,
    query.args,
  );
  const applyEffect = useActionEffect();
  const { dispatch } = useBoundAction(move.path, move.mode);

  const rows = useMemo(() => extractRows(data, itemsKey), [data, itemsKey]);
  const truncated = isRecord(data) && data.truncated === true;

  // Key the lane list by content so the dnd engine's props-resync memo only
  // moves when the declared lanes actually change (Puck prop identity is not
  // guaranteed stable across renders).
  const laneKey = lanes.map((lane) => lane.value).join('\u0000');
  const laneValues = useMemo(
    () => (laneKey === '' ? [] : laneKey.split('\u0000')),
    [laneKey],
  );
  const getLane = useCallback(
    (row: BoardRow) => primitiveString(row[groupBy]) ?? '',
    [groupBy],
  );
  const hiddenCount = useMemo(() => {
    const declared = new Set(laneValues);
    return rows.filter((row) => !declared.has(getLane(row))).length;
  }, [rows, laneValues, getLane]);

  // `onMove` needs the engine's reset for the failure revert, but the engine
  // needs `onMove` — bridge with a ref (assigned in an effect, read at drop).
  const resetRef = useRef<() => void>(() => {});
  const moveArgs = move.args;
  const movePath = move.path;
  const onMove = useCallback(
    ({ row, lane, beforeRow, afterRow }: BoardMove<BoardRow>) => {
      const args = composeMoveArgs(
        moveArgs,
        beforeRow ? rowIdOf(beforeRow) : undefined,
        afterRow ? rowIdOf(afterRow) : undefined,
      );
      dispatch(args, row, { lane }).catch((err: unknown) => {
        // The mutation layer already toasts the failure; revert the optimistic
        // lane placement since no reactive rollback will arrive for it.
        console.error('[automation-board] move failed', movePath, err);
        resetRef.current();
      });
    },
    [dispatch, moveArgs, movePath],
  );

  const dnd = useBoardDnd({
    rows,
    lanes: laneValues,
    getId: rowIdOf,
    getLane,
    onMove,
  });
  useEffect(() => {
    resetRef.current = dnd.reset;
  }, [dnd.reset]);

  // The keyboard path to `move` — the card menu's "Move to" targets. The
  // engine's `moveToLaneEnd` applies the same optimistic working-copy update
  // and emits the same `onMove` as a drop onto the end of the target lane, so
  // dispatch, neighbours, and the failure revert are shared with drag.
  const { moveToLaneEnd } = dnd;
  const onMoveToLane = useCallback(
    (row: BoardRow, lane: string) => moveToLaneEnd(rowIdOf(row), lane),
    [moveToLaneEnd],
  );
  const moveToFor = (laneValue: string): BoardMoveToSpec => ({
    targets: lanes
      .filter((lane) => lane.value !== laneValue)
      .map((lane) => ({
        value: lane.value,
        label: lane.labelKey ?? lane.value,
      })),
    onMove: onMoveToLane,
  });

  const onActivate = onCardClick
    ? (row: BoardRow) => applyEffect(onCardClick, undefined, row)
    : undefined;

  const notes = [
    truncated ? t('board.truncated') : undefined,
    hiddenCount > 0
      ? t('board.hiddenCards', { count: hiddenCount })
      : undefined,
  ].filter((note): note is string => note !== undefined);

  return (
    <BlockFrame
      title={title}
      icon={Kanban}
      actions={
        notes.length > 0 ? (
          <Text as="span" variant="caption">
            {notes.join(' · ')}
          </Text>
        ) : undefined
      }
    >
      <BindingStates
        blocked={blocked}
        path={query.path}
        needsConfig={needsConfig}
        loading={isLoading && rows.length === 0}
      >
        {rows.length === 0 ? (
          <Text variant="muted">{t('binding.empty')}</Text>
        ) : (
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
              {lanes.map((lane) => (
                <BoardLane
                  key={lane.value}
                  laneValue={lane.value}
                  label={lane.labelKey ?? lane.value}
                  rows={(dnd.columns[lane.value] ?? [])
                    .map((id) => dnd.byId.get(id))
                    .filter((row): row is BoardRow => row !== undefined)}
                  card={card}
                  subjectType={subjectType}
                  actions={actions}
                  moveTo={moveToFor(lane.value)}
                  onActivate={onActivate}
                />
              ))}
            </Row>
            <DragOverlay>
              {dnd.activeRow ? (
                <BoardCard
                  row={dnd.activeRow}
                  rowId={rowIdOf(dnd.activeRow)}
                  card={card}
                  subjectType={subjectType}
                  actions={actions}
                  // Visual parity only — the floating clone keeps the menu
                  // trigger it had in the lane (inert mid-drag).
                  moveTo={moveToFor(getLane(dnd.activeRow))}
                  dragging
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </BindingStates>
    </BlockFrame>
  );
}

/**
 * The registry entry for `tale-config.tsx` (owned by the registry file):
 * `Board: registerConnectedBlock('Board', boardBlock)` plus a
 * `Board: Partial<BoardProps>` slot in its `TaleComponents` map.
 */
export const boardBlock = {
  fields: { title: { type: 'text' as const } },
  render: ({
    title,
    query,
    itemsKey,
    groupBy,
    lanes,
    card,
    subjectType,
    move,
    actions,
    onCardClick,
  }: Partial<BoardProps>) =>
    query && groupBy && lanes && lanes.length > 0 && card && move ? (
      <Board
        title={title}
        query={query}
        itemsKey={itemsKey}
        groupBy={groupBy}
        lanes={lanes}
        card={card}
        subjectType={subjectType}
        move={move}
        actions={actions}
        onCardClick={onCardClick}
      />
    ) : (
      <></>
    ),
};

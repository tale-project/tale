// @vitest-environment jsdom
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBoardDnd, type BoardMove } from './use-board-dnd';

interface Row {
  id: string;
  lane: string;
  rank: string;
}

const LANES = ['todo', 'doing', 'done'] as const;
const getId = (row: Row): string => row.id;
const getLane = (row: Row): string => row.lane;
const byRank = (a: Row, b: Row): number => a.rank.localeCompare(b.rank);

// Deliberately out of rank order (c before b) so the sort is observable.
const ROWS: Row[] = [
  { id: 'a', lane: 'todo', rank: '1' },
  { id: 'c', lane: 'todo', rank: '3' },
  { id: 'b', lane: 'todo', rank: '2' },
  { id: 'd', lane: 'done', rank: '1' },
  { id: 'x', lane: 'unknown-lane', rank: '0' },
];

const onMove = vi.fn<(move: BoardMove<Row>) => void>();

beforeEach(() => {
  onMove.mockClear();
});

function setup(rows: Row[] = ROWS) {
  return renderHook(
    ({ rows: r }: { rows: Row[] }) =>
      useBoardDnd({
        rows: r,
        lanes: LANES,
        getId,
        getLane,
        sortRows: byRank,
        onMove,
      }),
    { initialProps: { rows } },
  );
}

const start = (id: string): DragStartEvent =>
  ({ active: { id } }) as unknown as DragStartEvent;
const over = (activeId: string, overId: string): DragOverEvent =>
  ({
    active: { id: activeId },
    over: { id: overId },
  }) as unknown as DragOverEvent;
const end = (activeId: string, overId: string | null): DragEndEvent =>
  ({
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  }) as unknown as DragEndEvent;

describe('useBoardDnd — partitioning', () => {
  it('partitions rows into declared lanes in sorted order; undeclared lanes are excluded', () => {
    const { result } = setup();

    expect(result.current.columns).toEqual({
      todo: ['a', 'b', 'c'],
      doing: [],
      done: ['d'],
    });
    // The row map still knows every row (the caller surfaces hidden ones).
    expect(result.current.byId.get('x')).toEqual(ROWS[4]);
  });

  it('resyncs from props while idle, but not mid-drag', () => {
    const { result, rerender } = setup();

    const shrunk = ROWS.filter((r) => r.id !== 'c');
    rerender({ rows: shrunk });
    expect(result.current.columns.todo).toEqual(['a', 'b']);

    act(() => result.current.onDragStart(start('a')));
    rerender({ rows: ROWS });
    // Dragging: the working copy must not be yanked out from under the drag.
    expect(result.current.columns.todo).toEqual(['a', 'b']);
  });
});

describe('useBoardDnd — drops', () => {
  it('reorders within a lane and emits the row with its new neighbours', () => {
    const { result } = setup();

    act(() => result.current.onDragStart(start('a')));
    expect(result.current.activeRow).toEqual(ROWS[0]);
    act(() => result.current.onDragEnd(end('a', 'c')));

    expect(result.current.columns.todo).toEqual(['b', 'c', 'a']);
    expect(result.current.activeRow).toBeNull();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({
      row: ROWS[0],
      lane: 'todo',
      beforeRow: ROWS[1], // c
      afterRow: undefined,
    });
  });

  it('moves across lanes (empty-lane drop) and emits the target lane', () => {
    const { result } = setup();

    act(() => result.current.onDragStart(start('a')));
    // Hovering the empty lane previews the landing slot…
    act(() => result.current.onDragOver(over('a', 'doing')));
    expect(result.current.columns.todo).toEqual(['b', 'c']);
    expect(result.current.columns.doing).toEqual(['a']);
    // …and the drop settles it.
    act(() => result.current.onDragEnd(end('a', 'doing')));

    expect(result.current.columns.doing).toEqual(['a']);
    expect(onMove).toHaveBeenCalledWith({
      row: ROWS[0],
      lane: 'doing',
      beforeRow: undefined,
      afterRow: undefined,
    });
  });

  it('skips the write when the card is dropped back in place', () => {
    const { result } = setup();

    act(() => result.current.onDragStart(start('a')));
    act(() => result.current.onDragEnd(end('a', 'a')));

    expect(result.current.columns.todo).toEqual(['a', 'b', 'c']);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('reverts the preview when the drag is cancelled or dropped nowhere', () => {
    const { result } = setup();

    act(() => result.current.onDragStart(start('a')));
    act(() => result.current.onDragOver(over('a', 'doing')));
    act(() => result.current.onDragCancel());
    expect(result.current.columns).toEqual({
      todo: ['a', 'b', 'c'],
      doing: [],
      done: ['d'],
    });

    act(() => result.current.onDragStart(start('a')));
    act(() => result.current.onDragOver(over('a', 'doing')));
    act(() => result.current.onDragEnd(end('a', null)));
    expect(result.current.columns.todo).toEqual(['a', 'b', 'c']);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('reset() discards a settled optimistic move (failed-write revert)', () => {
    const { result } = setup();

    act(() => result.current.onDragStart(start('a')));
    act(() => result.current.onDragOver(over('a', 'doing')));
    act(() => result.current.onDragEnd(end('a', 'doing')));
    expect(result.current.columns.doing).toEqual(['a']);

    act(() => result.current.reset());
    expect(result.current.columns).toEqual({
      todo: ['a', 'b', 'c'],
      doing: [],
      done: ['d'],
    });
  });
});

describe('useBoardDnd — moveToLaneEnd (keyboard path)', () => {
  it('appends to the target lane end and emits the drop-equivalent neighbours', () => {
    const { result } = setup();

    act(() => result.current.moveToLaneEnd('a', 'done'));

    // Optimistic, like a settled drop: the working copy already moved.
    expect(result.current.columns.todo).toEqual(['b', 'c']);
    expect(result.current.columns.done).toEqual(['d', 'a']);
    // Same neighbour shape as a drop onto the lane surface: the previously-
    // last card sits before the moved one, nothing after it.
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith({
      row: ROWS[0],
      lane: 'done',
      beforeRow: ROWS[3], // d
      afterRow: undefined,
    });
  });

  it('moves into an empty lane with no neighbours', () => {
    const { result } = setup();

    act(() => result.current.moveToLaneEnd('a', 'doing'));

    expect(result.current.columns.doing).toEqual(['a']);
    expect(onMove).toHaveBeenCalledWith({
      row: ROWS[0],
      lane: 'doing',
      beforeRow: undefined,
      afterRow: undefined,
    });
  });

  it("no-ops for the row's own lane, unknown rows, and undeclared lanes", () => {
    const { result } = setup();

    act(() => result.current.moveToLaneEnd('a', 'todo'));
    act(() => result.current.moveToLaneEnd('nope', 'done'));
    act(() => result.current.moveToLaneEnd('a', 'bogus-lane'));

    expect(result.current.columns).toEqual({
      todo: ['a', 'b', 'c'],
      doing: [],
      done: ['d'],
    });
    expect(onMove).not.toHaveBeenCalled();
  });

  it('reset() reverts a settled keyboard move (failed-write revert)', () => {
    const { result } = setup();

    act(() => result.current.moveToLaneEnd('a', 'done'));
    expect(result.current.columns.done).toEqual(['d', 'a']);

    act(() => result.current.reset());
    expect(result.current.columns).toEqual({
      todo: ['a', 'b', 'c'],
      doing: [],
      done: ['d'],
    });
  });
});

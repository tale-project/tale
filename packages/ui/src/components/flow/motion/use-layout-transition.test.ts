import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowGraph, FlowLayout, FlowRect } from '../types';
import { FLOW_DURATION, FLOW_RELAYOUT_SETTLE } from './flow-motion';
import {
  planFlowTransition,
  useLayoutTransition,
  type FlowPicture,
} from './use-layout-transition';

const rect = (x: number, y: number, width = 288, height = 88): FlowRect => ({
  x,
  y,
  width,
  height,
});

/** A three-node chain a → b → c, framed b, laid out by hand. */
function before(): FlowPicture {
  const graph: FlowGraph = {
    nodes: [
      { id: 'a', kind: 'step', label: 'A' },
      { id: 'b', kind: 'step', label: 'B' },
      { id: 'c', kind: 'step', label: 'C' },
    ],
    edges: [
      { id: 'a>b', source: 'a', target: 'b', kind: 'data' },
      { id: 'b>c', source: 'b', target: 'c', kind: 'data' },
      {
        id: 'hidden',
        source: 'a',
        target: 'c',
        kind: 'order',
        layoutOnly: true,
      },
    ],
    groups: [{ id: 'each:b', kind: 'each', label: 'For each', members: ['b'] }],
  };
  const layout: FlowLayout = {
    signature: 'before',
    nodes: { a: rect(0, 0), b: rect(0, 160), c: rect(0, 320) },
    groups: {
      'each:b': { ...rect(-16, 120, 320, 140), header: rect(0, 124, 120, 24) },
    },
    edges: {
      'a>b': {
        points: [
          { x: 144, y: 88 },
          { x: 144, y: 160 },
        ],
      },
      'b>c': {
        points: [
          { x: 144, y: 248 },
          { x: 144, y: 320 },
        ],
      },
    },
    bounds: rect(-16, 0, 320, 408),
    rows: [['a'], ['b'], ['c']],
    engine: 'main',
    ms: 1,
  };
  return { graph, layout };
}

/** The chain after an edit: c removed, d added beside b, a → b unchanged,
 *  b's frame taller. */
function after(): FlowPicture {
  const graph: FlowGraph = {
    nodes: [
      { id: 'a', kind: 'step', label: 'A' },
      { id: 'b', kind: 'step', label: 'B' },
      { id: 'd', kind: 'step', label: 'D' },
    ],
    edges: [
      { id: 'a>b', source: 'a', target: 'b', kind: 'data' },
      { id: 'a>d', source: 'a', target: 'd', kind: 'data' },
    ],
    groups: [{ id: 'each:b', kind: 'each', label: 'For each', members: ['b'] }],
  };
  const layout: FlowLayout = {
    signature: 'after',
    nodes: { a: rect(0, 0), b: rect(0, 160, 288, 108), d: rect(336, 160) },
    groups: {
      'each:b': { ...rect(-16, 120, 320, 160), header: rect(0, 124, 120, 24) },
    },
    edges: {
      'a>b': {
        points: [
          { x: 144, y: 88 },
          { x: 144, y: 160 },
        ],
      },
      'a>d': {
        points: [
          { x: 200, y: 88 },
          { x: 200, y: 120 },
          { x: 480, y: 120 },
          { x: 480, y: 160 },
        ],
      },
    },
    bounds: rect(-16, 0, 640, 268),
    rows: [['a'], ['b', 'd']],
    engine: 'main',
    ms: 1,
  };
  return { graph, layout };
}

describe('planFlowTransition', () => {
  it('moves what stays, grows in what joins and keeps what leaves at its old place', () => {
    const plan = planFlowTransition(before(), after());
    expect([...plan.moving].sort()).toEqual(['a', 'b']);
    expect([...plan.entering]).toEqual(['d']);
    expect(plan.leaving.map(({ node }) => node.id)).toEqual(['c']);
    expect(plan.leaving[0]?.rect).toEqual(rect(0, 320));
  });

  it('crossfades a frame that changed size, glides one that did not', () => {
    const plan = planFlowTransition(before(), after());
    expect([...plan.framesEntering]).toEqual(['each:b']);
    expect(plan.framesLeaving.map(({ rect: box }) => box.height)).toEqual([
      140,
    ]);
    const same = planFlowTransition(before(), {
      ...before(),
      layout: { ...before().layout, signature: 'moved' },
    });
    expect([...same.framesMoving]).toEqual(['each:b']);
    expect(same.framesLeaving).toEqual([]);
  });

  it('fades lines out and in only when they are new, gone or re-routed', () => {
    const plan = planFlowTransition(before(), after());
    // a → b kept its route: it stays as it is.
    expect(plan.edgesEntering.has('a>b')).toBe(false);
    expect(plan.edgesEntering.has('a>d')).toBe(true);
    expect(plan.edgesLeaving.map(({ edge }) => edge.id)).toEqual(['b>c']);
    expect(plan.edgesLeaving[0]?.points).toEqual(
      before().layout.edges['b>c']?.points,
    );
    // A layout-only line is never drawn, so it never fades.
    expect(plan.edgesLeaving.some(({ edge }) => edge.layoutOnly)).toBe(false);
  });
});

describe('useLayoutTransition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plans a live relayout, ends the exits after short and settles after 450 ms', () => {
    const first = before();
    const second = after();
    const { result, rerender } = renderHook(
      ({ picture, layoutKey }) =>
        useLayoutTransition({ picture, layoutKey, enabled: true }),
      { initialProps: { picture: first, layoutKey: 'doc' } },
    );
    expect(result.current.plan).toBeNull();
    rerender({ picture: second, layoutKey: 'doc' });
    expect(result.current.phase).toBe('exit');
    expect(result.current.plan?.entering.has('d')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(FLOW_DURATION.short);
    });
    expect(result.current.phase).toBe('settle');
    act(() => {
      vi.advanceTimersByTime(FLOW_RELAYOUT_SETTLE - FLOW_DURATION.short);
    });
    expect(result.current.plan).toBeNull();
    expect(result.current.phase).toBeNull();
  });

  it('starts a relayout that lands mid-transition from the picture on screen, on its own clock', () => {
    const { result, rerender } = renderHook(
      ({ picture }) =>
        useLayoutTransition({ picture, layoutKey: 'doc', enabled: true }),
      { initialProps: { picture: before() } },
    );
    rerender({ picture: after() });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // Back to the chain while d is still growing in: d leaves, c joins.
    rerender({ picture: before() });
    expect(result.current.phase).toBe('exit');
    expect(result.current.plan?.entering.has('c')).toBe(true);
    expect(result.current.plan?.leaving.map(({ node }) => node.id)).toEqual([
      'd',
    ]);
    // The first relayout's timers no longer count.
    act(() => {
      vi.advanceTimersByTime(FLOW_DURATION.short - 100);
    });
    expect(result.current.phase).toBe('exit');
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.phase).toBe('settle');
    act(() => {
      vi.advanceTimersByTime(FLOW_RELAYOUT_SETTLE - FLOW_DURATION.short);
    });
    expect(result.current.plan).toBeNull();
  });

  it('plays nothing for a new picture, the first layout or reduced motion', () => {
    const { result, rerender } = renderHook(
      ({ picture, layoutKey, enabled }) =>
        useLayoutTransition({ picture, layoutKey, enabled }),
      {
        initialProps: {
          picture: null as FlowPicture | null,
          layoutKey: 'doc',
          enabled: true,
        },
      },
    );
    rerender({ picture: before(), layoutKey: 'doc', enabled: true });
    expect(result.current.plan).toBeNull();
    rerender({ picture: after(), layoutKey: 'v2', enabled: true });
    expect(result.current.plan).toBeNull();
    rerender({ picture: before(), layoutKey: 'v2', enabled: false });
    expect(result.current.plan).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { DOC_EXAMPLE } from '@/lib/engine/api/docs';
import type { NodeDef } from '@/lib/engine/core/types';

import {
  buildGraph,
  controlFlowBadges,
  deriveEdges,
  orderedNodes,
  rankNodes,
} from './graph';

/**
 * The canvas has no edge list of its own — it reads the same references the
 * executor orders on. So these tests hold the derivation to the document,
 * including the engine's own worked example, which the engine's selftest
 * executes: if the canvas and the executor ever disagree about which node feeds
 * which, one of them is wrong.
 */

const nodes = (...defs: NodeDef[]) => defs;

describe('deriveEdges', () => {
  it('draws an edge for a data reference in a node input', () => {
    const edges = deriveEdges(
      nodes(
        { id: 'a', type: 'transform', code: 'return 1;' },
        {
          id: 'b',
          type: 'transform',
          input: { value: '{{ nodes.a.output }}' },
          code: 'return input.value;',
        },
      ),
    );
    expect(edges).toEqual([
      { id: 'a->b', source: 'a', target: 'b', kind: 'data' },
    ]);
  });

  it('marks a reference from `when` as control, not data', () => {
    const edges = deriveEdges(
      nodes(
        { id: 'a', type: 'transform', code: 'return 1;' },
        {
          id: 'b',
          type: 'transform',
          when: '{{ nodes.a.output > 0 }}',
          code: 'return 2;',
        },
      ),
    );
    expect(edges).toEqual([
      { id: 'a->b', source: 'a', target: 'b', kind: 'control' },
    ]);
  });

  it('draws the ordering edge an `elseOf` implies', () => {
    const edges = deriveEdges(
      nodes(
        { id: 'a', type: 'transform', when: '{{ true }}', code: 'return 1;' },
        { id: 'b', type: 'transform', elseOf: 'a', code: 'return 2;' },
      ),
    );
    expect(edges).toEqual([
      { id: 'a->b', source: 'a', target: 'b', kind: 'control' },
    ]);
  });

  it('ignores a reference to a node the document does not contain', () => {
    const edges = deriveEdges(
      nodes({
        id: 'b',
        type: 'transform',
        input: { value: '{{ nodes.missing.output }}' },
        code: 'return input.value;',
      }),
    );
    expect(edges).toEqual([]);
  });

  it('ignores a node referencing itself', () => {
    const edges = deriveEdges(
      nodes({
        id: 'a',
        type: 'transform',
        repeatUntil: '{{ nodes.a.output.done }}',
        code: 'return {done: true};',
      }),
    );
    expect(edges).toEqual([]);
  });

  it('derives the engine worked example the same way the executor orders it', () => {
    const edges = deriveEdges(DOC_EXAMPLE.automation.nodes);
    // `summary` names `calc` in BOTH its `when` and its prompt. A source that
    // is referenced for data anywhere propagates skipping, so the edge is a
    // data edge — the classification is per SOURCE, not per field.
    expect(edges).toEqual([
      {
        id: 'calc->summary',
        source: 'calc',
        target: 'summary',
        kind: 'data',
      },
      {
        id: 'summary->summary_empty',
        source: 'summary',
        target: 'summary_empty',
        kind: 'control',
      },
    ]);
  });
});

describe('orderedNodes', () => {
  it('returns execution order, not document order', () => {
    const { nodes: sorted, hasCycle } = orderedNodes(
      nodes(
        {
          id: 'b',
          type: 'transform',
          input: { v: '{{ nodes.a.output }}' },
          code: 'return input.v;',
        },
        { id: 'a', type: 'transform', code: 'return 1;' },
      ),
    );
    expect(hasCycle).toBe(false);
    expect(sorted.map((node) => node.id)).toEqual(['a', 'b']);
  });

  it('falls back to document order and reports a cycle', () => {
    const { nodes: sorted, hasCycle } = orderedNodes(
      nodes(
        {
          id: 'a',
          type: 'transform',
          input: { v: '{{ nodes.b.output }}' },
          code: 'return input.v;',
        },
        {
          id: 'b',
          type: 'transform',
          input: { v: '{{ nodes.a.output }}' },
          code: 'return input.v;',
        },
      ),
    );
    expect(hasCycle).toBe(true);
    expect(sorted.map((node) => node.id)).toEqual(['a', 'b']);
  });
});

describe('rankNodes', () => {
  it('places a node one level below the deepest node it reads', () => {
    const defs = nodes(
      { id: 'a', type: 'transform', code: 'return 1;' },
      {
        id: 'b',
        type: 'transform',
        input: { v: '{{ nodes.a.output }}' },
        code: 'return input.v;',
      },
      {
        id: 'c',
        type: 'transform',
        input: { v: '{{ nodes.b.output }}', w: '{{ nodes.a.output }}' },
        code: 'return input.v;',
      },
    );
    const ranks = rankNodes(defs, deriveEdges(defs));
    expect([...ranks]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });
});

describe('controlFlowBadges', () => {
  it('renders one badge per declared control-flow field', () => {
    expect(
      controlFlowBadges({
        id: 'a',
        type: 'transform',
        when: '{{ x }}',
        forEach: '{{ items }}',
        repeatUntil: '{{ done }}',
        maxRepeats: 3,
        onError: 'continue',
        code: 'return 1;',
      }),
    ).toEqual([
      { kind: 'when', value: '{{ x }}' },
      { kind: 'forEach', value: '{{ items }}' },
      { kind: 'repeatUntil', value: '{{ done }}', maxRepeats: 3 },
      { kind: 'onError', value: 'continue' },
    ]);
  });

  it('says nothing about the default error policy', () => {
    expect(
      controlFlowBadges({
        id: 'a',
        type: 'transform',
        onError: 'fail',
        code: 'return 1;',
      }),
    ).toEqual([]);
  });
});

describe('buildGraph', () => {
  it('reads an absent document as an empty graph', () => {
    expect(buildGraph(null)).toEqual({
      nodes: [],
      edges: [],
      ranks: new Map(),
      hasCycle: false,
    });
  });
});

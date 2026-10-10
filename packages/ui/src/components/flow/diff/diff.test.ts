import { describe, expect, it } from 'vitest';

import { triageFlowGraph } from '../testing/flow-fixtures';
import type {
  FlowEdge,
  FlowEdgeKind,
  FlowGraph,
  FlowGroup,
  FlowNode,
} from '../types';
import { flowGraphProblems } from '../validate-graph';
import {
  diffHighlight,
  flowBeforeEdgeId,
  mergeFlowGraphs,
  type FlowNodeDiff,
} from './diff';

const start: FlowNode = {
  id: '__start',
  kind: 'entry',
  triggers: [],
  inputs: [],
};
const end: FlowNode = { id: '__end', kind: 'exit', outputs: [] };
const step = (id: string): FlowNode => ({ id, kind: 'step', label: id });
const gate = (
  id: string,
  mode: 'only-if' | 'if-else' = 'if-else',
): FlowNode => ({
  id,
  kind: 'gate',
  label: id,
  mode,
  condition: `${id} holds`,
});
const edge = (
  source: string,
  target: string,
  kind: FlowEdgeKind,
): FlowEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind,
});

/** A straight line of steps from Start to End. */
function line(ids: readonly string[]): FlowGraph {
  const order = ['__start', ...ids, '__end'];
  return {
    nodes: [start, ...ids.map(step), end],
    edges: order
      .slice(1)
      .map((id, index) =>
        edge(
          order[index] ?? '',
          id,
          index === 0 ? 'entry' : id === '__end' ? 'exit' : 'data',
        ),
      ),
  };
}

const nothingTold = (): FlowNodeDiff | undefined => undefined;
const ids = (graph: FlowGraph) => graph.nodes.map((node) => node.id);

describe('mergeFlowGraphs', () => {
  it('answers the newer graph and no marks when nothing changed', () => {
    const graph = line(['a', 'b']);
    const merged = mergeFlowGraphs(graph, line(['a', 'b']), nothingTold);
    expect(ids(merged.graph)).toEqual(ids(graph));
    expect(merged.diff).toEqual({ nodes: {}, edges: {} });
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('keeps a removed node where it stood and marks what came and went', () => {
    const merged = mergeFlowGraphs(
      line(['a', 'b', 'c']),
      line(['a', 'c', 'd']),
      nothingTold,
    );
    expect(ids(merged.graph)).toEqual(['__start', 'a', 'b', 'c', 'd', '__end']);
    expect(merged.diff.nodes).toEqual({
      b: { kind: 'removed' },
      d: { kind: 'added' },
    });
    expect(merged.diff.edges).toEqual({
      'a>c': 'added',
      'c>d': 'added',
      'd>__end': 'added',
      'a>b': 'removed',
      'b>c': 'removed',
      'c>__end': 'removed',
    });
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('takes the host’s words for what changed in a node both versions have', () => {
    const merged = mergeFlowGraphs(line(['a', 'b']), line(['a', 'b']), (id) =>
      id === 'b'
        ? { kind: 'changed', summary: 'Prompt and model changed' }
        : undefined,
    );
    expect(merged.diff.nodes).toEqual({
      b: { kind: 'changed', summary: 'Prompt and model changed' },
    });
  });

  it('keeps a branch only the older version had, its condition and both its ways', () => {
    const before: FlowGraph = {
      nodes: [start, step('a'), gate('__gate:u'), step('u'), step('n'), end],
      edges: [
        edge('__start', 'a', 'entry'),
        edge('a', '__gate:u', 'order'),
        edge('__gate:u', 'u', 'branch-yes'),
        edge('__gate:u', 'n', 'branch-no'),
        edge('a', 'u', 'data'),
        edge('a', 'n', 'data'),
        edge('u', '__end', 'completion'),
        edge('n', '__end', 'completion'),
      ],
    };
    const after: FlowGraph = {
      nodes: [start, step('a'), step('u'), end],
      edges: [
        edge('__start', 'a', 'entry'),
        edge('a', 'u', 'data'),
        edge('u', '__end', 'completion'),
      ],
    };
    const merged = mergeFlowGraphs(before, after, nothingTold);
    // Each removed node stands right after the node it followed.
    expect(ids(merged.graph)).toEqual([
      '__start',
      'a',
      '__gate:u',
      'u',
      'n',
      '__end',
    ]);
    expect(merged.diff.nodes).toEqual({
      '__gate:u': { kind: 'removed' },
      n: { kind: 'removed' },
    });
    expect(merged.diff.edges).toEqual({
      'a>__gate:u': 'removed',
      '__gate:u>u': 'removed',
      '__gate:u>n': 'removed',
      'a>n': 'removed',
      'n>__end': 'removed',
    });
    // The removed condition still has its Yes and its No.
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('reads a line whose kind changed as one removed and one added', () => {
    const before = line(['a', 'b']);
    const after = line(['a', 'b']);
    // Only mentioned now: the same ends, another kind.
    after.edges = after.edges.map((each): FlowEdge =>
      each.id === 'a>b' ? edge('a', 'b', 'order') : each,
    );
    const merged = mergeFlowGraphs(before, after, nothingTold);
    expect(merged.diff.edges).toEqual({
      'a>b': 'added',
      [flowBeforeEdgeId('a>b')]: 'removed',
    });
    const both = merged.graph.edges.filter(
      (each) => each.source === 'a' && each.target === 'b',
    );
    expect(both.map((each) => each.kind).sort()).toEqual(['data', 'order']);
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('marks a node that changed its kind, and a condition that changed its form', () => {
    const before: FlowGraph = {
      nodes: [start, gate('__gate:x', 'only-if'), step('x'), end],
      edges: [
        edge('__start', '__gate:x', 'entry'),
        edge('__gate:x', 'x', 'gate'),
        edge('x', '__end', 'exit'),
      ],
    };
    const after: FlowGraph = {
      nodes: [start, gate('__gate:x', 'if-else'), step('x'), step('y'), end],
      edges: [
        edge('__start', '__gate:x', 'entry'),
        edge('__gate:x', 'x', 'branch-yes'),
        edge('__gate:x', 'y', 'branch-no'),
        edge('x', '__end', 'completion'),
        edge('y', '__end', 'completion'),
      ],
    };
    const merged = mergeFlowGraphs(before, after, (id) =>
      id === '__gate:x'
        ? { kind: 'changed', summary: 'Now if/else' }
        : undefined,
    );
    expect(merged.diff.nodes['__gate:x']).toEqual({
      kind: 'changed',
      summary: 'Now if/else',
    });
    expect(merged.diff.edges).toMatchObject({
      '__gate:x>x': 'added',
      [flowBeforeEdgeId('__gate:x>x')]: 'removed',
    });
    expect(flowGraphProblems(merged.graph)).toEqual([]);
    // A node of another kind under the same id changed, said or not.
    const reshaped = mergeFlowGraphs(
      { nodes: [start, step('x'), end], edges: [] },
      {
        nodes: [start, { ...gate('x', 'only-if') }, step('z'), end],
        edges: [edge('x', 'z', 'gate')],
      },
      nothingTold,
    );
    expect(reshaped.diff.nodes.x).toEqual({ kind: 'changed' });
  });

  it('keeps no condition’s lines out of a node that is no longer a condition', () => {
    const before: FlowGraph = {
      nodes: [start, gate('x', 'only-if'), step('y'), end],
      edges: [
        edge('__start', 'x', 'entry'),
        edge('x', 'y', 'gate'),
        edge('y', '__end', 'exit'),
      ],
    };
    // The same id, now a step that reads nothing and leads to y.
    const after: FlowGraph = {
      nodes: [start, step('x'), step('y'), end],
      edges: [
        edge('__start', 'x', 'entry'),
        edge('x', 'y', 'data'),
        edge('y', '__end', 'exit'),
      ],
    };
    const merged = mergeFlowGraphs(before, after, nothingTold);
    expect(merged.diff.nodes).toEqual({ x: { kind: 'changed' } });
    expect(merged.graph.edges.map((each) => each.kind)).not.toContain('gate');
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('draws a renamed node once, its older lines as its own', () => {
    const merged = mergeFlowGraphs(
      line(['a', 'summary', 'b']),
      line(['a', 'report', 'b']),
      (id) =>
        id === 'report'
          ? { kind: 'renamed', renamedFrom: 'Summary', beforeId: 'summary' }
          : undefined,
    );
    expect(ids(merged.graph)).toEqual(['__start', 'a', 'report', 'b', '__end']);
    expect(merged.diff).toEqual({
      nodes: {
        report: {
          kind: 'renamed',
          renamedFrom: 'Summary',
          beforeId: 'summary',
        },
      },
      edges: {},
    });
  });

  it('lets the newer Start and End stand for older ones of another id', () => {
    const before: FlowGraph = {
      nodes: [{ ...start, id: 'begin' }, step('a'), { ...end, id: 'finish' }],
      edges: [edge('begin', 'a', 'entry'), edge('a', 'finish', 'exit')],
    };
    const merged = mergeFlowGraphs(before, line(['a']), nothingTold);
    expect(ids(merged.graph)).toEqual(['__start', 'a', '__end']);
    expect(merged.diff).toEqual({ nodes: {}, edges: {} });
  });

  it('leaves out a removed line that would close a loop through the newer graph', () => {
    const merged = mergeFlowGraphs(
      line(['a', 'b']),
      line(['b', 'a']),
      nothingTold,
    );
    const loops = merged.graph.edges.filter(
      (each) => each.source === 'a' && each.target === 'b',
    );
    expect(loops).toEqual([]);
    expect(merged.diff.edges['b>a']).toBe('added');
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('keeps a frame the older version had round a node that no longer repeats', () => {
    const before = triageFlowGraph();
    const after: FlowGraph = { ...triageFlowGraph(), groups: [] };
    const merged = mergeFlowGraphs(before, after, (id) =>
      id === 'score' ? { kind: 'changed', summary: 'Runs once' } : undefined,
    );
    expect(merged.graph.groups?.map((group) => group.id)).toEqual([
      'each:score',
    ]);
    expect(merged.diff.groups).toEqual({ 'each:score': 'removed' });
    // And the other way round: a frame only the newer version has.
    const added = mergeFlowGraphs(after, before, nothingTold);
    expect(added.diff.groups).toEqual({ 'each:score': 'added' });
    expect(flowGraphProblems(merged.graph)).toEqual([]);
  });

  it('leaves out an older frame the union cannot draw', () => {
    const repeat: FlowGroup = {
      id: 'repeat:score',
      kind: 'repeat',
      label: 'Repeats',
      members: ['score'],
    };
    const before: FlowGraph = { ...triageFlowGraph(), groups: [repeat] };
    // The newer frame holds the same node under another kind and id:
    // a node sits in one frame only.
    const after: FlowGraph = triageFlowGraph();
    const merged = mergeFlowGraphs(before, after, nothingTold);
    expect(merged.graph.groups?.map((group) => group.id)).toEqual([
      'each:score',
    ]);
    expect(merged.diff.groups).toBeUndefined();
  });
});

describe('diffHighlight', () => {
  const before = line(['a', 'summary', 'b', 'gone']);
  const after = line(['a', 'report', 'b', 'new']);
  const { graph, diff } = mergeFlowGraphs(before, after, (id) =>
    id === 'report'
      ? { kind: 'renamed', renamedFrom: 'Summary', beforeId: 'summary' }
      : undefined,
  );

  it('brings forward what changed on each version’s own graph, quieting nothing', () => {
    const older = diffHighlight(before, diff);
    expect([...older.nodes].sort()).toEqual(['gone', 'summary']);
    expect([...older.edges].sort()).toEqual(['b>gone', 'gone>__end']);
    expect(older.quietRest).toBe(false);
    const newer = diffHighlight(after, diff);
    expect([...newer.nodes].sort()).toEqual(['new', 'report']);
    expect([...newer.edges].sort()).toEqual(['b>new', 'new>__end']);
    const union = diffHighlight(graph, diff);
    expect([...union.nodes].sort()).toEqual(['gone', 'new', 'report']);
  });
});

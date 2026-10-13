import { beforeAll, describe, expect, it } from 'vitest';

import { layoutFlowGraph } from '../layout/layout-flow-graph';
import { branchFlowGraph, triageFlowGraph } from '../testing/flow-fixtures';
import type { FlowGraph, FlowLayout } from '../types';
import { flowNeighbour, flowTabStop } from './navigation';

describe('flowNeighbour', () => {
  let triage: { graph: FlowGraph; layout: FlowLayout };
  let branch: { graph: FlowGraph; layout: FlowLayout };

  beforeAll(async () => {
    const t = triageFlowGraph();
    const b = branchFlowGraph();
    triage = { graph: t, layout: await layoutFlowGraph(t) };
    branch = { graph: b, layout: await layoutFlowGraph(b) };
  });

  const go = (
    { graph, layout }: { graph: FlowGraph; layout: FlowLayout },
    from: string,
    key: Parameters<typeof flowNeighbour>[3],
  ) => flowNeighbour(graph, layout, from, key);

  it('follows the lines down and up', () => {
    expect(go(triage, '__start', 'down')).toBe('issues');
    expect(go(triage, 'issues', 'down')).toBe('open_issues');
    expect(go(triage, 'report', 'down')).toBe('__end');
    expect(go(triage, 'issues', 'up')).toBe('__start');
    expect(go(triage, '__start', 'up')).toBeNull();
  });

  it('down from a node with two successors takes the one in line with it', () => {
    const { layout } = triage;
    const next = go(triage, 'open_issues', 'down');
    const open = layout.nodes.open_issues!;
    const centre = open.x + open.width / 2;
    const offset = (id: string) =>
      Math.abs(layout.nodes[id]!.x + layout.nodes[id]!.width / 2 - centre);
    expect(['score', 'report']).toContain(next);
    expect(offset(next!)).toBeLessThanOrEqual(
      Math.min(offset('score'), offset('report')),
    );
  });

  it('steps along a row with left and right', () => {
    expect(go(branch, 'normal', 'right')).toBe('low');
    expect(go(branch, 'low', 'left')).toBe('normal');
    expect(go(branch, 'low', 'right')).toBeNull();
    expect(go(branch, 'urgent', 'right')).toBe('__gate:normal');
  });

  it('jumps to Start and End', () => {
    expect(go(branch, 'merge', 'first')).toBe('__start');
    expect(go(branch, 'merge', 'last')).toBe('__end');
  });

  it('never follows a layout-only edge', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 'a', kind: 'step', label: 'A' },
        { id: 'b', kind: 'step', label: 'B' },
      ],
      edges: [
        {
          id: 'a>b',
          source: 'a',
          target: 'b',
          kind: 'order',
          layoutOnly: true,
        },
      ],
    };
    const layout = {
      ...triage.layout,
      nodes: {
        a: { x: 0, y: 0, width: 10, height: 10 },
        b: { x: 0, y: 50, width: 10, height: 10 },
      },
    };
    expect(flowNeighbour(graph, layout, 'a', 'down')).toBeNull();
  });
});

describe('flowTabStop', () => {
  const graph = triageFlowGraph();

  it('is the selected node, else the one focused last, else Start', () => {
    expect(flowTabStop(graph, 'score', 'issues')).toBe('score');
    expect(flowTabStop(graph, null, 'issues')).toBe('issues');
    expect(flowTabStop(graph, null, null)).toBe('__start');
    expect(flowTabStop(graph, 'gone', 'also gone')).toBe('__start');
  });
});

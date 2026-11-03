import { describe, expect, it } from 'vitest';

import {
  branchFlowGraph,
  syntheticFlowGraph,
  triageFlowGraph,
} from './testing/flow-fixtures';
import type { FlowGraph } from './types';
import { validateFlowGraph } from './validate-graph';

const base = (): FlowGraph => triageFlowGraph();

describe('validateFlowGraph', () => {
  it('accepts every fixture', () => {
    expect(() => validateFlowGraph(base())).not.toThrow();
    expect(() => validateFlowGraph(branchFlowGraph())).not.toThrow();
    expect(() => validateFlowGraph(syntheticFlowGraph(40))).not.toThrow();
  });

  it('refuses a repeated id and an edge to nowhere', () => {
    const graph = base();
    expect(() =>
      validateFlowGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[1]!] }),
    ).toThrow(/duplicate node id "issues"/);
    expect(() =>
      validateFlowGraph({
        ...graph,
        edges: [
          ...graph.edges,
          { id: 'x', source: 'issues', target: 'ghost', kind: 'data' },
        ],
      }),
    ).toThrow(/unknown node "ghost"/);
  });

  it('refuses a second Start', () => {
    const graph = base();
    expect(() =>
      validateFlowGraph({
        ...graph,
        nodes: [
          ...graph.nodes,
          { id: 'again', kind: 'entry', triggers: [], inputs: [] },
        ],
      }),
    ).toThrow(/more than one entry node/);
  });

  it('refuses an if/else gate without both branches', () => {
    const graph = branchFlowGraph();
    expect(() =>
      validateFlowGraph({
        ...graph,
        edges: graph.edges.filter((edge) => edge.kind !== 'branch-no'),
      }),
    ).toThrow(/needs a Yes and a No edge/);
  });

  it('refuses a frame a path leaves and re-enters', () => {
    const graph = base();
    expect(() =>
      validateFlowGraph({
        ...graph,
        groups: [
          { id: 'g', kind: 'each', label: 'x', members: ['issues', 'score'] },
        ],
      }),
    ).toThrow(/not convex/);
  });

  it('refuses a frame round something other than steps', () => {
    const graph = base();
    expect(() =>
      validateFlowGraph({
        ...graph,
        groups: [{ id: 'g', kind: 'each', label: 'x', members: ['__start'] }],
      }),
    ).toThrow(/not a step/);
  });
});

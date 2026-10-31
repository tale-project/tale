import { describe, expect, it } from 'vitest';

import {
  branchFlowGraph,
  triageInboxFlowGraph,
} from '../testing/flow-fixtures';
import {
  highlightForBranch,
  highlightForIncident,
  highlightForNodes,
  highlightForPaths,
  sameFlowHighlight,
  type FlowPath,
} from './highlight';

const sorted = (set: ReadonlySet<string>) => [...set].sort();

/** The branch fixture's paths, as a host's analysis lists them. */
const BRANCH_PATHS: FlowPath[] = [
  {
    id: 'urgent',
    nodes: [
      'fetch',
      'classify',
      '__gate:urgent',
      'urgent',
      'enrich',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': true },
  },
  {
    id: 'normal',
    nodes: [
      'fetch',
      'classify',
      '__gate:urgent',
      '__gate:normal',
      'normal',
      'enrich',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': false, 'when:normal': true },
  },
  {
    id: 'low',
    nodes: [
      'fetch',
      'classify',
      '__gate:urgent',
      '__gate:normal',
      'low',
      'enrich',
      'merge',
      'notify',
      'poll',
    ],
    decisions: { 'when:urgent': false, 'when:normal': false },
  },
];

describe('highlightForPaths', () => {
  it('puts Start and End on every path and keeps only the lines a run follows', () => {
    const graph = branchFlowGraph();
    const path = BRANCH_PATHS[0];
    if (path === undefined) throw new Error('no path');
    const highlight = highlightForPaths(graph, [path]);
    expect(highlight.nodes.has('__start')).toBe(true);
    expect(highlight.nodes.has('__end')).toBe(true);
    expect(highlight.nodes.has('normal')).toBe(false);
    expect(highlight.edges.has('__gate:urgent>urgent')).toBe(true);
    // The No line leaves a gate that is on the path, to a gate that is not.
    expect(highlight.edges.has('__gate:urgent>__gate:normal')).toBe(false);
    expect(highlight.edges.has('__start>fetch')).toBe(true);
    expect(highlight.edges.has('merge>__end')).toBe(true);
  });

  it('takes a Yes or No line only on a path where the condition decided that way', () => {
    const graph = branchFlowGraph();
    // A path that lists both ends of the No line but decided Yes.
    const odd: FlowPath = {
      id: 'odd',
      nodes: ['__gate:urgent', '__gate:normal'],
      decisions: { 'when:urgent': true },
    };
    expect(
      highlightForPaths(graph, [odd]).edges.has('__gate:urgent>__gate:normal'),
    ).toBe(false);
    const low = BRANCH_PATHS[2];
    if (low === undefined) throw new Error('no path');
    const highlight = highlightForPaths(graph, [low]);
    expect(highlight.edges.has('__gate:urgent>__gate:normal')).toBe(true);
    expect(highlight.edges.has('__gate:normal>low')).toBe(true);
    expect(highlight.edges.has('__gate:normal>normal')).toBe(false);
  });

  it('joins several paths', () => {
    const highlight = highlightForPaths(branchFlowGraph(), BRANCH_PATHS);
    expect(
      ['urgent', 'normal', 'low'].every((id) => highlight.nodes.has(id)),
    ).toBe(true);
  });

  it('never holds a layout-only line', () => {
    const inbox = triageInboxFlowGraph();
    const graph = {
      ...inbox,
      edges: [
        ...inbox.edges,
        {
          id: 'hidden',
          source: 'inbox',
          target: 'due',
          kind: 'order' as const,
          layoutOnly: true,
        },
      ],
    };
    const highlight = highlightForPaths(graph, [
      { id: 'all', nodes: ['inbox', 'due'], decisions: {} },
    ]);
    expect(highlight.edges.has('hidden')).toBe(false);
    expect(highlight.edges.has('inbox>due')).toBe(true);
  });
});

describe('highlightForBranch', () => {
  it('highlights the paths through one branch of a condition', () => {
    const graph = branchFlowGraph();
    const no = highlightForBranch(graph, BRANCH_PATHS, '__gate:urgent', false);
    expect(no.nodes.has('normal')).toBe(true);
    expect(no.nodes.has('low')).toBe(true);
    expect(no.nodes.has('urgent')).toBe(false);
    const yes = highlightForBranch(graph, BRANCH_PATHS, '__gate:urgent', true);
    expect(sorted(yes.nodes)).toEqual(
      sorted(highlightForPaths(graph, [BRANCH_PATHS[0] as FlowPath]).nodes),
    );
  });

  it('highlights every path that consults the condition without a decision', () => {
    const graph = branchFlowGraph();
    const all = highlightForBranch(graph, BRANCH_PATHS, '__gate:normal');
    expect(all.nodes.has('normal')).toBe(true);
    expect(all.nodes.has('low')).toBe(true);
    expect(all.nodes.has('urgent')).toBe(false);
  });

  it('follows the branch down the lines when the host could not list the paths', () => {
    const graph = branchFlowGraph();
    const no = highlightForBranch(graph, [], '__gate:urgent', false);
    expect(no.nodes.has('__gate:urgent')).toBe(true);
    expect(no.nodes.has('__gate:normal')).toBe(true);
    expect(no.nodes.has('low')).toBe(true);
    expect(no.nodes.has('merge')).toBe(true);
    expect(no.nodes.has('urgent')).toBe(false);
    expect(no.edges.has('__gate:urgent>__gate:normal')).toBe(true);
    expect(no.edges.has('__gate:urgent>urgent')).toBe(false);
    // An only-if condition that does not hold leads nowhere.
    const inbox = triageInboxFlowGraph();
    const off = highlightForBranch(inbox, [], '__gate:triage', false);
    expect(sorted(off.nodes)).toEqual(['__gate:triage']);
    const on = highlightForBranch(inbox, [], '__gate:triage', true);
    expect(on.nodes.has('triage')).toBe(true);
    expect(on.edges.has('__gate:triage>triage')).toBe(true);
  });

  it('is empty for a gate the graph does not have', () => {
    const none = highlightForBranch(branchFlowGraph(), BRANCH_PATHS, 'nope');
    expect(none.nodes.size).toBe(0);
    expect(none.edges.size).toBe(0);
  });
});

describe('highlightForNodes and highlightForIncident', () => {
  it('rings a set of nodes in a tone, with the lines between them', () => {
    const highlight = highlightForNodes(
      branchFlowGraph(),
      ['fetch', 'classify', 'ghost'],
      {
        tone: 'error',
      },
    );
    expect(sorted(highlight.nodes)).toEqual(['classify', 'fetch']);
    expect(sorted(highlight.edges)).toEqual(['fetch>classify']);
    expect(highlight.tone).toBe('error');
  });

  it('brings a node’s own lines forward without quieting the rest', () => {
    const highlight = highlightForIncident(branchFlowGraph(), 'merge');
    expect(highlight.quietRest).toBe(false);
    expect(sorted(highlight.edges)).toEqual(
      [
        'enrich>merge',
        'low>merge',
        'merge>__end',
        'merge>notify',
        'merge>poll',
        'normal>merge',
        'urgent>merge',
      ].sort(),
    );
  });

  it('compares highlights by what they bring forward', () => {
    const graph = branchFlowGraph();
    expect(
      sameFlowHighlight(
        highlightForIncident(graph, 'merge'),
        highlightForIncident(graph, 'merge'),
      ),
    ).toBe(true);
    expect(
      sameFlowHighlight(
        highlightForIncident(graph, 'merge'),
        highlightForIncident(graph, 'fetch'),
      ),
    ).toBe(false);
    expect(sameFlowHighlight(null, undefined)).toBe(false);
    expect(sameFlowHighlight(null, null)).toBe(true);
  });
});

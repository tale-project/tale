import ELK from 'elkjs/lib/elk.bundled.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  branchFlowGraph,
  cyclicFlowGraph,
  inputGateFlowGraph,
  reviewPullRequestsFlowGraph,
  syntheticFlowGraph,
  triageFlowGraph,
  triageInboxFlowGraph,
} from '../testing/flow-fixtures';
import {
  assertLabelsClear,
  assertNoEdgeCrossesBox,
  assertRoutesAxisAligned,
  flowRowIndex,
  flowRowOrderFlips,
} from '../testing/flow-geometry';
import type { FlowEdge, FlowGraph, FlowLayout, FlowRect } from '../types';
import { validateFlowGraph } from '../validate-graph';
import { rectsOverlap, segmentCrossesRect } from './geometry';
import { FlowLayoutCache } from './layout-cache';
import {
  layoutFlowGraph,
  type FlowElk,
  type FlowElkNode,
} from './layout-flow-graph';
import { flowNodeSize } from './sizes';

/** A fresh bundled ELK, as the main thread runs it. */
function freshElk(): FlowElk {
  const elk = new ELK();
  return {
    layout: async (graph: FlowElkNode) => ({
      graph: await elk.layout(graph),
      engine: 'main',
    }),
  };
}

const FIXTURES: [string, () => FlowGraph][] = [
  ['Triage GitHub issues', triageFlowGraph],
  ['review pull requests', reviewPullRequestsFlowGraph],
  ['triage inbox', triageInboxFlowGraph],
  ['when/elseOf, else-if and repeat', branchFlowGraph],
  ['a gate on the run input', inputGateFlowGraph],
  ['40 nodes', () => syntheticFlowGraph(40)],
  ['a cycle', cyclicFlowGraph],
];

const contains = (outer: FlowRect, inner: FlowRect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('layoutFlowGraph on every fixture', () => {
  it.each(FIXTURES)(
    '%s: routes every edge round every box',
    async (_name, build) => {
      const graph = build();
      validateFlowGraph(graph);
      const layout = await layoutFlowGraph(graph);
      expect(layout.engine).toBe('main');
      for (const node of graph.nodes) {
        const rect = layout.nodes[node.id];
        expect(rect, node.id).toBeDefined();
        expect({ width: rect?.width, height: rect?.height }, node.id).toEqual(
          flowNodeSize(node),
        );
      }
      const drawn = graph.edges.filter((edge) => !edge.layoutOnly);
      expect(Object.keys(layout.edges).sort()).toEqual(
        drawn.map((edge) => edge.id).sort(),
      );
      assertRoutesAxisAligned(layout);
      assertNoEdgeCrossesBox(layout);
      assertLabelsClear(layout);
    },
  );

  it.each(FIXTURES)(
    '%s: Start alone in the first row, End alone in the last',
    async (_name, build) => {
      const layout = await layoutFlowGraph(build());
      expect(layout.rows[0]).toEqual(['__start']);
      expect(layout.rows.at(-1)).toEqual(['__end']);
    },
  );

  it.each(FIXTURES)(
    '%s: frames hold their header and members',
    async (_name, build) => {
      const graph = build();
      const layout = await layoutFlowGraph(graph);
      for (const group of graph.groups ?? []) {
        const frame = layout.groups[group.id];
        expect(frame, group.id).toBeDefined();
        if (frame === undefined) continue;
        expect(contains(frame, frame.header), `${group.id} header`).toBe(true);
        for (const member of group.members)
          expect(
            contains(frame, layout.nodes[member] as FlowRect),
            member,
          ).toBe(true);
        // The header sits above its members.
        for (const member of group.members)
          expect(frame.header.y + frame.header.height).toBeLessThanOrEqual(
            (layout.nodes[member] as FlowRect).y,
          );
      }
    },
  );

  it('lays out the same graph the same way every time, on any instance', async () => {
    for (const [, build] of FIXTURES) {
      const strip = (layout: FlowLayout) => ({ ...layout, ms: 0 });
      const first = strip(await layoutFlowGraph(build(), { elk: freshElk() }));
      const again = strip(await layoutFlowGraph(build(), { elk: freshElk() }));
      const shared = strip(await layoutFlowGraph(build()));
      expect(again).toEqual(first);
      expect(shared).toEqual(first);
    }
  });

  it('lays out 40 nodes well inside the budget', async () => {
    const layout = await layoutFlowGraph(syntheticFlowGraph(40));
    expect(layout.ms).toBeLessThan(1_500);
  });
});

describe('the pictures the canvas promises', () => {
  it('runs Open issues → Report round Score and its frame, never through them', async () => {
    const layout = await layoutFlowGraph(triageFlowGraph());
    const route = layout.edges['open_issues>report']?.points ?? [];
    expect(route.length).toBeGreaterThanOrEqual(2);
    const frame = layout.groups['each:score'] as FlowRect;
    const score = layout.nodes.score as FlowRect;
    for (let index = 0; index + 1 < route.length; index++) {
      const a = route[index]!;
      const b = route[index + 1]!;
      expect(segmentCrossesRect(a, b, score)).toBe(false);
      expect(segmentCrossesRect(a, b, frame)).toBe(false);
    }
  });

  it('puts an if/else pair in one row, Yes on the left, under its gate', async () => {
    const graph = branchFlowGraph();
    const layout = await layoutFlowGraph(graph);
    const pairs: [string, string, string][] = [
      ['__gate:urgent', 'urgent', '__gate:normal'],
      ['__gate:normal', 'normal', 'low'],
    ];
    for (const [gate, yes, no] of pairs) {
      expect(flowRowIndex(layout, yes)).toBe(flowRowIndex(layout, no));
      expect((layout.nodes[yes] as FlowRect).x).toBeLessThan(
        (layout.nodes[no] as FlowRect).x,
      );
      expect(flowRowIndex(layout, gate)).toBeLessThan(
        flowRowIndex(layout, yes),
      );
      // "Yes" and "No" are labelled.
      const out = graph.edges.filter((edge) => edge.source === gate);
      for (const edge of out)
        expect(layout.edges[edge.id]?.label).toBeDefined();
    }
  });

  it('hangs a gate on the run input right above its node', async () => {
    const layout = await layoutFlowGraph(inputGateFlowGraph());
    const gate = layout.nodes['__gate:notify'] as FlowRect;
    const node = layout.nodes.notify as FlowRect;
    expect(flowRowIndex(layout, '__gate:notify')).toBe(
      flowRowIndex(layout, 'notify') - 1,
    );
    const centre = gate.x + gate.width / 2;
    expect(centre).toBeGreaterThan(node.x);
    expect(centre).toBeLessThan(node.x + node.width);
    // The layout-only edge shapes the picture but is never drawn.
    expect(layout.edges['load>__gate:notify']).toBeUndefined();
  });

  it('lays out a cycle, its back edge still leaving at the bottom', async () => {
    const layout = await layoutFlowGraph(cyclicFlowGraph());
    const back = layout.edges['c>a']?.points ?? [];
    const c = layout.nodes.c as FlowRect;
    expect(back[0]?.y).toBe(c.y + c.height);
  });

  it('measures labels with the measure it is given', async () => {
    const measure = vi.fn((text: string) => text.length * 10);
    const labels = (edge: FlowEdge) =>
      edge.kind === 'branch-yes'
        ? 'Ja'
        : edge.kind === 'branch-no'
          ? 'Nein'
          : undefined;
    const layout = await layoutFlowGraph(branchFlowGraph(), {
      measure,
      edgeLabel: labels,
    });
    expect(layout.edges['__gate:normal>low']?.label?.width).toBe(56);
    expect(measure).toHaveBeenCalledWith('Nein', '500 12px Inter');
  });
});

/** The graph with `change` applied: nodes and edges added or taken away. */
function edit(
  graph: FlowGraph,
  change: {
    add?: FlowGraph['nodes'];
    before?: string;
    edges?: FlowEdge[];
    remove?: string;
  },
): FlowGraph {
  let nodes = [...graph.nodes];
  if (change.remove) nodes = nodes.filter((node) => node.id !== change.remove);
  if (change.add) {
    const at = nodes.findIndex(
      (node) => node.id === (change.before ?? '__end'),
    );
    nodes.splice(at, 0, ...change.add);
  }
  let edges = graph.edges.filter(
    (edge) => edge.source !== change.remove && edge.target !== change.remove,
  );
  edges = [...edges, ...(change.edges ?? [])];
  if (change.remove) {
    // A node left without anything leading to it starts from Start; one
    // left without anything after it ends at End.
    for (const node of nodes) {
      if (node.kind === 'entry' || node.kind === 'exit') continue;
      if (!edges.some((edge) => edge.target === node.id))
        edges.push({
          id: `__start>${node.id}`,
          source: '__start',
          target: node.id,
          kind: 'entry',
        });
      if (!edges.some((edge) => edge.source === node.id))
        edges.push({
          id: `${node.id}>__end`,
          source: node.id,
          target: '__end',
          kind: 'completion',
        });
    }
  }
  return { ...graph, nodes, edges };
}

const step = (id: string) => ({ id, kind: 'step' as const, label: id });
const data = (
  source: string,
  target: string,
  kind: FlowEdge['kind'] = 'data',
): FlowEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind,
});

describe('a live relayout keeps each row in order', () => {
  const EDITS: [
    string,
    () => FlowGraph,
    (graph: FlowGraph) => FlowGraph,
    string,
  ][] = [
    [
      'append a leaf',
      branchFlowGraph,
      (g) =>
        edit(g, {
          add: [step('zz')],
          edges: [data('merge', 'zz'), data('zz', '__end', 'completion')],
        }),
      'merge',
    ],
    [
      'add a side branch',
      branchFlowGraph,
      (g) =>
        edit(g, {
          add: [step('side')],
          before: 'enrich',
          edges: [
            data('classify', 'side'),
            data('side', '__end', 'completion'),
          ],
        }),
      'classify',
    ],
    [
      'add a reference',
      branchFlowGraph,
      (g) => edit(g, { edges: [data('enrich', 'poll')] }),
      'enrich',
    ],
    [
      'remove a node',
      branchFlowGraph,
      (g) => edit(g, { remove: 'enrich' }),
      'fetch',
    ],
    [
      'add a gate',
      branchFlowGraph,
      (g) =>
        edit(
          {
            ...g,
            edges: g.edges.filter((edge) => edge.id !== 'merge>notify'),
          },
          {
            add: [
              {
                id: '__gate:notify',
                kind: 'gate',
                label: 'Notify',
                mode: 'only-if',
                condition: 'a reply is due',
              },
            ],
            before: 'notify',
            edges: [
              data('merge', '__gate:notify', 'order'),
              data('__gate:notify', 'notify', 'gate'),
              data('merge', 'notify'),
            ],
          },
        ),
      'merge',
    ],
    [
      'append a leaf to 40 nodes',
      () => syntheticFlowGraph(40),
      (g) =>
        edit(g, {
          add: [step('zz')],
          edges: [data('s39', 'zz'), data('zz', '__end', 'completion')],
        }),
      's39',
    ],
    [
      'add a side branch to 40 nodes',
      () => syntheticFlowGraph(40),
      (g) =>
        edit(g, {
          add: [step('side')],
          before: 's21',
          edges: [data('s20', 'side'), data('side', '__end', 'completion')],
        }),
      's20',
    ],
    [
      'triage inbox: add a node after Due',
      triageInboxFlowGraph,
      (g) =>
        edit(g, {
          add: [step('label')],
          before: 'draft',
          edges: [data('due', 'label'), data('label', '__end', 'completion')],
        }),
      'due',
    ],
  ];

  it.each(EDITS)(
    '%s: no node swaps sides with its neighbour',
    async (_name, build, change, anchor) => {
      const base = build();
      const before = await layoutFlowGraph(base);
      const edited = change(base);
      validateFlowGraph(edited);
      const after = await layoutFlowGraph(edited, { previous: before });
      expect(flowRowOrderFlips(before, after)).toEqual([]);
      assertNoEdgeCrossesBox(after);
      assertLabelsClear(after);
      // Everything above the edit stays in its row.
      const anchorRow = flowRowIndex(before, anchor);
      for (const [index, row] of before.rows.entries()) {
        if (index >= anchorRow) break;
        for (const id of row) expect(flowRowIndex(after, id), id).toBe(index);
      }
    },
  );
});

describe('when ELK cannot lay the graph out', () => {
  const broken: FlowElk = {
    layout: () => Promise.reject(new Error('ELK fell over')),
  };

  it('stands every node in one column, nothing overlapping or crossed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [, build] of FIXTURES) {
      const graph = build();
      const layout = await layoutFlowGraph(graph, { elk: broken });
      expect(layout.engine).toBe('fallback-column');
      const rects = graph.nodes.map(
        (node) => layout.nodes[node.id] as FlowRect,
      );
      expect(rects.every(Boolean)).toBe(true);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++)
          expect(rectsOverlap(rects[i]!, rects[j]!)).toBe(false);
      assertRoutesAxisAligned(layout);
      assertNoEdgeCrossesBox(layout);
      expect(layout.rows.flat()).toEqual(graph.nodes.map((node) => node.id));
    }
    expect(warn).toHaveBeenCalledWith(
      'Flow layout failed; showing the nodes in one column',
      expect.any(Error),
    );
  });

  it('gives up on an ELK that never answers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const silent: FlowElk = { layout: () => new Promise(() => undefined) };
    const layout = await layoutFlowGraph(triageFlowGraph(), {
      elk: silent,
      timeoutMs: 20,
    });
    expect(layout.engine).toBe('fallback-column');
  });

  it('rejects a cancelled layout rather than answering it', async () => {
    const controller = new AbortController();
    const slow: FlowElk = { layout: () => new Promise(() => undefined) };
    const pending = layoutFlowGraph(triageFlowGraph(), {
      elk: slow,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('FlowLayoutCache', () => {
  const layout = (
    signature: string,
    engine: FlowLayout['engine'] = 'worker',
  ): FlowLayout => ({
    signature,
    nodes: {},
    groups: {},
    edges: {},
    bounds: { x: 0, y: 0, width: 0, height: 0 },
    rows: [],
    engine,
    ms: 0,
  });

  it('keeps the layouts used last and drops the oldest', () => {
    const cache = new FlowLayoutCache(2);
    cache.set(layout('a'));
    cache.set(layout('b'));
    expect(cache.get('a')?.signature).toBe('a');
    cache.set(layout('c'));
    expect(cache.get('b')).toBeUndefined();
    expect(cache.peek('a')?.signature).toBe('a');
    expect(cache.size).toBe(2);
  });

  it('never keeps a one-column fallback', () => {
    const cache = new FlowLayoutCache();
    cache.set(layout('a', 'fallback-column'));
    expect(cache.get('a')).toBeUndefined();
  });
});

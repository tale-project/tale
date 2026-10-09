import { readFileSync } from 'node:fs';
import path from 'node:path';

import { validateFlowGraph } from '@tale/ui/flow/types';
import type { FlowGraph, FlowStepNode } from '@tale/ui/flow/types';
import {
  reviewPullRequestsFlowGraph,
  triageFlowGraph,
  triageInboxFlowGraph,
} from '@tale/ui/testing/flow';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { mergeNodeTypes } from '../hooks/backend';
import { toFlowGraph, type FlowGraphContext } from './flow-graph';
import { END_ID, START_ID, flowGraphTarget, gateIdOf } from './flow-ids';
import { nodeCatalogView } from './node-face';

/**
 * The canvas draws what the engine runs, so the graph is held to the
 * shipped automations themselves: the same structure the `@tale/ui` flow
 * fixtures were drawn from (the layout tests prove those never route a
 * line through a box), conditions above their nodes with Yes and No, a
 * frame per iterating node, and nothing read from the document's `ui`.
 */

const REPO = path.resolve(import.meta.dirname, '../../../../../..');

function shipped(pack: string): Automation {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a shipped v1 pack; the engine's corpus test validates it
  return parse(
    readFileSync(
      path.join(
        REPO,
        'configs/platform/custom/automations',
        pack,
        'workflow.yml',
      ),
      'utf8',
    ),
  ) as Automation;
}

const CATALOG = nodeCatalogView(
  mergeNodeTypes([
    {
      type: 'github.list_issues',
      kind: 'connector',
      description: 'List issues',
      allowedFields: ['input'],
      requiredFields: [],
      outputKind: 'structured',
      connector: 'github',
      title: 'List issues',
      i18n: { de: { title: 'Issues auflisten' } },
    },
  ]),
  [{ name: 'github', displayName: 'GitHub' }],
);

function build(
  doc: Automation,
  extra: Partial<FlowGraphContext> = {},
  locale = 'en',
) {
  const result = toFlowGraph(doc, {
    t: i18n.getFixedT(locale, 'automations'),
    tSchema: i18n.getFixedT(locale, 'schemaTree'),
    locale,
    catalog: CATALOG,
    returns: { status: 'off', outputs: null },
    triggers: [{ id: 'trigger:manual', label: 'By hand, the API or MCP' }],
    flow: analyzeFlow(doc.nodes),
    ...extra,
  });
  validateFlowGraph(result.graph);
  return result;
}

/** What the layout reads of a graph: ids, kinds, lines, frames. */
function structure(graph: FlowGraph) {
  return {
    nodes: graph.nodes.map((node) => `${node.kind}:${node.id}`),
    edges: graph.edges.map(
      (edge) =>
        `${edge.source}>${edge.target}:${edge.kind}${edge.layoutOnly ? ':layout' : ''}`,
    ),
    groups: (graph.groups ?? []).map(
      (group) => `${group.kind}:${group.id}:${group.members.join(',')}`,
    ),
  };
}

const step = (graph: FlowGraph, id: string): FlowStepNode => {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (node?.kind !== 'step') throw new Error(`no step ${id}`);
  return node;
};

const doc = (...nodes: NodeDef[]): Automation => ({ name: 'test', nodes });

describe('toFlowGraph on the shipped automations', () => {
  it('draws Triage GitHub issues as the flow fixture the layout is proven on', () => {
    const { graph } = build(shipped('github/triage-issues'));
    expect(structure(graph)).toEqual(structure(triageFlowGraph()));
    expect(graph.groups?.[0]?.label).toBe(
      'For each item of issues of Open issues',
    );
    expect(step(graph, 'issues')).toMatchObject({
      label: 'Issues',
      typeLabel: 'GitHub · List issues',
      reads: [{ id: 'input', label: 'run input (owner, repo, limit)' }],
    });
    expect(step(graph, 'open_issues').reads?.map((row) => row.label)).toEqual([
      'Issues',
      'run input (limit)',
    ]);
    expect(step(graph, 'score')).toMatchObject({
      typeLabel: 'Language model · anthropic/claude-haiku-4-5',
      reads: [
        { id: 'open_issues', label: 'Open issues' },
        { id: 'item', label: 'each item' },
      ],
    });
    expect(
      graph.edges.find((edge) => edge.id === 'issues>open_issues')?.detail,
    ).toBe('Carries .issues');
  });

  it('frames each of the three nodes that walk the pull requests', () => {
    const { graph } = build(shipped('github/review-pull-requests'));
    expect(structure(graph)).toEqual(structure(reviewPullRequestsFlowGraph()));
  });

  it('puts an only-if condition above Triage and a chip on Propose', () => {
    const { graph } = build(shipped('gmail/triage-inbox'));
    expect(structure(graph)).toEqual(structure(triageInboxFlowGraph()));
    const gate = graph.nodes.find((node) => node.id === gateIdOf('triage'));
    expect(gate).toMatchObject({
      kind: 'gate',
      mode: 'only-if',
      condition: 'conversations of Inbox is not empty',
      decisionKey: 'when:triage',
    });
    expect(step(graph, 'propose').chips).toEqual([
      { id: 'onError', label: 'Continues on error', tone: 'error' },
    ]);
    // Every node below the condition may be skipped with it.
    for (const id of ['triage', 'record', 'due', 'draft', 'propose']) {
      expect(step(graph, id).conditional).toBe(true);
    }
    expect(step(graph, 'inbox').conditional).toBeUndefined();
  });

  it('reads the same in German, verb last', () => {
    const { graph } = build(shipped('gmail/triage-inbox'), {}, 'de');
    const gate = graph.nodes.find((node) => node.id === gateIdOf('triage'));
    expect(gate).toMatchObject({
      condition: 'conversations von Inbox nicht leer ist',
    });
    expect(step(graph, 'propose').chips?.[0]?.label).toBe(
      'Läuft bei Fehler weiter',
    );
  });
});

describe('toFlowGraph rules', () => {
  const pair = doc(
    { id: 'fetch', type: 'transform', code: 'return { urgent: true };' },
    {
      id: 'urgent',
      type: 'transform',
      when: '{{ nodes.fetch.output.urgent }}',
      code: 'return 1;',
    },
    { id: 'normal', type: 'transform', elseOf: 'urgent', code: 'return 2;' },
  );

  it('hangs an elseOf partner from the same condition as its No', () => {
    const { graph } = build(pair);
    const gate = graph.nodes.find((node) => node.id === gateIdOf('urgent'));
    expect(gate).toMatchObject({ mode: 'if-else' });
    expect(structure(graph).edges).toEqual([
      '__start>fetch:entry',
      'fetch>__gate:urgent:order',
      '__gate:urgent>urgent:branch-yes',
      '__gate:urgent>normal:branch-no',
      'urgent>__end:completion',
      'normal>__end:completion',
    ]);
  });

  it('reads an else-if chain left to right, one condition after the other', () => {
    const { graph } = build(
      doc(
        { id: 'fetch', type: 'transform', code: 'return {};' },
        {
          id: 'a',
          type: 'transform',
          when: '{{ nodes.fetch.output.a }}',
          code: 'return 1;',
        },
        {
          id: 'b',
          type: 'transform',
          elseOf: 'a',
          when: '{{ nodes.fetch.output.b }}',
          code: 'return 2;',
        },
        { id: 'c', type: 'transform', elseOf: 'b', code: 'return 3;' },
      ),
    );
    expect(structure(graph).edges).toEqual(
      expect.arrayContaining([
        '__gate:a>a:branch-yes',
        '__gate:a>__gate:b:branch-no',
        '__gate:b>b:branch-yes',
        '__gate:b>c:branch-no',
      ]),
    );
    expect(structure(graph).edges).not.toContain('a>b:order');
    expect(structure(graph).edges).not.toContain('b>c:order');
  });

  it('does not pair a partner that reads its node, and says nothing twice', () => {
    const { graph } = build(
      doc(
        {
          id: 'a',
          type: 'transform',
          when: '{{ input.go }}',
          code: 'return 1;',
        },
        {
          id: 'b',
          type: 'transform',
          elseOf: 'a',
          input: { x: '{{ nodes.a.output }}' },
          code: 'return input.x;',
        },
      ),
    );
    const edges = structure(graph).edges;
    expect(edges).toContain('a>b:data');
    expect(edges.filter((edge) => edge.startsWith('a>b'))).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === gateIdOf('a'))).toMatchObject(
      { mode: 'only-if', condition: 'go of the run input counts as yes' },
    );
  });

  it('hangs a condition that reads only the run input right above its node', () => {
    const { graph } = build(
      doc(
        { id: 'load', type: 'transform', code: 'return {};' },
        {
          id: 'notify',
          type: 'transform',
          when: '{{ input.notify }}',
          input: { data: '{{ nodes.load.output }}' },
          code: 'return 1;',
        },
      ),
    );
    expect(structure(graph).edges).toEqual([
      '__start>load:entry',
      'load>__gate:notify:order:layout',
      'load>notify:data',
      '__gate:notify>notify:gate',
      'notify>__end:completion',
    ]);
  });

  it('starts a condition with nothing above it from Start', () => {
    const { graph } = build(
      doc({
        id: 'only',
        type: 'transform',
        when: '{{ input.go === true }}',
        code: 'return 1;',
      }),
    );
    expect(structure(graph).edges).toEqual([
      '__start>__gate:only:entry',
      '__gate:only>only:gate',
      'only>__end:completion',
    ]);
  });

  it('draws a cycle in document order, from Start to End, with no pairing', () => {
    const result = build(
      doc(
        {
          id: 'a',
          type: 'transform',
          input: { x: '{{ nodes.b.output }}' },
          code: 'return 1;',
        },
        {
          id: 'b',
          type: 'transform',
          input: { x: '{{ nodes.a.output }}' },
          code: 'return 2;',
        },
      ),
      { flow: null },
    );
    expect(result.hasCycle).toBe(true);
    expect(result.order).toEqual(['a', 'b']);
    expect(structure(result.graph).edges).toEqual([
      '__start>a:entry',
      'b>a:data',
      'a>b:data',
      'b>__end:completion',
    ]);
  });

  it('never reads the document’s positions', () => {
    const triage = shipped('github/triage-issues');
    const stacked: Automation = {
      ...triage,
      ui: {
        positions: Object.fromEntries(
          triage.nodes.map((node) => [node.id, { x: 0, y: 0 }]),
        ),
      },
    };
    expect(build(stacked).graph).toEqual(build(triage).graph);
  });

  it('keeps the first of two nodes with one id, and draws no node without a type', () => {
    const { graph, nodeIndex } = build(
      doc(
        { id: 'a', type: 'transform', code: 'return 1;' },
        { id: 'a', type: 'llm', prompt: 'x' },
        { id: 'b', type: '' },
      ),
    );
    expect(graph.nodes.map((node) => node.id)).toEqual([START_ID, 'a', END_ID]);
    expect(nodeIndex.get('a')).toBe(0);
  });

  it('frames a repeat with its condition and cap', () => {
    const { graph } = build(
      doc({
        id: 'poll',
        type: 'transform',
        repeatUntil: '{{ output.done }}',
        maxRepeats: 3,
        code: 'return { done: true };',
      }),
    );
    expect(graph.groups).toEqual([
      {
        id: 'repeat:poll',
        kind: 'repeat',
        label:
          "Repeats until done of this pass's result counts as yes, at most 3×",
        members: ['poll'],
      },
    ]);
  });

  it('marks a node no run reaches', () => {
    const { graph } = build(
      doc({
        id: 'never',
        type: 'transform',
        when: '{{ false }}',
        code: 'return 1;',
      }),
    );
    expect(step(graph, 'never')).toMatchObject({
      conditional: true,
      unreachable: true,
    });
    // A condition of literals only is code, not words.
    expect(
      graph.nodes.find((node) => node.id === gateIdOf('never')),
    ).toMatchObject({ condition: 'false', conditionIsCode: true });
  });
});

describe('Start and End', () => {
  it('lists the inputs with their kinds, and tags the trigger wrapper', () => {
    const { graph } = build(shipped('github/triage-issues'));
    const start = graph.nodes[0];
    expect(start?.kind).toBe('entry');
    if (start?.kind !== 'entry') return;
    expect(start.inputs.map((row) => `${row.label}: ${row.detail}`)).toEqual([
      'owner: text · required',
      'repo: text · required',
      'limit: a number',
      'trigger: text · from the trigger',
      'firedAt: a number · from the trigger',
    ]);
    expect(start.description).toBe(
      'By hand, the API or MCP. Input: owner, repo, limit, trigger, and firedAt.',
    );
  });

  it('says what a run receives without an inputs schema', () => {
    const { graph } = build(doc({ id: 'a', type: 'transform', code: '' }));
    expect(graph.nodes[0]).toMatchObject({ inputsEmpty: 'Any JSON input' });
  });

  it('names the node the output is, and counts what stops a run', () => {
    const { graph } = build(shipped('github/triage-issues'));
    const end = graph.nodes.at(-1);
    expect(end).toMatchObject({
      kind: 'exit',
      outputs: [{ id: 'output', label: 'The output of Report' }],
    });
    if (end?.kind !== 'exit') return;
    expect(end.outcomes?.map((row) => `${row.label} ${row.detail}`)).toEqual([
      'Succeeded returns the output',
      'Failed when one of 4 nodes fails',
      'Stopped when someone stops it',
    ]);
  });

  it('lists output fields with where they come from and what may be empty', () => {
    const { graph } = build(shipped('gmail/triage-inbox'));
    const end = graph.nodes.at(-1);
    if (end?.kind !== 'exit') throw new Error('no End');
    expect(end.outputs.map((row) => `${row.label}: ${row.detail}`)).toEqual([
      'read: from Inbox',
      'summary: from Triage · may be empty',
      'recorded: from Record · may be empty',
      'needsReply: from Due · may be empty',
      'drafted: from Propose · may be empty',
    ]);
    expect(end.notice).toEqual({
      tone: 'info',
      text: 'Some runs return empty values',
    });
  });

  it('holds End’s shape row whenever the check may work it out, so End never grows', () => {
    const doc = shipped('github/triage-issues');
    const shapeOf = (extra: Partial<FlowGraphContext>) => {
      const end = build(doc, extra).graph.nodes.at(-1);
      if (end?.kind !== 'exit') throw new Error('no End');
      return end.shape;
    };
    // Nobody checks this document: no row.
    expect(shapeOf({})).toBeUndefined();
    // The check is running: the row waits.
    expect(
      shapeOf({ returns: { status: 'pending', outputs: null } }),
    ).toBeNull();
    // It answered with a shape, or could not tell.
    expect(
      shapeOf({
        returns: { status: 'ready', outputs: {} },
        outputShape: {
          type: 'object',
          properties: { reviewed: { type: 'number' } },
        },
      }),
    ).toEqual(expect.stringContaining('reviewed'));
    expect(shapeOf({ returns: { status: 'ready', outputs: {} } })).toEqual({
      text: 'Shape known after a run',
      code: false,
    });
    expect(shapeOf({ returns: { status: 'failed', outputs: null } })).toEqual({
      text: 'Shape known after a run',
      code: false,
    });
  });

  it('marks the outputs a pinned path leaves empty', () => {
    const { graph } = build(shipped('gmail/triage-inbox'), {
      ranOnPath: new Set(['inbox']),
    });
    const end = graph.nodes.at(-1);
    if (end?.kind !== 'exit') throw new Error('no End');
    expect(end.outputs[0]?.detail).toBe('from Inbox');
    expect(end.outputs[1]?.detail).toBe(
      'from Triage · may be empty · empty on this path',
    );
  });

  it('says when an automation returns nothing', () => {
    const { graph } = build(doc({ id: 'a', type: 'transform', code: '' }));
    expect(graph.nodes.at(-1)).toMatchObject({
      outputs: [],
      outputsEmpty: 'Nothing — this automation has no output',
    });
  });
});

describe('flowGraphTarget', () => {
  it('tells Start, End, a condition and a node apart', () => {
    expect(flowGraphTarget(START_ID)).toEqual({ kind: 'start' });
    expect(flowGraphTarget(END_ID)).toEqual({ kind: 'end' });
    expect(flowGraphTarget(gateIdOf('triage'))).toEqual({
      kind: 'gate',
      nodeId: 'triage',
    });
    expect(flowGraphTarget('triage')).toEqual({
      kind: 'node',
      nodeId: 'triage',
    });
  });
});

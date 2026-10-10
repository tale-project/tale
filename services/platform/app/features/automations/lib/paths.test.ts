import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { mergeNodeTypes } from '../hooks/backend';
import { toFlowGraph } from './flow-graph';
import { gateIdOf } from './flow-ids';
import { nodeCatalogView } from './node-face';
import { automationPaths, type PathsContext } from './paths';

/**
 * The Paths list and its highlights, from the flow analysis the browser
 * runs itself: a row per distinct successful path with the decisions that
 * make it, the nodes that end a run when they fail, and what the chart
 * brings forward for each.
 */

const REPO = path.resolve(import.meta.dirname, '../../../../../..');
const t = i18n.getFixedT('en', 'automations');

function paths(doc: Automation, extra: Partial<PathsContext> = {}) {
  const flow = analyzeFlow(doc.nodes);
  if (flow === null) throw new Error('cycle');
  const { graph } = toFlowGraph(doc, {
    t,
    tSchema: i18n.getFixedT('en', 'schemaTree'),
    locale: 'en',
    catalog: nodeCatalogView(mergeNodeTypes([])),
    returns: { status: 'off', outputs: null },
    triggers: [],
    flow,
  });
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  return {
    graph,
    paths: automationPaths(flow, graph, {
      t,
      locale: 'en',
      elseOf: (id) => byId.get(id)?.elseOf,
      ...extra,
    }),
  };
}

const inbox: Automation = parse(
  readFileSync(
    path.join(
      REPO,
      'configs/platform/custom/automations/gmail/triage-inbox/workflow.yml',
    ),
    'utf8',
  ),
) as Automation;

const doc = (...nodes: NodeDef[]): Automation => ({ name: 'test', nodes });

/** `count` independent conditions on the run input. */
function conditions(count: number): Automation {
  return doc(
    ...Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      type: 'transform',
      when: `{{ input.c${i} }}`,
      code: 'return 1;',
    })),
  );
}

describe('automationPaths', () => {
  it('lists every way Triage inbox can go, with the decisions that make it', () => {
    const { paths: result } = paths(inbox);
    expect(result.count).toBe(3);
    const [list, halts] = result.sections;
    expect(
      list?.rows.map((row) => [
        row.title,
        row.meta,
        row.clauses?.map((clause) => `${clause.label} (${clause.tone})`),
      ]),
    ).toEqual([
      [
        'Path 1',
        '6 of 6 nodes run',
        ['Triage runs (positive)', 'Propose succeeds (neutral)'],
      ],
      [
        'Path 2',
        '5 of 6 nodes run',
        ['Triage runs (positive)', 'Propose fails, the run goes on (error)'],
      ],
      ['Path 3', '1 of 6 nodes runs', ['Triage is skipped (negative)']],
    ]);
    expect(list?.footer).toBeUndefined();
    expect(halts?.title).toBe('Ends the run when it fails');
    expect(halts?.rows.map((row) => [row.title, row.pinnable])).toEqual([
      ['Inbox', false],
      ['Triage', false],
      ['Record', false],
      ['Due', false],
      ['Draft', false],
    ]);
  });

  it('says why a halting node fails once the server said', () => {
    const { paths: result } = paths(inbox, {
      halts: [{ nodeId: 'inbox', reasons: ['external', 'input-contract'] }],
    });
    expect(result.sections[1]?.rows[0]?.title).toBe(
      'Inbox fails when a service it calls fails or its input is refused',
    );
  });

  it('brings a path forward and says why each other node steps back', () => {
    const { paths: result, graph } = paths(inbox);
    const preview = result.highlightFor('path:3', false);
    expect(preview?.announcement).toBeUndefined();
    expect([...(preview?.nodes ?? [])].sort()).toEqual(
      ['__end', '__start', gateIdOf('triage'), 'inbox'].sort(),
    );
    expect(preview?.reasons).toEqual({
      triage: 'Skipped: condition false',
      record: 'Skipped: Triage is skipped',
      due: 'Skipped: Triage is skipped',
      draft: 'Skipped: Due is skipped',
      propose: 'Skipped: Draft is skipped',
    });
    // The condition's line into Triage is not on a path where it was false.
    expect(preview?.edges.has(`${gateIdOf('triage')}>triage`)).toBe(false);
    expect(preview?.edges.has('inbox>__gate:triage')).toBe(true);
    expect(graph.edges.some((edge) => edge.id === 'inbox>__gate:triage')).toBe(
      true,
    );
    expect(result.highlightFor('path:3', true)?.announcement).toBe(
      'Showing path 3: 1 of 6 nodes runs.',
    );
    expect([...(result.ranOn('path:3') ?? [])]).toEqual(['inbox']);
  });

  it('rings every halting node in red when one of them is pointed at', () => {
    const { paths: result } = paths(inbox);
    const halts = result.highlightFor('halt:due', false);
    expect(halts?.tone).toBe('error');
    expect([...(halts?.nodes ?? [])].sort()).toEqual(
      ['draft', 'due', 'inbox', 'record', 'triage'].sort(),
    );
    expect(result.haltNode('halt:due')).toBe('due');
    expect(result.haltNode('path:1')).toBeNull();
  });

  it('says every run takes one path instead of listing it', () => {
    const { paths: result } = paths(
      doc(
        { id: 'a', type: 'transform', code: 'return 1;' },
        {
          id: 'b',
          type: 'transform',
          input: { x: '{{ nodes.a.output }}' },
          code: 'return 1;',
        },
      ),
    );
    expect(result.sections[0]?.rows).toEqual([]);
    expect(result.sections[0]?.footer).toBe(
      'Every run takes the same path: all 2 nodes run.',
    );
  });

  it('lists 32 paths and counts the rest', () => {
    const { paths: result } = paths(conditions(6));
    expect(result.count).toBe(64);
    expect(result.sections[0]?.rows).toHaveLength(32);
    expect(result.sections[0]?.footer).toBe("32 more paths aren't listed");
    expect(result.flowPaths).toHaveLength(64);
  });

  it('lists no path when there are too many conditions', () => {
    const { paths: result } = paths(conditions(13));
    expect(result.truncated).toBe(true);
    expect(result.sections[0]?.rows).toEqual([]);
    expect(result.sections[0]?.footer).toBe(
      'This automation has 13 conditions, too many to list every path. Each node still says when it runs.',
    );
  });

  it('says an else partner was skipped because its node ran', () => {
    const { paths: result } = paths(
      doc(
        {
          id: 'urgent',
          type: 'transform',
          when: '{{ input.urgent }}',
          code: 'return 1;',
        },
        { id: 'normal', type: 'transform', elseOf: 'urgent', code: '' },
      ),
    );
    const yes = result.flowPaths.find(
      (candidate) => candidate.decisions['when:urgent'],
    );
    expect(yes?.nodes).toEqual(['urgent', gateIdOf('urgent')]);
    expect(result.highlightFor(yes?.id ?? '', false)?.reasons).toEqual({
      normal: 'Skipped: Urgent runs',
    });
  });
});

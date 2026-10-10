import { describe, expect, it } from 'vitest';

import { flowCompareFromOverlays } from './compare/compare';
import {
  describeFlowGraph,
  flowListFormat,
  type FlowTranslate,
} from './describe';
import { flowStateFromOverlay } from './playback/derive-state';
import {
  branchFlowGraph,
  branchRunOverlay,
  branchRunOverlayB,
  triageFlowGraph,
} from './testing/flow-fixtures';

/** Echoes the key and its values, so the test reads what was asked for. */
const t: FlowTranslate = (key, options) =>
  options === undefined
    ? key
    : `${key}(${Object.entries(options)
        .filter(([name]) => name !== 'ns')
        .map(([name, value]) => `${name}=${String(value)}`)
        .join(', ')})`;

const words = (
  graph = triageFlowGraph(),
  issues?: Map<string, { errors: number; warnings: number }>,
) =>
  describeFlowGraph(graph, {
    t,
    tIssues: t,
    list: flowListFormat('en'),
    issues,
  });

describe('describeFlowGraph', () => {
  it('names steps by title, Start and End by their words, gates by condition', () => {
    const triage = words();
    expect(triage.names.get('issues')).toBe('Issues');
    expect(triage.names.get('__start')).toBe('node.entry');
    expect(triage.names.get('__end')).toBe('node.exit');
    const branch = words(branchFlowGraph());
    expect(branch.names.get('__gate:urgent')).toBe(
      'gate.name(node=Urgent, condition=urgent of Classify is true)',
    );
  });

  it('adds the problems to the name', () => {
    const named = words(
      triageFlowGraph(),
      new Map([['score', { errors: 2, warnings: 0 }]]),
    );
    expect(named.names.get('score')).toMatch(/^Score nodeSummary/);
  });

  it('says where a step sits, where it comes from and leads, and what it reads', () => {
    expect(words().descriptions.get('report')).toBe(
      [
        'node.position(index=5, count=6)',
        'relation.comesFrom(list=Open issues and Score)',
        'relation.leadsTo(list=node.exit)',
        'list.reads(list=Open issues and Score)',
      ].join('. ') + '.',
    );
  });

  it('folds a gate into what its targets say', () => {
    const branch = words(branchFlowGraph());
    expect(branch.descriptions.get('urgent')).toContain(
      'relation.onlyIf(condition=urgent of Classify is true)',
    );
    expect(branch.descriptions.get('low')).toContain(
      'relation.otherwise(node=Normal)',
    );
    // An else-if: No leads on to the next condition, named for its node.
    expect(branch.descriptions.get('__gate:urgent')).toContain(
      'gate.branches(yes=Urgent, no=Normal)',
    );
  });

  it('puts what a step reads on its strip, and where Start and End lead', () => {
    const triage = words();
    expect(triage.strips.get('open_issues')).toBe(
      'list.reads(list=Issues and run input (limit))',
    );
    expect(triage.strips.get('__start')).toBe('relation.leadsTo(list=Issues)');
    expect(triage.strips.get('__end')).toBe('relation.comesFrom(list=Report)');
  });

  it('spells out Start and End when the host gives no description', () => {
    const start = words().descriptions.get('__start') ?? '';
    expect(start).toContain('node.section(heading=node.triggers');
    expect(start).toContain(
      'rowWithDetail(label=Every day at 07:00 · UTC, detail=Next Thu 9 Oct, 07:00)',
    );
    expect(start).toContain('label=firedAt');
  });

  it('says why a node went as it did, in its description, its List lines and its tooltip', () => {
    const graph = branchFlowGraph();
    const overlay = branchRunOverlay();
    const run = flowStateFromOverlay(graph, {
      ...overlay,
      nodes: {
        ...overlay.nodes,
        urgent: {
          state: 'skipped',
          reason: 'Skipped: the condition is false',
          explanation: 'urgent of Classify (false) is not true',
        },
        '__gate:urgent': {
          state: 'succeeded',
          decision: false,
          explanation: 'Decided No: urgent of Classify (false) is not true',
        },
      },
    });
    const said = describeFlowGraph(graph, {
      t,
      tIssues: t,
      list: flowListFormat('en'),
      run,
    });
    expect(said.descriptions.get('urgent')).toMatch(
      /^node\.position\(index=5, count=13\)\. Skipped: the condition is false\. urgent of Classify \(false\) is not true\./,
    );
    expect(said.lines.get('urgent')?.slice(0, 2)).toEqual([
      'Skipped: the condition is false',
      'urgent of Classify (false) is not true',
    ]);
    expect(said.explanations.get('urgent')).toEqual([
      'urgent of Classify (false) is not true',
    ]);
    // A condition's decision folds into the node it guards in the List view.
    expect(said.lines.get('urgent')).toContain(
      'Decided No: urgent of Classify (false) is not true',
    );
    expect(said.descriptions.get('__gate:urgent')).toContain(
      'Decided No: urgent of Classify (false) is not true',
    );
    expect(said.explanations.has('fetch')).toBe(false);
  });

  it('says how a node went in each of two runs compared, and where they differ', () => {
    const graph = branchFlowGraph();
    const said = describeFlowGraph(graph, {
      t,
      tIssues: t,
      list: flowListFormat('en'),
      compare: flowCompareFromOverlays(
        graph,
        branchRunOverlay(),
        branchRunOverlayB(),
        { absent: { b: ['low'] } },
      ),
    });
    expect(said.names.get('notify')).toBe(
      'node.rowWithDetail(label=Notify, detail=compare.differs)',
    );
    expect(said.names.get('fetch')).toBe('Fetch');
    expect(said.names.get('low')).toBe(
      'node.rowWithDetail(label=Low, detail=compare.absent(label=compare.b))',
    );
    expect(said.lines.get('notify')?.slice(0, 2)).toEqual([
      'compare.side(label=compare.a, state=The mail server refused the message)',
      'compare.side(label=compare.b, state=state.succeeded · 300 ms)',
    ]);
    expect(said.strips.get('fetch')).toBe(
      'compare.side(label=compare.a, state=state.succeeded · 390 ms) · compare.side(label=compare.b, state=state.succeeded · 410 ms)',
    );
    expect(said.explanations.get('__gate:urgent')).toEqual([
      'compare.side(label=compare.b, state=urgent of Classify (true) is true, so Urgent ran)',
    ]);
  });
});

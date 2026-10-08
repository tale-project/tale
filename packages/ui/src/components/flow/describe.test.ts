import { describe, expect, it } from 'vitest';

import {
  describeFlowGraph,
  flowListFormat,
  type FlowTranslate,
} from './describe';
import { branchFlowGraph, triageFlowGraph } from './testing/flow-fixtures';

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
});

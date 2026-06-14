import { describe, expect, it } from 'vitest';

import {
  buildOrgChart,
  chainOfCommand,
  ORG_CHART_MAX_DEPTH,
  type OrgChartEntry,
} from './org_chart_graph';

describe('buildOrgChart', () => {
  it('builds a delegation tree with sorted direct reports', () => {
    const chart = buildOrgChart([
      { slug: 'ceo', delegates: ['researcher', 'coder'] },
      { slug: 'researcher' },
      { slug: 'coder', delegates: ['tester'] },
      { slug: 'tester' },
    ]);

    expect(chart.warnings).toEqual([]);
    expect(chart.parents.get('coder')).toBe('ceo');
    expect(chart.reports.get('ceo')).toEqual(['coder', 'researcher']);
    expect(chart.reports.get('coder')).toEqual(['tester']);
    expect(chart.parentsAll.get('tester')).toEqual(['coder']);
  });

  it('supports many-to-many: one agent delegated to by several parents', () => {
    const chart = buildOrgChart([
      { slug: 'alpha', delegates: ['shared'] },
      { slug: 'beta', delegates: ['shared'] },
      { slug: 'shared' },
    ]);

    expect(chart.warnings).toEqual([]);
    expect(chart.parentsAll.get('shared')).toEqual(['alpha', 'beta']);
    // Primary parent is the lexicographically smallest (deterministic).
    expect(chart.parents.get('shared')).toBe('alpha');
    expect(chart.reports.get('alpha')).toEqual(['shared']);
    expect(chart.reports.get('beta')).toEqual(['shared']);
  });

  it('keeps multi-root forests rootless in the parents map', () => {
    const chart = buildOrgChart([
      { slug: 'a', delegates: ['a1'] },
      { slug: 'b', delegates: ['b1'] },
      { slug: 'a1' },
      { slug: 'b1' },
    ]);

    expect(chart.parents.has('a')).toBe(false);
    expect(chart.parents.has('b')).toBe(false);
    expect(chart.reports.get('a')).toEqual(['a1']);
  });

  it('drops dangling delegate targets with a warning on the offender', () => {
    const chart = buildOrgChart([{ slug: 'boss', delegates: ['ghost'] }]);

    expect(chart.reports.has('boss')).toBe(false);
    expect(chart.warnings).toEqual([
      { type: 'dangling', slug: 'boss', manager: 'ghost' },
    ]);
  });

  it('drops a self-edge with a warning', () => {
    const chart = buildOrgChart([{ slug: 'loop', delegates: ['loop'] }]);

    expect(chart.reports.has('loop')).toBe(false);
    expect(chart.warnings).toEqual([{ type: 'self_edge', slug: 'loop' }]);
  });

  it('ALLOWS cycles (no limitation beyond self-edges)', () => {
    const chart = buildOrgChart([
      { slug: 'alpha', delegates: ['beta'] },
      { slug: 'beta', delegates: ['alpha'] },
    ]);

    // Both edges are kept; neither is broken.
    expect(chart.warnings).toEqual([]);
    expect(chart.reports.get('alpha')).toEqual(['beta']);
    expect(chart.reports.get('beta')).toEqual(['alpha']);
    expect(chart.parents.get('alpha')).toBe('beta');
    expect(chart.parents.get('beta')).toBe('alpha');
  });

  it('dedupes a delegate listed twice', () => {
    const chart = buildOrgChart([
      { slug: 'mgr', delegates: ['worker', 'worker'] },
      { slug: 'worker' },
    ]);

    expect(chart.reports.get('mgr')).toEqual(['worker']);
  });
});

describe('chainOfCommand', () => {
  it('returns primary managers nearest-first up to the root', () => {
    const { parents } = buildOrgChart([
      { slug: 'ceo', delegates: ['manager'] },
      { slug: 'manager', delegates: ['worker'] },
      { slug: 'worker' },
    ]);

    expect(chainOfCommand(parents, 'worker')).toEqual(['manager', 'ceo']);
    expect(chainOfCommand(parents, 'ceo')).toEqual([]);
  });

  it('caps depth', () => {
    // Deep delegation chain n0 → n1 → … so each n{i+1}'s parent is n{i}.
    const entries: OrgChartEntry[] = [];
    for (let i = 0; i <= ORG_CHART_MAX_DEPTH + 5; i++) {
      entries.push(
        i < ORG_CHART_MAX_DEPTH + 5
          ? { slug: `n${i}`, delegates: [`n${i + 1}`] }
          : { slug: `n${i}` },
      );
    }
    const { parents } = buildOrgChart(entries);

    const chain = chainOfCommand(parents, `n${ORG_CHART_MAX_DEPTH + 5}`);
    expect(chain.length).toBe(ORG_CHART_MAX_DEPTH);
  });

  it('survives a cyclic raw map (defensive guard)', () => {
    const raw = new Map<string, string>([
      ['a', 'b'],
      ['b', 'a'],
    ]);

    expect(chainOfCommand(raw, 'a')).toEqual(['b']);
  });
});

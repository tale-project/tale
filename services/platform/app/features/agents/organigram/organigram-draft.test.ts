import { describe, expect, it } from 'vitest';

import type { OrgChartNode } from '@/convex/agents/org_chart_actions';

import {
  applyDraft,
  buildReportsMap,
  changedReportSlugs,
  recomputeDerived,
  reportsEqual,
  setDelegatesInDraft,
  setParentsInDraft,
  type ReportsMap,
} from './organigram-draft';

/** Minimal OrgChartNode for graph-logic tests. */
function node(slug: string, directReports: string[] = []): OrgChartNode {
  return {
    slug,
    directReports,
    parentSlugs: [],
    budgetPaused: false,
    running: 0,
    hasWarning: false,
  };
}

describe('buildReportsMap', () => {
  it('keys by slug with deduped+sorted outgoing edges', () => {
    const map = buildReportsMap([node('a', ['c', 'b', 'b']), node('b')]);
    expect(map).toEqual({ a: ['b', 'c'], b: [] });
  });
});

describe('applyDraft', () => {
  it('overrides directReports from the draft, normalizing order', () => {
    const nodes = [node('a', ['x']), node('b', ['y'])];
    const out = applyDraft(nodes, { a: ['z', 'm'] });
    expect(out.find((n) => n.slug === 'a')?.directReports).toEqual(['m', 'z']);
    // b is absent from the draft → falls back to its own (normalized) edges
    expect(out.find((n) => n.slug === 'b')?.directReports).toEqual(['y']);
  });
});

describe('reportsEqual', () => {
  it('is order-insensitive and dedupes', () => {
    expect(reportsEqual({ a: ['x', 'y'] }, { a: ['y', 'x', 'x'] })).toBe(true);
  });
  it('detects added/removed members and key-count differences', () => {
    expect(reportsEqual({ a: ['x'] }, { a: ['x', 'y'] })).toBe(false);
    expect(reportsEqual({ a: [] }, { a: [], b: [] })).toBe(false);
  });
});

describe('setDelegatesInDraft', () => {
  it('replaces one agent’s outgoing edges (deduped+sorted), leaving others', () => {
    const draft: ReportsMap = { a: ['x'], b: ['y'] };
    const next = setDelegatesInDraft(draft, 'a', ['z', 'z', 'm']);
    expect(next.a).toEqual(['m', 'z']);
    expect(next.b).toEqual(['y']);
    expect(draft.a).toEqual(['x']); // input not mutated
  });
});

describe('setParentsInDraft', () => {
  const draft: ReportsMap = { manager: [], lead: [], worker: [] };

  it('adds the agent to a newly-selected parent’s reports', () => {
    const next = setParentsInDraft(draft, 'worker', ['manager']);
    expect(next.manager).toEqual(['worker']);
    expect(next.lead).toEqual([]);
  });

  it('removes the agent from a deselected parent', () => {
    const seeded: ReportsMap = { manager: ['worker'], lead: ['worker'] };
    const next = setParentsInDraft(seeded, 'worker', ['manager']);
    expect(next.manager).toEqual(['worker']);
    expect(next.lead).toEqual([]);
  });

  it('never edits the agent’s own outgoing edges', () => {
    const seeded: ReportsMap = { manager: [], worker: ['someone'] };
    const next = setParentsInDraft(seeded, 'worker', ['manager']);
    expect(next.worker).toEqual(['someone']);
  });

  it('is a no-op when membership already matches', () => {
    const seeded: ReportsMap = { manager: ['worker'] };
    const next = setParentsInDraft(seeded, 'worker', ['manager']);
    expect(next.manager).toEqual(['worker']);
  });
});

describe('changedReportSlugs', () => {
  it('returns only slugs whose set changed (order-insensitive)', () => {
    const base: ReportsMap = { a: ['x', 'y'], b: ['z'], c: [] };
    const draft: ReportsMap = { a: ['y', 'x'], b: ['z', 'w'], c: ['new'] };
    expect(changedReportSlugs(draft, base).sort()).toEqual(['b', 'c']);
  });
});

describe('recomputeDerived', () => {
  it('derives parentSlugs + primary managerSlug from directReports', () => {
    const out = recomputeDerived([
      node('m1', ['w']),
      node('m2', ['w']),
      node('w'),
    ]);
    const w = out.find((n) => n.slug === 'w');
    expect(w?.parentSlugs).toEqual(['m1', 'm2']);
    expect(w?.managerSlug).toBe('m1'); // sorted-first = deterministic primary
  });

  it('ignores self-edges when deriving parents', () => {
    const out = recomputeDerived([node('a', ['a', 'b']), node('b')]);
    // a's only inbound edge is its own self-edge → skipped, no parents.
    expect(out.find((n) => n.slug === 'a')?.parentSlugs).toEqual([]);
    expect(out.find((n) => n.slug === 'b')?.parentSlugs).toEqual(['a']);
  });
});

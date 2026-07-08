import { describe, expect, it } from 'vitest';

import {
  computeGraphFingerprint,
  computeSpecHash,
  computeSpecSyncStatus,
  reconcileSpecificationMeta,
} from './specification_fingerprint';

const step = (slug: string, next: Record<string, string> = {}) => ({
  stepSlug: slug,
  name: slug,
  stepType: 'action' as const,
  config: {},
  nextSteps: next,
});

describe('computeGraphFingerprint', () => {
  it('is stable for the same graph reordered', () => {
    const a = { steps: [step('a'), step('b')] };
    const b = { steps: [step('b'), step('a')] };
    expect(computeGraphFingerprint(a)).toBe(computeGraphFingerprint(b));
  });

  it('changes when a step config changes', () => {
    const a = { steps: [{ ...step('a'), config: { x: 1 } }] };
    const b = { steps: [{ ...step('a'), config: { x: 2 } }] };
    expect(computeGraphFingerprint(a)).not.toBe(computeGraphFingerprint(b));
  });

  it('ignores fields outside steps/triggers (e.g. metadata)', () => {
    const a = { steps: [step('a')], metadata: { labels: ['A'] } } as never;
    const b = { steps: [step('a')], metadata: { labels: ['B'] } } as never;
    expect(computeGraphFingerprint(a)).toBe(computeGraphFingerprint(b));
  });

  it('changes when triggers change', () => {
    const a = { steps: [step('a')], triggers: { events: [] } };
    const b = {
      steps: [step('a')],
      triggers: { events: [{ eventType: 'x' }] },
    };
    expect(computeGraphFingerprint(a)).not.toBe(computeGraphFingerprint(b));
  });
});

describe('computeSpecHash', () => {
  it('ignores surrounding whitespace', () => {
    expect(computeSpecHash('  A spec. \n')).toBe(computeSpecHash('A spec.'));
    expect(computeSpecHash('A spec.')).not.toBe(computeSpecHash('B spec.'));
  });
});

describe('computeSpecSyncStatus', () => {
  const steps = [step('a')];

  it('returns absent when there is no specification', () => {
    expect(computeSpecSyncStatus({ steps })).toBe('absent');
    expect(computeSpecSyncStatus({ steps, specification: '   ' })).toBe(
      'absent',
    );
  });

  it('returns synced for an author-shipped spec with no meta (fresh install)', () => {
    // A template's hand-authored spec/graph pair carries no meta — it is
    // trusted as consistent, so a freshly installed automation never shows a
    // sync banner.
    expect(
      computeSpecSyncStatus({ steps, specification: 'Hand-written.' }),
    ).toBe('synced');
  });

  it('returns synced when both recorded hashes match the current config', () => {
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'A spec.',
        specificationMeta: {
          sourceHash: computeGraphFingerprint({ steps }),
          specHash: computeSpecHash('A spec.'),
          generatedAt: 1,
          direction: 'graph_to_spec',
        },
      }),
    ).toBe('synced');
  });

  it('returns spec_stale when the graph changed since the last sync', () => {
    const staleHash = computeGraphFingerprint({ steps: [step('old')] });
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'A spec.',
        specificationMeta: {
          sourceHash: staleHash,
          specHash: computeSpecHash('A spec.'),
          generatedAt: 1,
          direction: 'spec_to_graph',
        },
      }),
    ).toBe('spec_stale');
  });

  it('returns graph_stale when the spec changed since the last sync', () => {
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'An EDITED spec.',
        specificationMeta: {
          sourceHash: computeGraphFingerprint({ steps }),
          specHash: computeSpecHash('The original spec.'),
          generatedAt: 1,
          direction: 'graph_to_spec',
        },
      }),
    ).toBe('graph_stale');
  });

  it('graph_stale wins when both sides moved (an edited spec states intent)', () => {
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'An EDITED spec.',
        specificationMeta: {
          sourceHash: computeGraphFingerprint({ steps: [step('old')] }),
          specHash: computeSpecHash('The original spec.'),
          generatedAt: 1,
          direction: 'graph_to_spec',
        },
      }),
    ).toBe('graph_stale');
  });

  it('falls back to the graph-side check for metas without a specHash', () => {
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'A spec.',
        specificationMeta: {
          sourceHash: computeGraphFingerprint({ steps }),
          generatedAt: 1,
          direction: 'graph_to_spec',
        },
      }),
    ).toBe('synced');
  });
});

describe('reconcileSpecificationMeta', () => {
  const steps = [step('a')];
  const stored = {
    name: 'wf',
    steps,
    specification: 'The original spec.',
  } as never as Parameters<typeof reconcileSpecificationMeta>[1];

  it('drops meta when the incoming config has no specification', () => {
    const incoming = {
      name: 'wf',
      steps,
      specificationMeta: {
        sourceHash: 'x',
        generatedAt: 1,
        direction: 'graph_to_spec',
      },
    } as never as Parameters<typeof reconcileSpecificationMeta>[1];
    expect(
      reconcileSpecificationMeta(stored, incoming, 5).specificationMeta,
    ).toBeUndefined();
  });

  it('trusts an incoming meta verbatim (a regeneration apply IS a sync)', () => {
    const meta = {
      sourceHash: computeGraphFingerprint({ steps }),
      specHash: computeSpecHash('A spec.'),
      generatedAt: 2,
      direction: 'spec_to_graph' as const,
    };
    const incoming = {
      name: 'wf',
      steps,
      specification: 'A spec.',
      specificationMeta: meta,
    } as never as Parameters<typeof reconcileSpecificationMeta>[1];
    expect(
      reconcileSpecificationMeta(stored, incoming, 5).specificationMeta,
    ).toEqual(meta);
  });

  it('carries the stored sync record forward when the incoming save has none', () => {
    const meta = {
      sourceHash: 'recorded',
      specHash: 'recorded-spec',
      generatedAt: 2,
      direction: 'graph_to_spec' as const,
    };
    const withMeta = {
      ...(stored as object),
      specificationMeta: meta,
    } as never as Parameters<typeof reconcileSpecificationMeta>[1];
    const incoming = {
      name: 'wf',
      steps,
      specification: 'An EDITED spec.',
    } as never as Parameters<typeof reconcileSpecificationMeta>[1];
    expect(
      reconcileSpecificationMeta(withMeta, incoming, 5).specificationMeta,
    ).toEqual(meta);
  });

  it('stamps an authored baseline from the stored state when a side first moves', () => {
    const incoming = {
      name: 'wf',
      steps,
      specification: 'An EDITED spec.',
    } as never as Parameters<typeof reconcileSpecificationMeta>[1];
    const result = reconcileSpecificationMeta(stored, incoming, 5);
    expect(result.specificationMeta).toEqual({
      sourceHash: computeGraphFingerprint({ steps }),
      specHash: computeSpecHash('The original spec.'),
      generatedAt: 5,
      direction: 'authored',
    });
    // …which the status reader then classifies as the moved side being ahead.
    expect(computeSpecSyncStatus(result)).toBe('graph_stale');
  });

  it('leaves an unchanged author-shipped pair unstamped (still synced)', () => {
    const incoming = {
      name: 'wf',
      steps,
      specification: 'The original spec.',
    } as never as Parameters<typeof reconcileSpecificationMeta>[1];
    const result = reconcileSpecificationMeta(stored, incoming, 5);
    expect(result.specificationMeta).toBeUndefined();
    expect(computeSpecSyncStatus(result)).toBe('synced');
  });
});

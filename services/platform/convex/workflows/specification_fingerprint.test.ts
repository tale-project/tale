import { describe, expect, it } from 'vitest';

import {
  computeGraphFingerprint,
  computeSpecSyncStatus,
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

  it('ignores fields outside steps/triggers (e.g. name, description)', () => {
    const a = { steps: [step('a')], name: 'A' } as never;
    const b = { steps: [step('a')], name: 'B' } as never;
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

describe('computeSpecSyncStatus', () => {
  const steps = [step('a')];

  it('returns absent when there is no specification', () => {
    expect(computeSpecSyncStatus({ steps })).toBe('absent');
    expect(computeSpecSyncStatus({ steps, specification: '   ' })).toBe(
      'absent',
    );
  });

  it('returns never_synced when a specification has no sync metadata', () => {
    expect(
      computeSpecSyncStatus({ steps, specification: 'Hand-written.' }),
    ).toBe('never_synced');
  });

  it('returns synced when the sourceHash matches the current graph', () => {
    const sourceHash = computeGraphFingerprint({ steps });
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'A spec.',
        specificationMeta: {
          sourceHash,
          generatedAt: 1,
          direction: 'graph_to_spec',
        },
      }),
    ).toBe('synced');
  });

  it('returns stale when the graph changed since the last sync', () => {
    const staleHash = computeGraphFingerprint({ steps: [step('old')] });
    expect(
      computeSpecSyncStatus({
        steps,
        specification: 'A spec.',
        specificationMeta: {
          sourceHash: staleHash,
          generatedAt: 1,
          direction: 'spec_to_graph',
        },
      }),
    ).toBe('stale');
  });
});

import { describe, expect, it } from 'vitest';

import type { RunDiff } from '@/app/lib/backend/contract/automations';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { compareSummary, topLevelStep } from './run-compare';

const same = {
  equal: true,
  changes: [],
  counts: {},
  total: 0,
  truncated: false,
  basis: 'none',
} as unknown as RunDiff['input'];

function diff(over: Partial<RunDiff> = {}): RunDiff {
  return {
    a: { id: 'a', version: 4, mode: 'mock', status: 'success', startedAt: 1 },
    b: { id: 'b', version: 4, mode: 'mock', status: 'success', startedAt: 2 },
    version: { same: true, changed: [], added: [], removed: [] },
    input: same,
    output: same,
    nodes: [],
    effects: { count: { a: 0, b: 0 }, onlyA: [], onlyB: [], changed: [] },
    ...over,
  };
}

const ctx = (locale: string) => ({
  t: i18n.getFixedT(locale, 'automationRuns'),
  stepLabel: (id: string) => id.charAt(0).toUpperCase() + id.slice(1),
});

describe('compareSummary', () => {
  it('says what differs, most telling first', () => {
    const lines = compareSummary(
      diff({
        b: {
          id: 'b',
          version: 6,
          mode: 'mock',
          status: 'failed',
          startedAt: 2,
        },
        version: {
          same: false,
          changed: ['score'],
          added: ['notify'],
          removed: [],
        },
        input: { ...same, equal: false, total: 2 },
        firstDivergence: { path: 'triage', why: 'decision' },
        effects: { count: { a: 3, b: 1 }, onlyA: [], onlyB: [], changed: [] },
      }),
      ctx('en'),
    );
    expect(lines).toEqual([
      'A ran v4, B ran v6: 2 steps changed between them.',
      'Input: 2 fields differ.',
      'They split at Triage: its condition went the other way.',
      'A succeeded; B failed.',
      'Writes: A made 3, B made 1.',
    ]);
  });

  it('names a condition that went the other way as why two runs split', () => {
    const lines = compareSummary(
      diff({
        nodes: [
          {
            path: 'big_order',
            nodeId: 'big_order',
            a: { status: 'skipped', activeMs: 0, attempt: 1 },
            b: { status: 'ok', activeMs: 5, attempt: 1 },
            differs: 'status',
            decisions: [
              {
                kind: 'when',
                a: { result: false },
                b: { result: true },
                operands: [],
              },
            ],
            input: same,
            output: same,
          },
        ],
        firstDivergence: { path: 'big_order', why: 'status' },
      }),
      ctx('en'),
    );
    expect(lines).toEqual([
      'They split at Big_order: its condition went the other way.',
    ]);
  });

  it('says when only the timing differs', () => {
    expect(compareSummary(diff(), ctx('en'))).toEqual([
      'Same version, same input, same path — only the timing differs.',
    ]);
    expect(compareSummary(diff(), ctx('de'))).toEqual([
      'Gleiche Version, gleiche Eingabe, gleicher Pfad – nur die Zeiten unterscheiden sich.',
    ]);
  });

  it('names the top-level step a nested split happened in', () => {
    expect(topLevelStep('enrich[0:-1]/fetch')).toBe('enrich');
    expect(topLevelStep('score')).toBe('score');
  });
});

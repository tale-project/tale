import { describe, expect, it } from 'vitest';

import { fuseByRank, RRF_K } from './fusion';

/**
 * Fusion's whole claim is that it is never the worst of the three strategies,
 * so the tests are about the cases where one leg is confidently wrong: the
 * result BOTH legs like has to beat the result either leg ranked first alone.
 *
 * Nothing here touches a corpus — fusion is a pure function of rankings.
 */

interface Row {
  readonly id: string;
}

const row = (id: string): Row => ({ id });
const identify = (item: Row): string => item.id;
const ids = (fused: readonly { item: Row }[]): string[] =>
  fused.map((entry) => entry.item.id);

describe('fusion beats either input ranking alone', () => {
  /**
   * Each case names the two legs and the answer a human would call best. The
   * expectation in every row is the same: the consensus result wins, even
   * though NEITHER leg put it first.
   */
  const cases: Array<{
    name: string;
    keyword: string[];
    dense: string[];
    /** The document a reader would pick. */
    best: string;
  }> = [
    {
      name: 'agreement at rank two beats two different rank-one guesses',
      keyword: ['kw-only', 'consensus', 'c', 'd'],
      dense: ['dense-only', 'consensus', 'e', 'f'],
      best: 'consensus',
    },
    {
      name: 'a result three ranks down in both legs still beats a single leader',
      keyword: ['kw-only', 'a', 'b', 'consensus'],
      dense: ['dense-only', 'x', 'y', 'consensus'],
      best: 'consensus',
    },
    {
      name: 'the keyword leg wins outright when the dense leg finds nothing',
      keyword: ['exact-phrase', 'b', 'c'],
      dense: [],
      best: 'exact-phrase',
    },
    {
      name: 'the dense leg wins outright when there is no keyword index',
      keyword: [],
      dense: ['paraphrase', 'b', 'c'],
      best: 'paraphrase',
    },
  ];

  it.each(cases)('$name', ({ keyword, dense, best }) => {
    const fused = fuseByRank([keyword.map(row), dense.map(row)], identify, {
      limit: 10,
    });
    expect(ids(fused)[0]).toBe(best);
  });

  it('is never worse than the better single leg on the consensus case', () => {
    // The measured claim, made concrete: fusion's top result is the one a
    // reader wants, while EACH leg on its own puts something else first.
    const keyword = ['kw-only', 'consensus', 'c'].map(row);
    const dense = ['dense-only', 'consensus', 'e'].map(row);

    const keywordAlone = fuseByRank([keyword], identify, { limit: 3 });
    const denseAlone = fuseByRank([dense], identify, { limit: 3 });
    const both = fuseByRank([keyword, dense], identify, { limit: 3 });

    expect(ids(keywordAlone)[0]).toBe('kw-only');
    expect(ids(denseAlone)[0]).toBe('dense-only');
    expect(ids(both)[0]).toBe('consensus');
  });
});

describe('scoring', () => {
  it('scores a result both legs ranked first at 1', () => {
    const fused = fuseByRank([[row('a')], [row('a')]], identify, { limit: 1 });
    expect(fused[0].score).toBeCloseTo(1, 10);
    expect(fused[0].legs).toBe(2);
  });

  it('scores a single leg the same whether or not the other leg is empty', () => {
    const alone = fuseByRank([[row('a'), row('b')]], identify, { limit: 2 });
    const withEmpty = fuseByRank([[row('a'), row('b')], []], identify, {
      limit: 2,
    });
    expect(withEmpty.map((entry) => entry.score)).toEqual(
      alone.map((entry) => entry.score),
    );
  });

  it('counts how many legs found each result', () => {
    const fused = fuseByRank(
      [
        [row('both'), row('kw')],
        [row('both'), row('dense')],
      ],
      identify,
      { limit: 3 },
    );
    const legs = new Map(fused.map((entry) => [entry.item.id, entry.legs]));
    expect(legs.get('both')).toBe(2);
    expect(legs.get('kw')).toBe(1);
    expect(legs.get('dense')).toBe(1);
  });

  it('damps the top of each list, so rank 1 and rank 2 are close together', () => {
    const fused = fuseByRank([[row('a'), row('b')]], identify, { limit: 2 });
    const gap = fused[0].score - fused[1].score;
    // With k = 60 the gap between the first two ranks is under two percent of
    // the maximum; that is what stops one leg's confident mistake from
    // outvoting the other leg's agreement.
    expect(gap).toBeLessThan(0.02);
    expect(RRF_K).toBe(60);
  });
});

describe('mechanics', () => {
  it('keeps the first leg copy of a result both legs returned', () => {
    const first = { id: 'a', from: 'keyword' };
    const second = { id: 'a', from: 'dense' };
    const fused = fuseByRank<{ id: string; from: string }>(
      [[first], [second]],
      (item) => item.id,
      { limit: 1 },
    );
    expect(fused[0].item.from).toBe('keyword');
  });

  it('orders ties deterministically', () => {
    // Same rank in the same single leg is impossible, but the same SCORE across
    // legs is not; a ranking that reshuffled between identical calls would make
    // every downstream assertion flaky.
    const once = fuseByRank([[row('b')], [row('a')]], identify, { limit: 2 });
    const twice = fuseByRank([[row('b')], [row('a')]], identify, { limit: 2 });
    expect(ids(once)).toEqual(ids(twice));
    expect(ids(once)).toEqual(['a', 'b']);
  });

  it('returns nothing for no input', () => {
    expect(fuseByRank([], identify, { limit: 10 })).toEqual([]);
    expect(fuseByRank([[], []], identify, { limit: 10 })).toEqual([]);
  });

  it('honours the limit', () => {
    const fused = fuseByRank([['a', 'b', 'c', 'd'].map(row)], identify, {
      limit: 2,
    });
    expect(ids(fused)).toEqual(['a', 'b']);
  });

  it('refuses a damping constant below one', () => {
    expect(() =>
      fuseByRank([[row('a')]], identify, { limit: 1, k: 0 }),
    ).toThrow(/at least 1/);
  });

  it('refuses a negative limit', () => {
    expect(() => fuseByRank([[row('a')]], identify, { limit: -1 })).toThrow(
      /negative/,
    );
  });
});

import { describe, expect, it } from 'vitest';

import type { Doc } from '../../_generated/dataModel';
import { computeFeedbackStats, UNATTRIBUTED_AGENT_SLUG } from '../stats';

type FeedbackRow = Doc<'messageFeedback'>;

let nextId = 1;

function row(overrides: Partial<FeedbackRow>): FeedbackRow {
  return {
    _id: `mf_${nextId++}` as FeedbackRow['_id'],
    _creationTime: 0,
    organizationId: 'org_1',
    threadId: 't_1',
    messageId: 'm_1',
    userId: 'u_1',
    rating: 'positive',
    createdAt: 1_000,
    ...overrides,
  } as FeedbackRow;
}

const NO_FILTER = {
  cutoffMs: null,
  maxScan: 1000,
};

describe('computeFeedbackStats', () => {
  it('splits positive/negative on message-only rows', () => {
    const out = computeFeedbackStats(
      [
        row({ rating: 'positive' }),
        row({ rating: 'positive' }),
        row({ rating: 'negative' }),
      ],
      NO_FILTER,
    );
    expect(out.message.byRating).toEqual({ positive: 2, negative: 1 });
    expect(out.message.total).toBe(3);
    expect(out.arena.total).toBe(0);
  });

  it('classifies arena rows by metadata.arenaVerdict presence', () => {
    const out = computeFeedbackStats(
      [
        row({ metadata: { arenaVerdict: 'a_better' } }),
        row({ metadata: { arenaVerdict: 'b_better' } }),
        row({ metadata: { arenaVerdict: 'tie' } }),
        row({ metadata: { arenaVerdict: 'both_bad' } }),
        row({ metadata: { arenaVerdict: 'a_better' } }),
        row({ rating: 'positive' }),
      ],
      NO_FILTER,
    );
    expect(out.arena.total).toBe(5);
    expect(out.arena.byVerdict.a_better).toBe(2);
    expect(out.arena.byVerdict.b_better).toBe(1);
    expect(out.arena.byVerdict.tie).toBe(1);
    expect(out.arena.byVerdict.both_bad).toBe(1);
    expect(out.message.total).toBe(1);
  });

  it('applies agentSlug post-filter', () => {
    const out = computeFeedbackStats(
      [
        row({ agentSlug: 'alpha', rating: 'positive' }),
        row({ agentSlug: 'beta', rating: 'positive' }),
        row({ agentSlug: 'alpha', rating: 'negative' }),
      ],
      { ...NO_FILTER, agentSlug: 'alpha' },
    );
    expect(out.message.total).toBe(2);
    expect(out.message.byRating.positive).toBe(1);
    expect(out.message.byRating.negative).toBe(1);
  });

  it('applies model + provider post-filter together', () => {
    const out = computeFeedbackStats(
      [
        row({ provider: 'openai', model: 'gpt-4', rating: 'positive' }),
        row({ provider: 'openai', model: 'gpt-3.5', rating: 'positive' }),
        row({ provider: 'anthropic', model: 'gpt-4', rating: 'negative' }),
      ],
      { ...NO_FILTER, model: 'gpt-4', provider: 'openai' },
    );
    expect(out.message.total).toBe(1);
  });

  it('ranks topAgents by total desc with stable tiebreak on slug', () => {
    const out = computeFeedbackStats(
      [
        row({ agentSlug: 'beta', rating: 'positive' }),
        row({ agentSlug: 'beta', rating: 'positive' }),
        row({ agentSlug: 'alpha', rating: 'positive' }),
        row({ agentSlug: 'alpha', rating: 'negative' }),
      ],
      NO_FILTER,
    );
    expect(out.topAgents.map((a) => a.agentSlug)).toEqual(['alpha', 'beta']);
    expect(out.topAgents[0].total).toBe(2);
    expect(out.topAgents[1].total).toBe(2);
  });

  it('puts unattributed rows under the sentinel slug', () => {
    const out = computeFeedbackStats(
      [row({ rating: 'positive' }), row({ rating: 'negative' })],
      NO_FILTER,
    );
    expect(out.topAgents.length).toBe(1);
    expect(out.topAgents[0].agentSlug).toBe(UNATTRIBUTED_AGENT_SLUG);
    expect(out.topAgents[0].total).toBe(2);
  });

  it('only ranks topModels when both provider and model are present', () => {
    const out = computeFeedbackStats(
      [
        row({ provider: 'openai', model: 'gpt-4', rating: 'positive' }),
        row({ provider: undefined, model: 'gpt-4', rating: 'positive' }),
        row({ provider: 'openai', model: undefined, rating: 'negative' }),
      ],
      NO_FILTER,
    );
    expect(out.topModels).toEqual([
      {
        provider: 'openai',
        model: 'gpt-4',
        positive: 1,
        negative: 0,
        total: 1,
      },
    ]);
  });

  it('arena rows are excluded from topAgents and topModels', () => {
    const out = computeFeedbackStats(
      [
        row({
          metadata: {
            arenaVerdict: 'a_better',
            modelA: 'gpt-4',
            modelB: 'opus',
          },
          provider: 'openai',
          model: 'gpt-4',
        }),
        row({
          provider: 'openai',
          model: 'gpt-4',
          agentSlug: 'alpha',
          rating: 'positive',
        }),
      ],
      NO_FILTER,
    );
    expect(out.topAgents).toEqual([
      { agentSlug: 'alpha', positive: 1, negative: 0, total: 1 },
    ]);
    expect(out.topModels[0].total).toBe(1);
  });

  it('flips capped flag and stops once maxScan is exceeded', () => {
    const rows = [
      row({ rating: 'positive' }),
      row({ rating: 'positive' }),
      row({ rating: 'positive' }),
    ];
    const out = computeFeedbackStats(rows, { cutoffMs: null, maxScan: 2 });
    expect(out.capped).toBe(true);
    expect(out.scanned).toBe(3);
    expect(out.message.total).toBe(2);
  });

  it('belt-and-suspenders skip when row.createdAt < cutoffMs', () => {
    const out = computeFeedbackStats(
      [
        row({ createdAt: 5_000, rating: 'positive' }),
        row({ createdAt: 500, rating: 'positive' }),
      ],
      { cutoffMs: 1_000, maxScan: 100 },
    );
    expect(out.message.total).toBe(1);
  });

  it('produces a defined empty shape on empty input', () => {
    const out = computeFeedbackStats([], NO_FILTER);
    expect(out.message.total).toBe(0);
    expect(out.arena.total).toBe(0);
    expect(out.topAgents).toEqual([]);
    expect(out.topModels).toEqual([]);
    expect(out.topMatchups).toEqual([]);
    expect(out.capped).toBe(false);
    expect(out.scanned).toBe(0);
  });

  it('aggregates arena matchups in canonical (lexicographic) model order', () => {
    const out = computeFeedbackStats(
      [
        // alpha (A) vs zeta (B), A wins. Canonical [alpha, zeta] → leftWins.
        row({
          metadata: {
            arenaVerdict: 'a_better',
            modelA: 'alpha',
            modelB: 'zeta',
          },
        }),
        // zeta (A) vs alpha (B), A wins. Canonical [alpha, zeta] → rightWins
        // (because A is now the larger of the two).
        row({
          metadata: {
            arenaVerdict: 'a_better',
            modelA: 'zeta',
            modelB: 'alpha',
          },
        }),
        // alpha (A) vs zeta (B), tie.
        row({
          metadata: { arenaVerdict: 'tie', modelA: 'alpha', modelB: 'zeta' },
        }),
        // alpha (A) vs zeta (B), both bad.
        row({
          metadata: {
            arenaVerdict: 'both_bad',
            modelA: 'alpha',
            modelB: 'zeta',
          },
        }),
      ],
      NO_FILTER,
    );
    expect(out.topMatchups).toEqual([
      {
        modelLeft: 'alpha',
        modelRight: 'zeta',
        leftWins: 1,
        rightWins: 1,
        ties: 1,
        bothBad: 1,
        total: 4,
      },
    ]);
  });

  it('skips matchups when arena rows have a self-pair or missing models', () => {
    const out = computeFeedbackStats(
      [
        row({
          metadata: {
            arenaVerdict: 'a_better',
            modelA: 'gpt-4',
            modelB: 'gpt-4',
          },
        }),
        row({ metadata: { arenaVerdict: 'a_better', modelA: 'gpt-4' } }),
        row({ metadata: { arenaVerdict: 'a_better', modelB: 'gpt-4' } }),
        row({ metadata: { arenaVerdict: 'a_better' } }),
      ],
      NO_FILTER,
    );
    expect(out.topMatchups).toEqual([]);
    // Arena totals still increment; only matchup rollup is skipped.
    expect(out.arena.total).toBe(4);
  });

  it('ignores arena rows with unknown verdict in byVerdict', () => {
    const out = computeFeedbackStats(
      [row({ metadata: { arenaVerdict: 'unknown_verdict' } })],
      NO_FILTER,
    );
    expect(out.arena.total).toBe(1);
    // None of the known buckets received the unknown verdict.
    expect(out.arena.byVerdict.a_better).toBe(0);
    expect(out.arena.byVerdict.b_better).toBe(0);
    expect(out.arena.byVerdict.tie).toBe(0);
    expect(out.arena.byVerdict.both_bad).toBe(0);
  });
});

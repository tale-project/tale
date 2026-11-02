import {
  type ArenaVerdict,
  arenaSideProvider,
} from '../../../lib/shared/arena.ts';
import { UNATTRIBUTED_AGENT_SLUG } from '../../../lib/shared/constants/usage.ts';
import type { Doc } from '../lib/rows';

export interface ComputeFeedbackStatsOptions {
  /** Lower bound (inclusive) on `createdAt`. `null` = no period filter. */
  cutoffMs: number | null;
  /** Optional attribution filters applied during reduction. */
  agentSlug?: string;
  model?: string;
  provider?: string;
  /**
   * Defensive scan cap. The caller is expected to bound the query by
   * `createdAt >= cutoffMs` via the `by_org_createdAt` index, so this only
   * matters when `cutoffMs === null` (all-time).
   */
  maxScan: number;
}

export interface FeedbackStatsAgentBucket {
  agentSlug: string;
  positive: number;
  negative: number;
  total: number;
}

export interface FeedbackStatsModelBucket {
  provider: string;
  model: string;
  positive: number;
  negative: number;
  total: number;
}

export interface FeedbackStatsMatchupBucket {
  /** The sides in canonical order — by model (lexicographic), then by
   * provider — so (X,Y) and (Y,X) merge. A side's provider is `null` when
   * its verdict names none (one recorded before verdicts did): such a
   * verdict pairs by its models alone. */
  modelLeft: string;
  providerLeft: string | null;
  modelRight: string;
  providerRight: string | null;
  /** Wins counted against the canonical orientation, not user-picked A/B. */
  leftWins: number;
  rightWins: number;
  ties: number;
  bothBad: number;
  total: number;
}

/** One day of message sentiment for the sentiment-over-time trend. A type
 *  alias (not an interface) so it carries an implicit index signature and is
 *  assignable to the charts' `ChartRow` row type. */
export type FeedbackDailyPoint = {
  /** UTC `YYYY-MM-DD`. */
  dateKey: string;
  positive: number;
  negative: number;
};

export interface FeedbackStats {
  message: {
    byRating: { positive: number; negative: number };
    total: number;
  };
  arena: {
    /** Verdicts on two DIFFERENT sides — two models, or one model through
     * two providers — the rows the matchup table counts, so the summary
     * tile and the table agree. */
    byVerdict: Record<ArenaVerdict, number>;
    /** Verdicts where both sides were the same model through the same
     * provider, or through a provider one side does not name: a comparison
     * with no comparative signal, counted apart from the verdict buckets. */
    selfMatches: number;
    /** Every arena row, whatever it compared. */
    total: number;
  };
  /** Message sentiment bucketed by UTC day (days with feedback only), ascending. */
  series: FeedbackDailyPoint[];
  topAgents: FeedbackStatsAgentBucket[];
  topModels: FeedbackStatsModelBucket[];
  topMatchups: FeedbackStatsMatchupBucket[];
  capped: boolean;
  scanned: number;
  windowStartMs: number | null;
}

const TOP_N = 10;

function utcDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isArenaRow(row: Doc<'messageFeedback'>): boolean {
  return row.metadata?.arenaVerdict !== undefined;
}

function arenaVerdictOf(row: Doc<'messageFeedback'>): ArenaVerdict | null {
  const v = row.metadata?.arenaVerdict;
  if (v === 'a_better' || v === 'b_better' || v === 'tie' || v === 'both_bad') {
    return v;
  }
  return null;
}

/**
 * Pure reducer for feedback aggregates. No Convex `ctx` — accepts any
 * iterable (live query iterator, in-memory test array) and produces the
 * aggregate shape the page consumes.
 *
 * Caller is responsible for opening the iterator with the appropriate
 * index range (org + period). This function only applies the optional
 * agent/model/provider post-filters and produces the topAgents/topModels
 * rankings.
 */
export function computeFeedbackStats(
  rows: Iterable<Doc<'messageFeedback'>>,
  opts: ComputeFeedbackStatsOptions,
): FeedbackStats {
  const messageByRating = { positive: 0, negative: 0 };
  let messageTotal = 0;

  const arenaByVerdict: Record<ArenaVerdict, number> = {
    a_better: 0,
    b_better: 0,
    tie: 0,
    both_bad: 0,
  };
  let arenaTotal = 0;
  let arenaSelfMatches = 0;

  const agentBuckets = new Map<string, FeedbackStatsAgentBucket>();
  const modelBuckets = new Map<string, FeedbackStatsModelBucket>();
  const matchupBuckets = new Map<string, FeedbackStatsMatchupBucket>();
  const byDay = new Map<string, { positive: number; negative: number }>();

  let scanned = 0;
  let capped = false;

  for (const row of rows) {
    scanned++;
    if (scanned > opts.maxScan) {
      capped = true;
      break;
    }

    if (opts.cutoffMs !== null && row.createdAt < opts.cutoffMs) {
      // Iterator was supposed to be window-bounded already — this is a
      // belt-and-suspenders check for callers that pass unbounded data.
      continue;
    }
    if (opts.agentSlug !== undefined && row.agentSlug !== opts.agentSlug) {
      continue;
    }
    if (opts.model !== undefined && row.model !== opts.model) {
      continue;
    }
    if (opts.provider !== undefined && row.provider !== opts.provider) {
      continue;
    }

    if (isArenaRow(row)) {
      arenaTotal++;
      const verdict = arenaVerdictOf(row);
      const modelA: unknown = row.metadata?.modelA;
      const modelB: unknown = row.metadata?.modelB;
      const providerA = arenaSideProvider(row.metadata?.providerA);
      const providerB = arenaSideProvider(row.metadata?.providerB);
      // A self-match — one model through one provider on both sides —
      // carries no comparative signal: it is counted apart, in neither the
      // verdict buckets nor the matchups, so the summary tile adds up to the
      // matchup table. One model through two providers is a comparison. A
      // side that names no provider (a verdict recorded before verdicts
      // named them) compares by its model alone, as such verdicts always did.
      const selfMatch =
        typeof modelA === 'string' &&
        typeof modelB === 'string' &&
        modelA === modelB &&
        (providerA === null || providerB === null || providerA === providerB);
      if (selfMatch) arenaSelfMatches++;
      else if (verdict) arenaByVerdict[verdict]++;

      // Pair matchups are only meaningful when both sides are attributed
      // and distinct.
      if (
        verdict &&
        typeof modelA === 'string' &&
        typeof modelB === 'string' &&
        modelA &&
        modelB &&
        !selfMatch
      ) {
        // Canonical order: by model, then by provider (which only decides
        // when both sides are one model through two providers).
        const swapped =
          modelA === modelB
            ? (providerA ?? '') > (providerB ?? '')
            : modelA > modelB;
        const left = swapped
          ? { model: modelB, provider: providerB }
          : { model: modelA, provider: providerA };
        const right = swapped
          ? { model: modelA, provider: providerA }
          : { model: modelB, provider: providerB };
        const matchupKey = JSON.stringify([
          left.model,
          left.provider,
          right.model,
          right.provider,
        ]);
        let bucket = matchupBuckets.get(matchupKey);
        if (!bucket) {
          bucket = {
            modelLeft: left.model,
            providerLeft: left.provider,
            modelRight: right.model,
            providerRight: right.provider,
            leftWins: 0,
            rightWins: 0,
            ties: 0,
            bothBad: 0,
            total: 0,
          };
          matchupBuckets.set(matchupKey, bucket);
        }
        bucket.total++;
        if (verdict === 'tie') {
          bucket.ties++;
        } else if (verdict === 'both_bad') {
          bucket.bothBad++;
        } else if (verdict === 'a_better') {
          // a_better == originalA wins. If we swapped (modelA > modelB),
          // originalA is now on the right side of the canonical pair.
          if (swapped) bucket.rightWins++;
          else bucket.leftWins++;
        } else {
          // b_better == originalB wins.
          if (swapped) bucket.leftWins++;
          else bucket.rightWins++;
        }
      }
    } else {
      messageTotal++;
      const isPositive = row.rating === 'positive';
      if (isPositive) messageByRating.positive++;
      else messageByRating.negative++;

      // Bucket by UTC day for the sentiment-over-time trend.
      const dayKey = utcDayKey(row.createdAt);
      const dayBucket = byDay.get(dayKey) ?? { positive: 0, negative: 0 };
      if (isPositive) dayBucket.positive++;
      else dayBucket.negative++;
      byDay.set(dayKey, dayBucket);

      // topAgents / topModels are message-level only. Arena rows have no
      // single agent owner; folding them in would double-count and produce
      // misleading sentiment ratios per agent.
      const agentKey = row.agentSlug ?? UNATTRIBUTED_AGENT_SLUG;
      let agentBucket = agentBuckets.get(agentKey);
      if (!agentBucket) {
        agentBucket = {
          agentSlug: agentKey,
          positive: 0,
          negative: 0,
          total: 0,
        };
        agentBuckets.set(agentKey, agentBucket);
      }
      agentBucket.total++;
      if (row.rating === 'positive') agentBucket.positive++;
      else agentBucket.negative++;

      if (row.model && row.provider) {
        const modelKey = `${row.provider}::${row.model}`;
        let modelBucket = modelBuckets.get(modelKey);
        if (!modelBucket) {
          modelBucket = {
            provider: row.provider,
            model: row.model,
            positive: 0,
            negative: 0,
            total: 0,
          };
          modelBuckets.set(modelKey, modelBucket);
        }
        modelBucket.total++;
        if (row.rating === 'positive') modelBucket.positive++;
        else modelBucket.negative++;
      }
    }
  }

  // Sort by total desc, stable tiebreak on slug / model id. Drops the
  // unattributed bucket out of the top-N display when there is real
  // agent traffic — but keep it in the data so the caller can render
  // a "(unattributed)" row if it dominates.
  const topAgents = [...agentBuckets.values()]
    .sort((a, b) => b.total - a.total || a.agentSlug.localeCompare(b.agentSlug))
    .slice(0, TOP_N);

  const topModels = [...modelBuckets.values()]
    .sort(
      (a, b) =>
        b.total - a.total ||
        `${a.provider}::${a.model}`.localeCompare(`${b.provider}::${b.model}`),
    )
    .slice(0, TOP_N);

  const topMatchups = [...matchupBuckets.values()]
    .sort(
      (a, b) =>
        b.total - a.total ||
        `${a.modelLeft}::${a.modelRight}`.localeCompare(
          `${b.modelLeft}::${b.modelRight}`,
        ) ||
        `${a.providerLeft ?? ''}::${a.providerRight ?? ''}`.localeCompare(
          `${b.providerLeft ?? ''}::${b.providerRight ?? ''}`,
        ),
    )
    .slice(0, TOP_N);

  const series: FeedbackDailyPoint[] = [...byDay.entries()]
    .map(([dateKey, v]) => ({
      dateKey,
      positive: v.positive,
      negative: v.negative,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  return {
    message: { byRating: messageByRating, total: messageTotal },
    arena: {
      byVerdict: arenaByVerdict,
      selfMatches: arenaSelfMatches,
      total: arenaTotal,
    },
    series,
    topAgents,
    topModels,
    topMatchups,
    capped,
    scanned,
    windowStartMs: opts.cutoffMs,
  };
}

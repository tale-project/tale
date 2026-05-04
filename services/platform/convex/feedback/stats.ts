import type { Doc } from '../_generated/dataModel';

export type ArenaVerdict = 'a_better' | 'b_better' | 'tie' | 'both_bad';
export const ARENA_VERDICTS: ArenaVerdict[] = [
  'a_better',
  'b_better',
  'tie',
  'both_bad',
];

const SYNTHETIC_AGENT_DIRECT_API = '__direct_api__';
const SYNTHETIC_AGENT_INTEGRATION = '__integration__';
// Sentinel slug used in the ranking when a row has no agent attribution
// (typically arena rows or legacy / pre-attribution rows). Distinct from
// the Usage-page synthetic slugs so the UI can label it differently.
export const UNATTRIBUTED_AGENT_SLUG = '__unattributed__';

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
  /** Models in canonical (lexicographic) order so (X,Y) and (Y,X) merge. */
  modelLeft: string;
  modelRight: string;
  /** Wins counted against the canonical orientation, not user-picked A/B. */
  leftWins: number;
  rightWins: number;
  ties: number;
  bothBad: number;
  total: number;
}

export interface FeedbackStats {
  message: {
    byRating: { positive: number; negative: number };
    total: number;
  };
  arena: {
    byVerdict: Record<ArenaVerdict, number>;
    total: number;
  };
  topAgents: FeedbackStatsAgentBucket[];
  topModels: FeedbackStatsModelBucket[];
  topMatchups: FeedbackStatsMatchupBucket[];
  capped: boolean;
  scanned: number;
  windowStartMs: number | null;
}

const TOP_N = 10;

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

  const agentBuckets = new Map<string, FeedbackStatsAgentBucket>();
  const modelBuckets = new Map<string, FeedbackStatsModelBucket>();
  const matchupBuckets = new Map<string, FeedbackStatsMatchupBucket>();

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
      if (verdict) arenaByVerdict[verdict]++;

      const modelA = row.metadata?.modelA;
      const modelB = row.metadata?.modelB;
      // Model-pair matchups are only meaningful when both sides are
      // attributed and distinct. Drop self-matches (modelA === modelB) —
      // verdict on those carries no comparative signal.
      if (verdict && modelA && modelB && modelA !== modelB) {
        const swapped = modelA > modelB;
        const left = swapped ? modelB : modelA;
        const right = swapped ? modelA : modelB;
        const matchupKey = `${left}::${right}`;
        let bucket = matchupBuckets.get(matchupKey);
        if (!bucket) {
          bucket = {
            modelLeft: left,
            modelRight: right,
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
      if (row.rating === 'positive') messageByRating.positive++;
      else messageByRating.negative++;

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
        ),
    )
    .slice(0, TOP_N);

  return {
    message: { byRating: messageByRating, total: messageTotal },
    arena: { byVerdict: arenaByVerdict, total: arenaTotal },
    topAgents,
    topModels,
    topMatchups,
    capped,
    scanned,
    windowStartMs: opts.cutoffMs,
  };
}

/**
 * Synthetic-slug helpers — kept colocated with the reducer because the
 * UI needs them too (label resolution).
 */
export function isUnattributedAgentSlug(slug: string): boolean {
  return slug === UNATTRIBUTED_AGENT_SLUG;
}

export function isFeedbackSyntheticAgentSlug(slug: string): boolean {
  return (
    slug === UNATTRIBUTED_AGENT_SLUG ||
    slug === SYNTHETIC_AGENT_DIRECT_API ||
    slug === SYNTHETIC_AGENT_INTEGRATION
  );
}

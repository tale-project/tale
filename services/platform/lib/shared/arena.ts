/**
 * Arena Mode's one shared vocabulary — THE documented home of its
 * special-casing.
 *
 * An arena pair is two live threads answering the same prompts side by side:
 * column A is the conversation the user started from, column B a hidden
 * copy. The verdict settles the pair by *choosing the surviving thread* —
 * no message ever migrates between columns — and records itself as a
 * `messageFeedback` row with a synthetic message id plus
 * `metadata.{arenaVerdict, modelA, modelB}`. The feedback analytics page
 * (`convex/feedback/stats.ts`) recognises arena rows purely by that
 * metadata shape, so the constants here are a cross-page contract: settle
 * writes them, the verdict bar renders them, and the analytics contract
 * test locks them.
 */

export const ARENA_VERDICTS = [
  'a_better',
  'b_better',
  'tie',
  'both_bad',
] as const;

export type ArenaVerdict = (typeof ARENA_VERDICTS)[number];

/**
 * The synthetic `messageId` an arena verdict's feedback row carries. A
 * verdict rates a matchup, not a message — the id encodes the pairing so
 * the analytics reader can group rows without resolving message documents.
 * Settle INSERTS a fresh row per verdict (never upserts): two runs of the
 * same matchup are two data points.
 */
export function arenaFeedbackMessageId(modelA: string, modelB: string): string {
  return `arena:${modelA}:${modelB}`;
}

/**
 * The coarse thumbs rating a verdict maps to. Every verdict that crowned a
 * usable answer counts as positive signal for the matchup; only "both bad"
 * is negative.
 */
export function ratingForVerdict(
  verdict: ArenaVerdict,
): 'positive' | 'negative' {
  return verdict === 'both_bad' ? 'negative' : 'positive';
}

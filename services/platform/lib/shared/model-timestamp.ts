/**
 * One rendering of a stored timestamp for anything a language model reads.
 *
 * Both agent lanes answer tool calls with rows straight out of Convex, where
 * every timestamp is epoch milliseconds. Handing that number to a model and
 * leaving it to work out a calendar date does not survive contact: on one
 * deployment three attachment dates came back uniformly four weeks late, and
 * the same document rendered two different creation dates on two turns. The
 * ordering was right both times; only the arithmetic was wrong, which is
 * exactly the kind of work not to hand a language model.
 *
 * Lives here rather than beside either lane's tool definitions because the
 * chat tools and the sandbox workspace tools both need it, and a second copy
 * of a formatter is how two lanes start disagreeing about what a date is.
 */

/**
 * A stored timestamp as the model should see it: ISO 8601 UTC, matching the
 * `Current time:` line the system prompt already carries, so a comparison is
 * between like and like.
 *
 * Returns `undefined` for a value that is not a finite timestamp, so one bad
 * stored number degrades to an omitted field rather than a failed turn.
 */
export function modelTimestamp(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  const iso = new Date(ms).toISOString();
  return iso === 'Invalid Date' ? undefined : iso;
}

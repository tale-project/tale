/**
 * Deep-truncate an arbitrary JSON value so one verbose payload cannot flood
 * whatever is about to store or send it: long strings are cut with a count
 * marker, arrays are capped with a count marker, and nesting past the depth
 * limit is elided.
 *
 * Two callers with genuinely different budgets share this one algorithm rather
 * than keeping a copy each:
 *
 *  - the chat tool loop, fitting a tool result into a context window
 *    (hundreds of characters — the model only needs the gist);
 *  - the automations run log, bounding a run's diagnostic trace
 *    (tens of kilobytes — a human debugging a failure needs the real stack).
 *
 * **Only ever apply this to data that is purely descriptive.** Truncating a
 * value that something later READS BACK changes behaviour instead of just
 * shortening a log — in the automations engine a node's checkpoint `output`
 * feeds the executor's scope on resume, so it must never be bounded.
 */

export interface BoundJsonLimits {
  /** Characters kept per string before the count marker. */
  readonly maxString: number;
  /** Array entries kept before the count marker. */
  readonly maxItems: number;
  /** Nesting levels walked before the subtree is elided. */
  readonly maxDepth: number;
}

/**
 * Bound `value` to `limits`. Primitives other than strings pass through
 * untouched; `undefined` and `null` are preserved so an absent field stays
 * absent rather than becoming a marker.
 */
export function boundJson(
  value: unknown,
  limits: BoundJsonLimits,
  depth = 0,
): unknown {
  if (depth > limits.maxDepth) return '…';
  if (typeof value === 'string') {
    return value.length > limits.maxString
      ? `${value.slice(0, limits.maxString)}…(+${value.length - limits.maxString} chars)`
      : value;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, limits.maxItems)
      .map((item) => boundJson(item, limits, depth + 1));
    if (value.length > limits.maxItems) {
      items.push(`…(+${value.length - limits.maxItems} more items)`);
    }
    return items;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = boundJson(entry, limits, depth + 1);
    }
    return out;
  }
  return value;
}

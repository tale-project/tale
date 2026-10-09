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
 * A third caller, the automations run recorder, keeps markers out of the value
 * altogether: {@link boundJsonOutOfBand} cuts the same way but lists each cut
 * beside the value, so a stored value never holds text it did not have.
 *
 * **Only ever apply this to data that is purely descriptive.** Truncating a
 * value that something later READS BACK changes behaviour instead of just
 * shortening a log — in the automations engine a node's checkpoint `output`
 * feeds the executor's scope on resume, so it must never be bounded.
 */

import { pointerOf } from '@tale/ui/data/json-pointer';

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

/** One cut {@link boundJsonOutOfBand} made, and what it dropped there. */
export interface BoundJsonCut {
  /** RFC 6901 pointer to the cut value, `''` for the whole value. */
  readonly pointer: string;
  /** `string`: characters dropped from its end; `items`: list entries
   * dropped from its end; `depth`: a value past the depth limit, replaced by
   * `null`, with `dropped` its size as UTF-8 JSON. */
  readonly kind: 'string' | 'items' | 'depth';
  readonly dropped: number;
}

const encoder = new TextEncoder();

/**
 * Bound `value` to `limits` as {@link boundJson} does, without writing a
 * marker into it: a long string is cut (never inside a character that takes
 * two UTF-16 units), a long list keeps its first entries, and a value past
 * the depth limit becomes `null`. Each cut is listed in `cuts`, in document
 * order, up to `maxCuts`. `undefined` stays `undefined`; the value must
 * already be plain JSON (see `jsonNormalize`).
 */
export function boundJsonOutOfBand(
  value: unknown,
  limits: BoundJsonLimits,
  maxCuts = 100,
): { value: unknown; cuts: BoundJsonCut[] } {
  const cuts: BoundJsonCut[] = [];
  const path: Array<string | number> = [];
  const cut = (kind: BoundJsonCut['kind'], dropped: number): void => {
    if (cuts.length < maxCuts) {
      cuts.push({ pointer: pointerOf(path), kind, dropped });
    }
  };
  const walk = (entry: unknown, depth: number): unknown => {
    if (depth > limits.maxDepth) {
      if (entry === undefined) return undefined;
      cut('depth', encoder.encode(JSON.stringify(entry) ?? '').length);
      return null;
    }
    if (typeof entry === 'string') {
      if (entry.length <= limits.maxString) return entry;
      const kept = cutText(entry, limits.maxString);
      cut('string', entry.length - kept.length);
      return kept;
    }
    if (Array.isArray(entry)) {
      const items: unknown[] = [];
      for (const [index, item] of entry.slice(0, limits.maxItems).entries()) {
        path.push(index);
        items.push(walk(item, depth + 1));
        path.pop();
      }
      if (entry.length > limits.maxItems) {
        cut('items', entry.length - limits.maxItems);
      }
      return items;
    }
    if (entry !== null && typeof entry === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, member] of Object.entries(entry)) {
        path.push(key);
        out[key] = walk(member, depth + 1);
        path.pop();
      }
      return out;
    }
    return entry;
  };
  return { value: walk(value, 0), cuts };
}

/** The first `max` UTF-16 units of `text`, one fewer when the cut would
 * split a character that takes two. */
function cutText(text: string, max: number): string {
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

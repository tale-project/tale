/**
 * How a test compares what it expects with what a run did: the shared value
 * diff (`@tale/ui/data/value-diff`), read with the expectation as `before`
 * and the run's value as `after` — a `removed` change is something the test
 * expected and the run lacks (missing), an `added` one something the run has
 * and an exact expectation does not (extra), beside `changed` and
 * `type-changed`. Lists pair their items by position.
 *
 * Both sides are first read the way the test runner has always compared
 * them — through the serializer of its pass rule, where a member holding
 * `undefined` reads as `null` — so an exact comparison finds no change
 * exactly when that rule found the two equal, byte for byte. Pure and
 * browser-safe.
 */

import { diffValues, type DiffChange } from '@tale/ui/data/value-diff';

import { stableStringify } from '../../shared/utils/stable-stringify';
import {
  cutText,
  storableJson,
  storableText,
} from '../../shared/utils/storable-text';
import type { Json } from '../core/types';

/** A difference a test report names: where (`pointer`, `path`), what kind
 * (`removed`: the test expected it and the run lacks it; `added`: the run
 * has it and an exact expectation does not; `changed`; `type-changed`), and
 * both values. */
export type Mismatch = DiffChange;

/** How many changes a comparison lists by default. */
const DEFAULT_CAP = 20;

/** How deep an `includes` comparison follows an expectation; past it, the
 * rest of a value is compared whole, where a member the expectation leaves
 * out counts as a difference. The shared diff's own default, 12, is a depth
 * an expectation can reach (a nested API answer); this one is not. */
const INCLUDES_MAX_DEPTH = 64;

/** A value as the pass rule reads it: its JSON text, keys sorted, a member
 * holding `undefined` as `null`, and that text read back. */
function asCompared(value: unknown): { text: string; value: unknown } {
  const text = stableStringify(value);
  return { text, value: JSON.parse(text) };
}

/** The changes between an expectation and a run's value, at most `cap` of
 * them, and how many there are in all. A comparison that cannot be decided
 * in full is never a pass: an `includes` comparison stopped at the most
 * values one diff visits reads as one `unknown` change of the whole value. */
export function mismatchesOf(
  mode: 'exact' | 'includes',
  expected: unknown,
  actual: unknown,
  cap = DEFAULT_CAP,
): { changes: Mismatch[]; total: number } {
  const before = asCompared(expected);
  const after = asCompared(actual);
  const result = diffValues(before.value, after.value, {
    mode,
    arrays: 'index',
    maxChanges: Math.max(1, cap),
    ...(mode === 'includes' && { maxDepth: INCLUDES_MAX_DEPTH }),
  });
  const total = Object.entries(result.counts)
    .filter(([kind]) => kind !== 'unchanged')
    .reduce((sum, [, n]) => sum + n, 0);
  const changes = result.changes.slice(0, cap);
  const whole = (kind: 'changed' | 'unknown') => ({
    changes: [
      { pointer: '', path: [], kind, before: before.value, after: after.value },
    ],
    total: Math.max(total, 1),
  });
  // An exact comparison differs exactly when the pass rule's texts do. Where
  // the diff saw no difference between two texts that differ — past the most
  // values it visits, or in a member it read as one every object inherits
  // (`__proto__`) — the two differ as a whole.
  if (changes.length === 0 && mode === 'exact' && before.text !== after.text) {
    return whole('changed');
  }
  // Past the most values one diff visits, a difference may have gone
  // unseen: whether the value includes the expectation is not known.
  if (changes.length === 0 && mode === 'includes' && result.truncated) {
    return whole('unknown');
  }
  return { changes, total: Math.max(total, changes.length) };
}

/** What differs between an expected value and a run's, compared whole:
 * none exactly when the test's pass rule finds them equal. */
export function compareExact(
  expected: unknown,
  actual: unknown,
  cap = DEFAULT_CAP,
): DiffChange[] {
  return mismatchesOf('exact', expected, actual, cap).changes;
}

/** What differs where the run's value does not contain what the test
 * expects: keys the expectation leaves out are not compared, and lists
 * compare position by position with the same length. */
export function compareIncludes(
  expected: unknown,
  actual: unknown,
  cap = DEFAULT_CAP,
): DiffChange[] {
  return mismatchesOf('includes', expected, actual, cap).changes;
}

/** How many characters of a value a report quotes. */
const REPORT_CHARS = 200;

/**
 * A value as a test report quotes it: plain JSON, text and the JSON of an
 * object or a list cut to `chars` characters with "…" (an object cut that
 * way reads as its cut JSON text), every string storable.
 */
export function reportValue(value: unknown, chars = REPORT_CHARS): Json {
  const plain: unknown = value === undefined ? null : asCompared(value).value;
  if (typeof plain === 'string') return cut(plain, chars);
  if (plain === null || typeof plain !== 'object') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a number or a boolean, read back from JSON
    return plain as Json;
  }
  const text = JSON.stringify(plain);
  if (text.length > chars) return cut(text, chars);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an object or a list read back from JSON
  return storableJson(plain as Json);
}

function cut(text: string, chars: number): string {
  return text.length > chars
    ? `${storableText(cutText(text, chars))}…`
    : storableText(text);
}

/** A change as a report keeps it: its values quoted with
 * {@link reportValue}. */
export function reportChange(change: DiffChange): DiffChange {
  return {
    ...change,
    path: [...change.path],
    ...(change.before !== undefined && { before: reportValue(change.before) }),
    ...(change.after !== undefined && { after: reportValue(change.after) }),
  };
}

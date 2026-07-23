/**
 * Reading and rendering engine results, for a session loop that must treat
 * every result as untrusted data.
 *
 * `dispatch` answers with plain objects whose shape depends on the method and
 * on how the call went, so the loop reads them defensively: a missing or
 * unexpected field is a "no", never a crash. Two things are derived here and
 * used all over the loop — whether a result reports failure (which drives the
 * reflection nudge) and a stable signature of its errors (which is how the
 * loop notices the agent is hitting the same wall twice).
 *
 * Rendering deep-truncates before pretty-printing: a trace teaches the agent
 * the real data shapes, and an untruncated one floods a small context window
 * so completely that nothing else in the turn survives.
 */

import { stableStringify } from '../engine/api/tests';

/** Narrow an unknown value to a plain object, or null. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
      (value as Record<string, unknown>)
    : null;
}

/** The handful of result fields the loop and its nudges branch on. */
export interface ResultFacts {
  status: string | null;
  valid: boolean | null;
  matches: number;
  /** A test report that ran at least one test and failed none. */
  testsPassed: boolean;
  /** A save that came back with a version. */
  saved: { name: string; version: number } | null;
}

export function resultFacts(result: unknown): ResultFacts {
  const r = asRecord(result);
  if (!r) {
    return {
      status: null,
      valid: null,
      matches: 0,
      testsPassed: false,
      saved: null,
    };
  }
  const passed = typeof r.passed === 'number' ? r.passed : 0;
  const failed = typeof r.failed === 'number' ? r.failed : 0;
  return {
    status: typeof r.status === 'string' ? r.status : null,
    valid: typeof r.valid === 'boolean' ? r.valid : null,
    matches: Array.isArray(r.matches) ? r.matches.length : 0,
    testsPassed: failed === 0 && passed > 0,
    saved:
      r.error === undefined &&
      typeof r.name === 'string' &&
      typeof r.version === 'number'
        ? { name: r.name, version: r.version }
        : null,
  };
}

/**
 * A stable, order-independent signature of everything the result says went
 * wrong, or `''` when it reports nothing wrong. Two turns that produce the
 * same signature produced the same failure — the agent learned nothing, which
 * is exactly what the fruitless counter counts.
 */
export function errorSignature(result: unknown): string {
  const r = asRecord(result);
  if (!r) return '';
  const parts: string[] = [];
  if (typeof r.error === 'string') parts.push(r.error);
  const errorObject = asRecord(r.error);
  if (errorObject && typeof errorObject.message === 'string') {
    parts.push(errorObject.message);
  }
  if (Array.isArray(r.errors) && r.errors.length > 0) {
    parts.push(stableStringify(r.errors));
  }
  const validation = asRecord(r.validation);
  if (
    validation &&
    Array.isArray(validation.errors) &&
    validation.errors.length > 0
  ) {
    parts.push(stableStringify(validation.errors));
  }
  if (Array.isArray(r.results)) {
    const failures = r.results.filter((entry) => {
      const test = asRecord(entry);
      return test !== null && test.pass === false;
    });
    if (failures.length > 0) parts.push(stableStringify(failures));
  }
  return parts.join(' | ');
}

/** Whether the result reports a failure the agent has to diagnose. */
export function isFailureResult(result: unknown): boolean {
  if (errorSignature(result) !== '') return true;
  const facts = resultFacts(result);
  return (
    facts.status === 'error' ||
    facts.status === 'invalid' ||
    facts.valid === false
  );
}

const MAX_STRING = 400;
const MAX_ITEMS = 12;
const MAX_DEPTH = 8;
const PRETTY_LIMIT = 6000;
const HARD_LIMIT = 7000;

/** Bound a value's size while keeping its shape recognizable. */
function truncateDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '…';
  if (typeof value === 'string') {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…(+${value.length - MAX_STRING} chars)`
      : value;
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value
      .slice(0, MAX_ITEMS)
      .map((item) => truncateDeep(item, depth + 1));
    if (value.length > MAX_ITEMS) {
      items.push(`…(+${value.length - MAX_ITEMS} more items)`);
    }
    return items;
  }
  const record = asRecord(value);
  if (record) {
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        truncateDeep(item, depth + 1),
      ]),
    );
  }
  return value;
}

/** The result as the agent sees it: truncated, pretty while it fits. */
export function renderResult(result: unknown): string {
  const truncated = truncateDeep(result);
  let text = JSON.stringify(truncated, null, 1) ?? 'null';
  if (text.length > PRETTY_LIMIT) text = JSON.stringify(truncated) ?? 'null';
  if (text.length > HARD_LIMIT)
    text = `${text.slice(0, HARD_LIMIT)}…(truncated)`;
  return text;
}

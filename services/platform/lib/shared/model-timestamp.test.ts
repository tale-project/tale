// The one date rendering both agent lanes answer with. A tool result used to
// carry raw epoch milliseconds; on a live deployment the model rendered three
// attachment dates uniformly four weeks late, and the same document as two
// different creation dates on two turns. The sort order was right both times —
// only the arithmetic was wrong.

import { describe, expect, it } from 'vitest';

import { modelTimestamp } from './model-timestamp';

describe('modelTimestamp — dates the model does not have to compute', () => {
  it('renders a stored timestamp as ISO 8601 UTC', () => {
    // 2026-08-19T07:25:01.288Z — the arrival time of a real attachment.
    expect(modelTimestamp(1_787_124_301_288)).toBe('2026-08-19T07:25:01.288Z');
  });

  it('matches the format the system prompt already uses for the current time', () => {
    // `Current time: <ISO> (UTC)` is in the runtime directives, so a comparison
    // is between like and like rather than between prose and a number.
    const rendered = modelTimestamp(Date.UTC(2026, 7, 19, 7, 25));
    expect(rendered).toBe(new Date(Date.UTC(2026, 7, 19, 7, 25)).toISOString());
  });

  it('omits a value that is not a usable timestamp', () => {
    // One bad stored number degrades to a missing field, never a failed turn.
    expect(modelTimestamp(undefined)).toBeUndefined();
    expect(modelTimestamp(Number.NaN)).toBeUndefined();
    expect(modelTimestamp(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('keeps the epoch itself, which is a real value and not a missing one', () => {
    expect(modelTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});

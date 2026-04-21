import { describe, expect, it } from 'vitest';

import {
  clampMessage,
  escapeRegExp,
  execWithBudget,
  MAX_MESSAGE_BYTES,
} from '../regex_safety';

describe('regex_safety.escapeRegExp', () => {
  it('escapes every regex metacharacter', () => {
    const meta = '.+*?^${}()|[]\\';
    const escaped = escapeRegExp(meta);
    // Building a literal matcher from the escaped string must match the
    // original character sequence exactly, with no wildcard side effects.
    expect(new RegExp(escaped).test(meta)).toBe(true);
  });

  it('leaves plain words alone', () => {
    expect(escapeRegExp('hello world')).toBe('hello world');
  });
});

describe('regex_safety.clampMessage', () => {
  it('truncates oversized input and reports it', () => {
    const big = 'x'.repeat(MAX_MESSAGE_BYTES + 100);
    const out = clampMessage(big);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(MAX_MESSAGE_BYTES);
  });

  it('leaves small input untouched', () => {
    const out = clampMessage('hi');
    expect(out.truncated).toBe(false);
    expect(out.text).toBe('hi');
  });
});

describe('regex_safety.execWithBudget', () => {
  it('requires the global flag', () => {
    expect(() => execWithBudget(/foo/, 'foo')).toThrow(
      /requires a regex with the g flag/,
    );
  });

  it('collects multiple matches from a greedy regex', () => {
    const matches = execWithBudget(/\d+/g, 'a1 b22 c333');
    expect(matches.map((m) => m.matchedText)).toEqual(['1', '22', '333']);
  });

  it('aborts the multi-match loop when the per-call budget elapses', () => {
    // Budget mitigates the N-matches-per-pattern case (many short matches
    // each taking N ms). Catastrophic backtracking INSIDE a single V8
    // exec call is not interruptible from user code — that's a separate
    // ReDoS vector addressed by Zod length caps + admin guidance.
    const bigHaystack = 'a '.repeat(200_000); // >=200k single-char matches
    const start = Date.now();
    const matches = execWithBudget(/a/g, bigHaystack, 10);
    const elapsed = Date.now() - start;
    // Elapsed should be close to the budget (10ms) with a generous
    // multiplier to absorb CI variance. Without the budget, matching
    // 200k times would take far longer.
    expect(elapsed).toBeLessThan(500);
    // The loop aborts mid-scan; we won't have collected all 200k matches.
    expect(matches.length).toBeLessThan(200_000);
  });

  it('advances past zero-length matches', () => {
    // `^` alone matches with zero length; without the `lastIndex += 1` guard
    // this would infinite-loop.
    const matches = execWithBudget(/^/g, 'abc');
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

import { describe, expect, it } from 'vitest';

import { outputTokensPerSecond, replyPhases } from './message-timing';

describe('replyPhases', () => {
  it('splits a reasoning reply into its four consecutive phases', () => {
    expect(
      replyPhases({
        setupMs: 120,
        timeToFirstReasoningMs: 400,
        timeToFirstTokenMs: 1400,
        durationMs: 3400,
      }),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 120 },
      { kind: 'waiting', startMs: 120, durationMs: 280 },
      { kind: 'thinking', startMs: 400, durationMs: 1000 },
      { kind: 'writing', startMs: 1400, durationMs: 2000 },
    ]);
  });

  it('waits straight into writing when the model did not think first', () => {
    expect(
      replyPhases({ setupMs: 30, timeToFirstTokenMs: 450, durationMs: 2000 }),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 30 },
      { kind: 'waiting', startMs: 30, durationMs: 420 },
      { kind: 'writing', startMs: 450, durationMs: 1550 },
    ]);
  });

  it('starts at the reply when no setup anchor was stamped', () => {
    expect(replyPhases({ timeToFirstTokenMs: 450, durationMs: 2000 })).toEqual([
      { kind: 'waiting', startMs: 0, durationMs: 450 },
      { kind: 'writing', startMs: 450, durationMs: 1550 },
    ]);
  });

  it('thinks until the settle when no answer token arrived', () => {
    expect(
      replyPhases({
        setupMs: 50,
        timeToFirstReasoningMs: 200,
        durationMs: 900,
      }),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 50 },
      { kind: 'waiting', startMs: 50, durationMs: 150 },
      { kind: 'thinking', startMs: 200, durationMs: 700 },
    ]);
  });

  it('drops a phase whose bounds are out of order instead of guessing', () => {
    // Reasoning stamped after the first token: no thinking phase before it.
    expect(
      replyPhases({
        timeToFirstReasoningMs: 900,
        timeToFirstTokenMs: 500,
        durationMs: 800,
      }),
    ).toEqual([
      { kind: 'waiting', startMs: 0, durationMs: 500 },
      { kind: 'writing', startMs: 500, durationMs: 300 },
    ]);
  });

  it('has nothing to draw without a settle or a first token', () => {
    expect(replyPhases({})).toEqual([]);
    expect(replyPhases({ setupMs: 40 })).toEqual([]);
  });
});

describe('outputTokensPerSecond', () => {
  it('counts from the first answer token to the settle', () => {
    expect(
      outputTokensPerSecond({
        outputTokens: 200,
        timeToFirstTokenMs: 450,
        durationMs: 2000,
      }),
    ).toBeCloseTo(129.03, 1);
  });

  it('counts from the first reasoning delta when the model thought first', () => {
    // Reasoning tokens are part of the output count, so the window starts
    // where they did.
    expect(
      outputTokensPerSecond({
        outputTokens: 300,
        timeToFirstReasoningMs: 500,
        timeToFirstTokenMs: 1500,
        durationMs: 3500,
      }),
    ).toBe(100);
  });

  it('has no speed without a window or a count', () => {
    expect(
      outputTokensPerSecond({
        outputTokens: 18,
        timeToFirstTokenMs: 2410,
        durationMs: 2410,
      }),
    ).toBeUndefined();
    expect(
      outputTokensPerSecond({ timeToFirstTokenMs: 10, durationMs: 100 }),
    ).toBeUndefined();
    expect(outputTokensPerSecond({ outputTokens: 18 })).toBeUndefined();
  });
});

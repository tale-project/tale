import { describe, expect, it } from 'vitest';

import type { MessagePart } from '../types';
import { outputTokensPerSecond, replyPhases } from './message-timing';

/** A reply that ran no tool. */
const ANSWER: readonly MessagePart[] = [{ type: 'text', text: 'Hi' }];

/** One document search, then the answer. */
const SEARCH: readonly MessagePart[] = [
  {
    type: 'tool-call',
    callId: 'call-1',
    capabilityId: 'search_documents',
    input: { query: 'leave policy' },
  },
  {
    type: 'tool-result',
    callId: 'call-1',
    capabilityId: 'search_documents',
    output: { hits: 3 },
    structured: true,
  },
];

/** The review's example (#4493 review 5445512947): setup 0.3 s, the tool
 * call after 1.5 s, a 4 s document search, then the answer's first token
 * 1 s into its round, and 2 s of writing. */
const SEARCH_THEN_ANSWER = {
  setupMs: 300,
  timeToFirstTokenMs: 6800,
  durationMs: 8800,
  outputTokens: 300,
};

describe('replyPhases', () => {
  it('splits a reasoning reply into its four consecutive phases', () => {
    expect(
      replyPhases(
        {
          setupMs: 120,
          timeToFirstReasoningMs: 400,
          timeToFirstTokenMs: 1400,
          durationMs: 3400,
        },
        ANSWER,
      ),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 120 },
      { kind: 'waiting', startMs: 120, durationMs: 280 },
      { kind: 'thinking', startMs: 400, durationMs: 1000 },
      { kind: 'writing', startMs: 1400, durationMs: 2000 },
    ]);
  });

  it('waits straight into writing when the model did not think first', () => {
    expect(
      replyPhases(
        { setupMs: 30, timeToFirstTokenMs: 450, durationMs: 2000 },
        ANSWER,
      ),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 30 },
      { kind: 'waiting', startMs: 30, durationMs: 420 },
      { kind: 'writing', startMs: 450, durationMs: 1550 },
    ]);
  });

  it('starts at the reply when no setup anchor was stamped', () => {
    expect(
      replyPhases({ timeToFirstTokenMs: 450, durationMs: 2000 }, ANSWER),
    ).toEqual([
      { kind: 'waiting', startMs: 0, durationMs: 450 },
      { kind: 'writing', startMs: 450, durationMs: 1550 },
    ]);
  });

  it('thinks until the settle when no answer token arrived', () => {
    expect(
      replyPhases(
        {
          setupMs: 50,
          timeToFirstReasoningMs: 200,
          durationMs: 900,
        },
        ANSWER,
      ),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 50 },
      { kind: 'waiting', startMs: 50, durationMs: 150 },
      { kind: 'thinking', startMs: 200, durationMs: 700 },
    ]);
  });

  it('drops a phase whose bounds are out of order instead of guessing', () => {
    // Reasoning stamped after the first token: no thinking phase before it.
    expect(
      replyPhases(
        {
          timeToFirstReasoningMs: 900,
          timeToFirstTokenMs: 500,
          durationMs: 800,
        },
        ANSWER,
      ),
    ).toEqual([
      { kind: 'waiting', startMs: 0, durationMs: 500 },
      { kind: 'writing', startMs: 500, durationMs: 300 },
    ]);
  });

  it('has nothing to draw without a settle or a first token', () => {
    expect(replyPhases({}, ANSWER)).toEqual([]);
    expect(replyPhases({ setupMs: 40 }, ANSWER)).toEqual([]);
  });

  it('draws a tool round as the model and its tools, never as waiting', () => {
    // Was: waiting 6.5 s, of which the search spent 4 s.
    expect(
      replyPhases(SEARCH_THEN_ANSWER, [
        ...SEARCH,
        { type: 'text', text: 'Three policies apply.' },
      ]),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 300 },
      { kind: 'tools', startMs: 300, durationMs: 6500 },
      { kind: 'writing', startMs: 6800, durationMs: 2000 },
    ]);
  });

  it('does not draw thinking across the tools when the model reasoned first', () => {
    // Was: thinking 6 s, from the first round's reasoning to the answer.
    expect(
      replyPhases({ ...SEARCH_THEN_ANSWER, timeToFirstReasoningMs: 800 }, [
        { type: 'reasoning', text: 'I should search.' },
        ...SEARCH,
        { type: 'text', text: 'Three policies apply.' },
      ]),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 300 },
      { kind: 'tools', startMs: 300, durationMs: 6500 },
      { kind: 'writing', startMs: 6800, durationMs: 2000 },
    ]);
  });

  it('has no writing phase when the first text came before the tools', () => {
    // The first token is the round-1 preamble, so the span after it holds
    // the search as well.
    expect(
      replyPhases(
        { setupMs: 300, timeToFirstTokenMs: 1000, durationMs: 8800 },
        [
          { type: 'text', text: 'Let me look that up.' },
          ...SEARCH,
          { type: 'text', text: 'Three policies apply.' },
        ],
      ),
    ).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 300 },
      { kind: 'tools', startMs: 300, durationMs: 8500 },
    ]);
  });

  it('runs the tools phase to the settle when no answer followed', () => {
    expect(replyPhases({ setupMs: 300, durationMs: 5800 }, SEARCH)).toEqual([
      { kind: 'preparing', startMs: 0, durationMs: 300 },
      { kind: 'tools', startMs: 300, durationMs: 5500 },
    ]);
  });
});

describe('outputTokensPerSecond', () => {
  it('counts from the first answer token to the settle', () => {
    expect(
      outputTokensPerSecond(
        {
          outputTokens: 200,
          timeToFirstTokenMs: 450,
          durationMs: 2000,
        },
        ANSWER,
      ),
    ).toBeCloseTo(129.03, 1);
  });

  it('counts from the first reasoning delta when the model thought first', () => {
    // Reasoning tokens are part of the output count, so the window starts
    // where they did.
    expect(
      outputTokensPerSecond(
        {
          outputTokens: 300,
          timeToFirstReasoningMs: 500,
          timeToFirstTokenMs: 1500,
          durationMs: 3500,
        },
        ANSWER,
      ),
    ).toBe(100);
  });

  it('has no speed without a window or a count', () => {
    expect(
      outputTokensPerSecond(
        {
          outputTokens: 18,
          timeToFirstTokenMs: 2410,
          durationMs: 2410,
        },
        ANSWER,
      ),
    ).toBeUndefined();
    expect(
      outputTokensPerSecond(
        { timeToFirstTokenMs: 10, durationMs: 100 },
        ANSWER,
      ),
    ).toBeUndefined();
    expect(outputTokensPerSecond({ outputTokens: 18 }, ANSWER)).toBeUndefined();
  });

  it('has no speed for a reply that ran tools', () => {
    // The count sums every round, and nothing bounds the answer round: the
    // window from the first reasoning delta held the 4 s search (was 37.5).
    expect(
      outputTokensPerSecond(
        { ...SEARCH_THEN_ANSWER, timeToFirstReasoningMs: 800 },
        [
          { type: 'reasoning', text: 'I should search.' },
          ...SEARCH,
          { type: 'text', text: 'Three policies apply.' },
        ],
      ),
    ).toBeUndefined();
    expect(
      outputTokensPerSecond(SEARCH_THEN_ANSWER, [
        ...SEARCH,
        { type: 'text', text: 'Three policies apply.' },
      ]),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { buildMessageSegments } from './build-message-segments';
import { hasInFlightTool, hasThoughtSteps } from './thought-predicates';

describe('hasThoughtSteps (cheap predicate parity with buildMessageSegments)', () => {
  const cases: unknown[][] = [
    [],
    [{ type: 'text', text: 'answer' }],
    [{ type: 'step-start' }],
    [{ type: 'reasoning', text: 'x', state: 'done' }],
    [{ type: 'reasoning', text: '', state: 'done' }], // redacted still a step
    [{ type: 'tool-web', toolCallId: 't', state: 'output-available' }],
    [{ type: 'tool-invocation', toolCallId: 't', state: 'input-available' }], // skipped
    [{ type: 'tool-', toolCallId: 't', state: 'input-available' }], // skipped
    [
      { type: 'file', url: 'x' },
      { type: 'tool-rag_search', toolCallId: 't' },
    ],
  ];

  it('matches "has a non-text segment" for every shape', () => {
    for (const parts of cases) {
      const expected = buildMessageSegments(parts).segments.some(
        (s) => s.kind !== 'text',
      );
      expect(hasThoughtSteps(parts)).toBe(expected);
    }
  });

  it('returns false for undefined', () => {
    expect(hasThoughtSteps(undefined)).toBe(false);
  });
});

describe('hasInFlightTool', () => {
  it('is true while a tool is providing input', () => {
    expect(
      hasInFlightTool([
        { type: 'tool-web', toolCallId: 't', state: 'input-streaming' },
      ]),
    ).toBe(true);
    expect(
      hasInFlightTool([
        { type: 'tool-web', toolCallId: 't', state: 'input-available' },
      ]),
    ).toBe(true);
  });

  it('is false once the tool has produced output or errored', () => {
    expect(
      hasInFlightTool([
        { type: 'tool-web', toolCallId: 't', state: 'output-available' },
      ]),
    ).toBe(false);
    expect(
      hasInFlightTool([
        { type: 'tool-web', toolCallId: 't', state: 'output-error' },
      ]),
    ).toBe(false);
  });

  it('ignores the generic tool-invocation placeholder and non-tool parts', () => {
    expect(
      hasInFlightTool([
        { type: 'tool-invocation', toolCallId: 't', state: 'input-available' },
        { type: 'reasoning', text: 'x', state: 'streaming' },
      ]),
    ).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasInFlightTool(undefined)).toBe(false);
  });
});

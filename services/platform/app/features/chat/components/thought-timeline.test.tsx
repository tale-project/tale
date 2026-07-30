import { describe, expect, it } from 'vitest';

import type { MessagePart } from '../types';
import { buildTimelineEntries, liveReasoningTail } from './thought-timeline';

/**
 * The timeline's contract is ORDER and STATE: entries come out exactly as
 * the parts were authored, a call without its result is running only while
 * the turn streams, and the live reasoning tail is whatever the combined
 * reasoning carries beyond the settled segments.
 */

const toolExchange: MessagePart[] = [
  { type: 'reasoning', text: 'Need the page.' },
  { type: 'text', text: 'Let me check.' },
  {
    type: 'tool-call',
    callId: 'c1',
    capabilityId: 'web_fetch',
    input: { url: 'https://example.com' },
  },
  {
    type: 'tool-result',
    callId: 'c1',
    capabilityId: 'web_fetch',
    output: { status: 'ok' },
    structured: true,
  },
];

describe('buildTimelineEntries', () => {
  it('keeps authored order and pairs calls with their results', () => {
    const entries = buildTimelineEntries(toolExchange, { isStreaming: false });
    expect(entries).toEqual([
      { kind: 'reasoning', key: 'reasoning:0', text: 'Need the page.' },
      {
        kind: 'step',
        key: 'step:c1',
        tool: 'web_fetch',
        detail: 'https://example.com',
        state: 'done',
      },
    ]);
  });

  it('marks an unanswered call running only while the turn streams', () => {
    const pending: MessagePart[] = [
      {
        type: 'tool-call',
        callId: 'c2',
        capabilityId: 'rag_search',
        input: { query: 'returns' },
      },
    ];
    expect(
      buildTimelineEntries(pending, { isStreaming: true })[0],
    ).toMatchObject({ state: 'running', detail: 'returns' });
    // A settled row has nothing to wait for — never a stuck spinner.
    expect(
      buildTimelineEntries(pending, { isStreaming: false })[0],
    ).toMatchObject({ state: 'done' });
  });

  it('reads a structured failure as a failed step', () => {
    const failed: MessagePart[] = [
      {
        type: 'tool-call',
        callId: 'c3',
        capabilityId: 'rag_fetch',
        input: { ref: 'file_9' },
      },
      {
        type: 'tool-result',
        callId: 'c3',
        capabilityId: 'rag_fetch',
        output: { status: 'not_found', message: 'nope' },
        structured: true,
      },
    ];
    expect(
      buildTimelineEntries(failed, { isStreaming: false })[0],
    ).toMatchObject({ state: 'failed' });
  });

  it('appends the live reasoning tail as the trailing entry', () => {
    const entries = buildTimelineEntries(toolExchange, {
      isStreaming: true,
      liveReasoningTail: 'Now the title…',
    });
    expect(entries.at(-1)).toEqual({
      kind: 'reasoning',
      key: 'reasoning:tail',
      text: 'Now the title…',
    });
  });
});

describe('liveReasoningTail', () => {
  it('returns what the combined reasoning carries beyond the settled parts', () => {
    expect(
      liveReasoningTail(toolExchange, 'Need the page.\n\nNow the title…'),
    ).toBe('Now the title…');
  });

  it('is the whole reasoning when nothing settled yet', () => {
    expect(liveReasoningTail([], 'Thinking…')).toBe('Thinking…');
  });

  it('is empty when the combined reasoning IS the settled reasoning', () => {
    expect(liveReasoningTail(toolExchange, 'Need the page.')).toBeUndefined();
  });
});

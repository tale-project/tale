import { describe, expect, it } from 'vitest';

import type { ChatGenerationView, ChatMessageView } from '../types';
import {
  createThreadViewState,
  reduceThreadView,
  type ThreadViewInputs,
} from './thread-view-core';

function row(
  overrides: Partial<ChatMessageView> & { id: string },
): ChatMessageView {
  return {
    role: 'assistant',
    parts: [],
    sequence: 0,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function textRow(
  id: string,
  text: string,
  overrides: Partial<ChatMessageView> = {},
): ChatMessageView {
  return row({
    id,
    parts: text.length > 0 ? [{ type: 'text', text }] : [],
    ...overrides,
  });
}

const STREAMING: ChatGenerationView = { status: 'streaming', messageId: 'a2' };

function inputs(overrides: Partial<ThreadViewInputs>): ThreadViewInputs {
  return {
    messages: undefined,
    generation: undefined,
    generationText: undefined,
    ...overrides,
  };
}

describe('reduceThreadView', () => {
  const thread = (assistantText = '') => [
    textRow('u1', 'question', { role: 'user', sequence: 1 }),
    textRow('a2', assistantText, { sequence: 2 }),
  ];

  it('serves the streamed text while the message row is still empty', () => {
    const state = createThreadViewState();
    const view = reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello wor' },
      }),
    );

    const live = view.items.at(-1);
    expect(live).toMatchObject({
      id: 'a2',
      text: 'Hello wor',
      isStreaming: true,
      isFinalReveal: false,
    });
    expect(view.streamingMessageId).toBe('a2');
  });

  it('prefers the row text once the finalize write landed', () => {
    const state = createThreadViewState();
    reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello' },
      }),
    );
    const view = reduceThreadView(
      state,
      inputs({
        messages: thread('Hello world.'),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello' },
      }),
    );

    expect(view.items.at(-1)?.text).toBe('Hello world.');
  });

  it('latches the streaming flag across a generation loading gap', () => {
    const state = createThreadViewState();
    reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello' },
      }),
    );
    // The cache-less generation read re-enters loading (undefined): the held
    // value keeps the row streaming, and the held text keeps the bubble full.
    const view = reduceThreadView(
      state,
      inputs({ messages: thread(), generation: undefined }),
    );

    expect(view.items.at(-1)).toMatchObject({
      text: 'Hello',
      isStreaming: true,
    });
  });

  it('never lets the streamed text shrink mid-stream', () => {
    const state = createThreadViewState();
    reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello world' },
      }),
    );
    // A reconnect can deliver a shorter committed prefix for a beat.
    const view = reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello' },
      }),
    );

    expect(view.items.at(-1)?.text).toBe('Hello world');
  });

  it('holds the streamed text through the settle gap, then drains on finalize', () => {
    const state = createThreadViewState();
    reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello world.' },
      }),
    );

    // Generation row deleted, finalize not yet visible: keep streaming.
    const gap = reduceThreadView(
      state,
      inputs({ messages: thread(), generation: null, generationText: null }),
    );
    expect(gap.items.at(-1)).toMatchObject({
      text: 'Hello world.',
      isStreaming: true,
    });

    // Finalize lands: settled, and the reveal is marked to drain out.
    const settled = reduceThreadView(
      state,
      inputs({
        messages: thread('Hello world.'),
        generation: null,
        generationText: null,
      }),
    );
    expect(settled.items.at(-1)).toMatchObject({
      text: 'Hello world.',
      isStreaming: false,
      isFinalReveal: true,
    });
  });

  it('presents an unsettled trailing placeholder as streaming before the generation resolves', () => {
    const state = createThreadViewState();
    const view = reduceThreadView(state, inputs({ messages: thread() }));

    expect(view.items.at(-1)?.isStreaming).toBe(true);
  });

  it('keeps row references for rows a push did not change', () => {
    const state = createThreadViewState();
    const first = reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hel' },
      }),
    );
    const second = reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Hello wor' },
      }),
    );

    expect(Object.is(first.items[0], second.items[0])).toBe(true);
    expect(Object.is(first.items[1], second.items[1])).toBe(false);
  });

  it('keeps the array reference when nothing changed', () => {
    const state = createThreadViewState();
    // Each call builds fresh row objects with identical content — the shape
    // of a Convex push re-materializing an unchanged result.
    const settledThread = () => [
      textRow('u1', 'question', { role: 'user', sequence: 1 }),
      textRow('a2', 'answer', {
        sequence: 2,
        usage: { totalTokens: 5 },
      }),
    ];
    const first = reduceThreadView(
      state,
      inputs({ messages: settledThread(), generation: null }),
    );
    const second = reduceThreadView(
      state,
      inputs({ messages: settledThread(), generation: null }),
    );

    expect(Object.is(first.items, second.items)).toBe(true);
  });

  it('carries the streamed reasoning text on the live row', () => {
    const state = createThreadViewState();
    const view = reduceThreadView(
      state,
      inputs({
        messages: thread(),
        generation: STREAMING,
        generationText: {
          messageId: 'a2',
          text: 'Hello',
          reasoning: 'Let me think.',
        },
      }),
    );

    expect(view.items.at(-1)?.reasoningText).toBe('Let me think.');
  });
});

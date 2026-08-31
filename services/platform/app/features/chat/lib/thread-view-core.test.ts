import { describe, expect, it } from 'vitest';

import type { ChatGenerationView, ChatMessageView } from '../types';
import { createPendingSend } from '../utils/pending-messages';
import {
  createThreadViewState,
  reduceThreadView,
  resolveHeldItems,
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

  it('appends a fresh tool-round tail to the settled parts text', () => {
    const state = createThreadViewState();
    const midLoopRow = row({
      id: 'a2',
      sequence: 2,
      parts: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool-call',
          callId: 'c1',
          capabilityId: 'rag_search',
          input: { query: 'returns' },
        },
        {
          type: 'tool-result',
          callId: 'c1',
          capabilityId: 'rag_search',
          output: { hits: 1 },
          structured: true,
        },
      ],
    });
    const view = reduceThreadView(
      state,
      inputs({
        messages: [
          textRow('u1', 'question', { role: 'user', sequence: 1 }),
          midLoopRow,
        ],
        generation: STREAMING,
        generationText: { messageId: 'a2', text: 'Found it: 30 days' },
      }),
    );

    // The settled round's text and the current round's tail, in order —
    // never one replacing the other.
    expect(view.items.at(-1)).toMatchObject({
      text: 'Let me check.\n\nFound it: 30 days',
      isStreaming: true,
    });
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

  describe('view-swap hold', () => {
    const heldItems = () => {
      const state = createThreadViewState();
      return reduceThreadView(
        state,
        inputs({ messages: thread('old answer'), generation: null }),
      ).items;
    };

    it('serves the previous rows while the next sibling loads', () => {
      const held = heldItems();
      expect(
        resolveHeldItems({ loading: true, currentItems: [], heldItems: held }),
      ).toBe(held);
    });

    it('appends the optimistic overlay rows to the held transcript', () => {
      const held = heldItems();
      const state = createThreadViewState();
      const pendingEdit = createPendingSend({
        text: 'An edited question',
        sentAt: 1_700_000_200_000,
        threadId: 'branch-1',
        baselineSequence: -1,
      });
      const overlayOnly = reduceThreadView(
        state,
        inputs({ pending: pendingEdit }),
      ).items;

      const merged = resolveHeldItems({
        loading: true,
        currentItems: overlayOnly,
        heldItems: held,
      });
      expect(merged?.map((item) => item.key)).toEqual([
        'u1',
        'a2',
        pendingEdit.key,
        pendingEdit.shellKey,
      ]);
    });

    it('steps aside as soon as real rows land', () => {
      const held = heldItems();
      expect(
        resolveHeldItems({
          loading: true,
          currentItems: heldItems(),
          heldItems: held,
        }),
      ).toBeUndefined();
      expect(
        resolveHeldItems({ loading: false, currentItems: [], heldItems: held }),
      ).toBeUndefined();
    });
  });

  describe('optimistic send overlay', () => {
    const pending = createPendingSend({
      text: 'A new question',
      sentAt: 1_700_000_100_000,
      threadId: 't1',
      baselineSequence: 2,
    });

    it('shows the pending bubble and thinking shell before any server row', () => {
      const state = createThreadViewState();
      const view = reduceThreadView(
        state,
        inputs({ messages: thread('old answer'), generation: null, pending }),
      );

      const keys = view.items.map((item) => item.key);
      expect(keys).toEqual(['u1', 'a2', pending.key, pending.shellKey]);
      expect(view.items.at(-1)).toMatchObject({
        role: 'assistant',
        isStreaming: true,
        isPendingShell: true,
      });
      expect(view.pendingConsumed).toBe(false);
    });

    it('adopts the real rows into the overlay keys — no remount, no duplicates', () => {
      const state = createThreadViewState();
      reduceThreadView(
        state,
        inputs({ messages: thread('old answer'), generation: null, pending }),
      );

      // The server wrote the user turn and the assistant placeholder.
      const grown = [
        ...thread('old answer'),
        textRow('u3', 'A new question', { role: 'user', sequence: 3 }),
        textRow('a4', '', { sequence: 4 }),
      ];
      const view = reduceThreadView(
        state,
        inputs({
          messages: grown,
          generation: { status: 'streaming', messageId: 'a4' },
          generationText: { messageId: 'a4', text: '' },
          pending,
        }),
      );

      // Real rows carry the overlay keys; the overlay rows are gone.
      const keys = view.items.map((item) => item.key);
      expect(keys).toEqual(['u1', 'a2', pending.key, pending.shellKey]);
      const adoptedUser = view.items[2];
      const adoptedShell = view.items[3];
      expect(adoptedUser).toMatchObject({ id: 'u3', role: 'user' });
      expect(adoptedShell).toMatchObject({
        id: 'a4',
        role: 'assistant',
        isStreaming: true,
      });
      expect(view.pendingConsumed).toBe(true);
    });

    it('never lets a pre-send row with the same text claim the overlay', () => {
      const state = createThreadViewState();
      const repeat = [
        textRow('u1', 'A new question', { role: 'user', sequence: 1 }),
        textRow('a2', 'first answer', { sequence: 2 }),
      ];
      const view = reduceThreadView(
        state,
        inputs({ messages: repeat, generation: null, pending }),
      );

      // sequence 1 is at/below the baseline — the overlay stays visible.
      expect(view.items.map((item) => item.key)).toEqual([
        'u1',
        'a2',
        pending.key,
        pending.shellKey,
      ]);
      expect(view.pendingConsumed).toBe(false);
    });
  });

  describe('synthesized live row (fresh send, transcript not yet refetched)', () => {
    const pending = createPendingSend({
      text: 'A new question',
      sentAt: 1_700_000_100_000,
      threadId: 't1',
      baselineSequence: 2,
    });

    it('streams onto the shell key while the placeholder row is absent', () => {
      const state = createThreadViewState();
      reduceThreadView(
        state,
        inputs({ messages: thread('old answer'), generation: null, pending }),
      );

      // The turn started server-side; the message list was NOT refetched.
      const view = reduceThreadView(
        state,
        inputs({
          messages: thread('old answer'),
          generation: { status: 'streaming', messageId: 'a4' },
          generationText: { messageId: 'a4', text: 'Hel' },
          pending,
        }),
      );

      expect(view.items.map((item) => item.key)).toEqual([
        'u1',
        'a2',
        pending.key,
        pending.shellKey,
      ]);
      expect(view.items.at(-1)).toMatchObject({
        id: 'a4',
        role: 'assistant',
        text: 'Hel',
        isStreaming: true,
      });
      // The user bubble is still the overlay's — adoption waits for rows.
      expect(view.pendingConsumed).toBe(false);

      const grownText = reduceThreadView(
        state,
        inputs({
          messages: thread('old answer'),
          generation: { status: 'streaming', messageId: 'a4' },
          generationText: { messageId: 'a4', text: 'Hello wor' },
          pending,
        }),
      );
      expect(grownText.items.at(-1)?.text).toBe('Hello wor');
    });

    it('hands over to the settle refetch and drains, even when the idle signal lands first', () => {
      const state = createThreadViewState();
      reduceThreadView(
        state,
        inputs({ messages: thread('old answer'), generation: null, pending }),
      );
      reduceThreadView(
        state,
        inputs({
          messages: thread('old answer'),
          generation: { status: 'streaming', messageId: 'a4' },
          generationText: { messageId: 'a4', text: 'Hello world.' },
          pending,
        }),
      );

      // Production ordering: the stream settles (generation gone) BEFORE the
      // refetched rows arrive — the synthesized row holds the streamed text.
      const gap = reduceThreadView(
        state,
        inputs({
          messages: thread('old answer'),
          generation: null,
          generationText: null,
          pending,
        }),
      );
      expect(gap.items.at(-1)).toMatchObject({
        id: 'a4',
        text: 'Hello world.',
        isStreaming: true,
      });

      // The refetch lands: the real rows adopt the overlay keys, the
      // synthesized row retires, and the reveal drains instead of popping.
      const settled = reduceThreadView(
        state,
        inputs({
          messages: [
            ...thread('old answer'),
            textRow('u3', 'A new question', { role: 'user', sequence: 3 }),
            textRow('a4', 'Hello world.', { sequence: 4 }),
          ],
          generation: null,
          generationText: null,
          pending,
        }),
      );
      expect(settled.items.map((item) => item.key)).toEqual([
        'u1',
        'a2',
        pending.key,
        pending.shellKey,
      ]);
      expect(settled.items.at(-1)).toMatchObject({
        id: 'a4',
        text: 'Hello world.',
        isStreaming: false,
        isFinalReveal: true,
      });
      expect(settled.pendingConsumed).toBe(true);
    });

    it('synthesizes the live row for a mid-turn join with no overlay', () => {
      const state = createThreadViewState();
      const view = reduceThreadView(
        state,
        inputs({
          messages: thread('old answer'),
          generation: { status: 'streaming', messageId: 'a9' },
          generationText: {
            messageId: 'a9',
            text: 'Partial',
            serverNow: 1_700_000_300_000,
          },
        }),
      );

      expect(view.items.at(-1)).toMatchObject({
        id: 'a9',
        key: 'a9',
        role: 'assistant',
        text: 'Partial',
        isStreaming: true,
        createdAt: 1_700_000_300_000,
      });

      const settled = reduceThreadView(
        state,
        inputs({
          messages: [...thread('old answer'), textRow('a9', 'Partial done.')],
          generation: null,
          generationText: null,
        }),
      );
      expect(settled.items.filter((item) => item.id === 'a9')).toHaveLength(1);
      expect(settled.items.at(-1)).toMatchObject({
        id: 'a9',
        isStreaming: false,
        isFinalReveal: true,
      });
    });

    it('carries streamed tool parts on the synthesized row', () => {
      const state = createThreadViewState();
      const view = reduceThreadView(
        state,
        inputs({
          messages: thread('old answer'),
          generation: { status: 'streaming', messageId: 'a4' },
          generationText: {
            messageId: 'a4',
            text: '',
            parts: [
              {
                type: 'tool-call',
                callId: 'c1',
                capabilityId: 'rag_search',
                input: { query: 'returns' },
              },
            ],
          },
          pending,
        }),
      );

      expect(view.items.at(-1)?.parts).toMatchObject([
        { type: 'tool-call', callId: 'c1' },
      ]);
    });

    it('keeps item and array references across identical synthetic passes', () => {
      const state = createThreadViewState();
      const pass = () =>
        reduceThreadView(
          state,
          inputs({
            messages: thread('old answer'),
            generation: { status: 'streaming', messageId: 'a4' },
            generationText: { messageId: 'a4', text: 'Hello' },
            pending,
          }),
        );
      const first = pass();
      const second = pass();

      expect(Object.is(first.items, second.items)).toBe(true);
    });
  });
});

describe('optimistic send overlay — image attachments', () => {
  it('renders the sent images on the pending bubble, before any server row', () => {
    const pending = createPendingSend({
      text: 'what is this?',
      attachments: [
        {
          fileId: 'blob1',
          fileName: 'shot.png',
          fileType: 'image/png',
          fileSize: 4096,
        },
      ],
      sentAt: 1_700_000_200_000,
      threadId: 't1',
      baselineSequence: -1,
    });
    const view = reduceThreadView(
      createThreadViewState(),
      inputs({ messages: [], generation: null, pending }),
    );

    const bubble = view.items.find((item) => item.key === pending.key);
    expect(bubble?.parts).toEqual([
      { type: 'text', text: 'what is this?' },
      {
        type: 'attachment',
        name: 'shot.png',
        mediaType: 'image/png',
        fileId: 'blob1',
        sizeBytes: 4096,
      },
    ]);
  });
});

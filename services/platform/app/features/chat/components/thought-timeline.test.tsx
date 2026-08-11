// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import {
  buildTimelineEntries,
  liveReasoningTail,
  ThoughtTimeline,
} from './thought-timeline';

/**
 * The timeline's contract is ORDER and STATE: entries come out exactly as
 * the parts were authored, a call without its result is running only while
 * the turn streams, and the live reasoning tail is whatever the combined
 * reasoning carries beyond the settled segments. The header owns the
 * measured story: a stable ticking "Thinking · Ns" live, the latched
 * "Thought for Ns · N tools · M tokens" summary once settled — and it
 * renders for tool-only turns too.
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
    output: { status: 'ok', url: 'https://example.com', content: 'PAGE BODY' },
    structured: true,
  },
];

const toolOnlyExchange: MessagePart[] = toolExchange.filter(
  (part) => part.type !== 'reasoning',
);

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
        input: { url: 'https://example.com' },
        output: {
          status: 'ok',
          url: 'https://example.com',
          content: 'PAGE BODY',
        },
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

  // A tool that addresses the person is drawn as its own row, not as a step:
  // "Asking question" was a placeholder above a row already carrying the
  // question, the count and the outcome. Steps are for invisible work.
  it('leaves a question out of the steps entirely', () => {
    const paused: MessagePart[] = [
      {
        type: 'tool-call',
        callId: 'c4',
        capabilityId: 'ask_question',
        input: { questions: [{ id: 'purpose', question: 'Why?' }] },
      },
      {
        type: 'tool-result',
        callId: 'c4',
        capabilityId: 'ask_question',
        output: {
          status: 'awaiting-answer',
          requestId: 'approval_1',
          question: 'Who is Bergmann Logistics to you?',
        },
        structured: true,
      },
    ];
    expect(buildTimelineEntries(paused, { isStreaming: false })).toEqual([]);
  });

  it('still draws the invisible work beside it', () => {
    const mixed: MessagePart[] = [
      {
        type: 'tool-call',
        callId: 'c5',
        capabilityId: 'rag_search',
        input: { query: 'Bergmann' },
      },
      {
        type: 'tool-result',
        callId: 'c5',
        capabilityId: 'rag_search',
        output: { status: 'ok' },
        structured: true,
      },
      {
        type: 'tool-call',
        callId: 'c6',
        capabilityId: 'ask_question',
        input: {},
      },
    ];
    const entries = buildTimelineEntries(mixed, { isStreaming: false });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'rag_search' });
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

describe('ThoughtTimeline header', () => {
  afterEach(() => vi.restoreAllMocks());

  it('latches the quiet "Thought for Ns" once settled — counts stay in the info dialog', () => {
    render(
      <ThoughtTimeline
        parts={toolExchange}
        reasoningText="Need the page."
        active={false}
        isStreaming={false}
        usage={{ timeToFirstTokenMs: 4200, outputTokens: 128 }}
      />,
    );

    const label = screen.getByTestId('thought-timeline-label');
    expect(label).toHaveTextContent('Thought for 4s');
    expect(label).not.toHaveTextContent('tool');
    expect(label).not.toHaveTextContent('token');
  });

  it('keeps the settled header on a tool-only turn as a plain "Thought for Ns" strip', () => {
    render(
      <ThoughtTimeline
        parts={toolOnlyExchange}
        active={false}
        isStreaming={false}
        usage={{ timeToFirstTokenMs: 12_000 }}
      />,
    );

    // The live "Thinking · Ns" lands on its total instead of vanishing.
    const label = screen.getByTestId('thought-timeline-label');
    expect(label).toHaveTextContent('Thought for 12s');
    // No reasoning to reveal — the header is not a toggle.
    expect(label.closest('button')).toBeNull();
  });

  it('hides the header only when a tool-only turn measured nothing', () => {
    render(
      <ThoughtTimeline
        parts={toolOnlyExchange}
        active={false}
        isStreaming={false}
      />,
    );

    // Every candidate label would claim something that didn't happen; the
    // step rows carry the record alone.
    expect(screen.queryByTestId('thought-timeline-label')).toBeNull();
    expect(screen.getByText('Reading example.com')).toBeInTheDocument();
  });

  it('keeps the STABLE "Thinking" verb while a tool step runs', () => {
    const running: MessagePart[] = [
      {
        type: 'tool-call',
        callId: 'c1',
        capabilityId: 'web_fetch',
        input: { url: 'https://example.com' },
      },
    ];
    render(
      <ThoughtTimeline
        parts={running}
        active={false}
        isStreaming
        anchor={{
          clientStartMs: Date.now(),
          serverStartClientMs: null,
          reanchorKey: 'k',
        }}
      />,
    );

    // The header never flips to the running tool's title — the step row
    // below already attributes the wait.
    expect(screen.getByTestId('thought-timeline-label')).toHaveTextContent(
      /^Thinking$/,
    );
    expect(screen.getByText('Reading example.com')).toBeInTheDocument();
  });

  it('ticks the send-anchored seconds while pre-answer, from the first paint', () => {
    const now = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(
      <ThoughtTimeline
        parts={[{ type: 'reasoning', text: 'Hmm.' }]}
        reasoningText="Hmm."
        active
        isStreaming
        anchor={{
          clientStartMs: now - 3000,
          serverStartClientMs: null,
          reanchorKey: 'pending-assistant-1',
        }}
      />,
    );

    expect(screen.getByTestId('thought-timeline-label')).toHaveTextContent(
      'Thinking · 3s',
    );
  });
});

describe('ThoughtTimeline drill-down', () => {
  it('expands a step row to its full input and output', async () => {
    const { user } = render(
      <ThoughtTimeline
        parts={toolExchange}
        reasoningText="Need the page."
        active={false}
        isStreaming={false}
      />,
    );

    expect(screen.queryByText('PAGE BODY')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Reading example.com' }),
    );
    // The load-bearing argument verbatim, and the fetched content in full.
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('PAGE BODY')).toBeInTheDocument();
  });

  it('reveals the reasoning prose from the header toggle', async () => {
    const { user } = render(
      <ThoughtTimeline
        parts={toolExchange}
        reasoningText="Need the page."
        active={false}
        isStreaming={false}
      />,
    );

    expect(screen.queryByText('Need the page.')).toBeNull();
    // The header toggle (the step row is its own expandable button).
    await user.click(
      screen.getByRole('button', { name: /Showed its reasoning/ }),
    );
    expect(screen.getByText('Need the page.')).toBeInTheDocument();
  });
});

/**
 * A correctable error the model immediately fixed is not news. Showing the
 * discarded attempt put a red warning and a schema complaint in the
 * transcript of a turn that worked.
 */
describe('buildTimelineEntries — superseded failures', () => {
  function call(id: string, tool: string): MessagePart {
    return { type: 'tool-call', callId: id, capabilityId: tool, input: {} };
  }
  function result(id: string, tool: string, output: unknown): MessagePart {
    return {
      type: 'tool-result',
      callId: id,
      capabilityId: tool,
      output,
      structured: true,
    };
  }
  const BAD = { status: 'invalid_args', message: 'query must not be empty' };
  const GOOD = { status: 'ok', results: [] };

  it('hides a failed call that a later successful one replaced', () => {
    const entries = buildTimelineEntries(
      [
        call('c1', 'rag_search'),
        result('c1', 'rag_search', BAD),
        call('c2', 'rag_search'),
        result('c2', 'rag_search', GOOD),
      ],
      { isStreaming: false },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ tool: 'rag_search', state: 'done' });
  });

  // Hiding a retry is not the same as hiding an outcome: a failure nothing
  // recovered from still cost the reader something.
  it('keeps a failure that was never recovered', () => {
    const entries = buildTimelineEntries(
      [call('c1', 'rag_search'), result('c1', 'rag_search', BAD)],
      { isStreaming: false },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: 'failed' });
  });

  it('keeps a failure that came AFTER the success', () => {
    const entries = buildTimelineEntries(
      [
        call('c1', 'rag_search'),
        result('c1', 'rag_search', GOOD),
        call('c2', 'rag_search'),
        result('c2', 'rag_search', BAD),
      ],
      { isStreaming: false },
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ state: 'failed' });
  });

  // Only the SAME tool recovers itself.
  it('does not let one tool cover another tool’s failure', () => {
    const entries = buildTimelineEntries(
      [
        call('c1', 'rag_fetch'),
        result('c1', 'rag_fetch', BAD),
        call('c2', 'rag_search'),
        result('c2', 'rag_search', GOOD),
      ],
      { isStreaming: false },
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ tool: 'rag_fetch', state: 'failed' });
  });
});

/**
 * A turn that produced no visible text still took time.
 *
 * The header read `timeToFirstTokenMs`, which is time-to-first-VISIBLE-token
 * and is never stamped when a turn writes nothing — a turn that paused on a
 * question, say. A 28-second turn that had run three tools lost its header
 * entirely: no TTFT, no reasoning parts, not streaming.
 */
describe('ThoughtTimeline header on a turn with no answer', () => {
  const toolOnly: MessagePart[] = [
    {
      type: 'tool-call',
      callId: 'c1',
      capabilityId: 'rag_search',
      input: { query: 'Bergmann' },
    },
    {
      type: 'tool-result',
      callId: 'c1',
      capabilityId: 'rag_search',
      output: { status: 'ok' },
      structured: true,
    },
  ];

  it('reports the duration it did measure', () => {
    render(
      <ThoughtTimeline
        parts={toolOnly}
        active={false}
        isStreaming={false}
        usage={{ durationMs: 28_000 }}
      />,
    );
    expect(screen.getByTestId('thought-timeline-label')).toHaveTextContent(
      'Thought for 28s',
    );
  });

  // Time-to-first-token still wins when there IS an answer: that is the time
  // spent before answering, which is what the label claims.
  it('prefers time-to-first-token when the turn answered', () => {
    render(
      <ThoughtTimeline
        parts={toolOnly}
        active={false}
        isStreaming={false}
        usage={{ timeToFirstTokenMs: 4000, durationMs: 28_000 }}
      />,
    );
    expect(screen.getByTestId('thought-timeline-label')).toHaveTextContent(
      'Thought for 4s',
    );
  });
});

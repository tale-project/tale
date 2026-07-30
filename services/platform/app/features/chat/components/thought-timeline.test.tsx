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

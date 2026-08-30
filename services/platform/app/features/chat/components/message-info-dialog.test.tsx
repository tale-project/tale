// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { ChatMessageView } from '../types';

/** What the mocked voice-usage query answers with; `skip` stays loading so
 * the no-thread gate is observable. */
const voiceUsage = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('../data/chat-backend', () => ({
  useChatQueryClient: () => ({}) as never,
}));
// The voice-usage read is HTTP now; feed it through react-query's mock.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { enabled?: boolean }) =>
    options.enabled === false
      ? { data: undefined }
      : { data: voiceUsage.current ?? null },
}));

import { MessageInfoDialog } from './message-info-dialog';

const MESSAGE: ChatMessageView = {
  id: 'm1',
  role: 'assistant',
  sequence: 3,
  createdAt: 1_717_000_000_000,
  model: 'claude-fable-5',
  providerSlug: 'anthropic',
  usage: {
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    reasoningTokens: 64,
    cachedInputTokens: 250,
    costEstimateCents: 1.23,
    durationMs: 2000,
    timeToFirstTokenMs: 450,
  },
  parts: [
    {
      type: 'tool-call',
      callId: 'call_1',
      capabilityId: 'rag_search',
      input: { query: 'returns' },
    },
    {
      type: 'tool-result',
      callId: 'call_1',
      capabilityId: 'rag_search',
      output: { status: 'ok', hits: 2 },
      structured: true,
    },
    { type: 'text', text: 'The answer.' },
  ],
};

describe('MessageInfoDialog', () => {
  beforeEach(() => {
    voiceUsage.current = undefined;
  });

  it('renders the recorded facts: model badge, tokens, cost, timings', async () => {
    const { baseElement } = render(
      <MessageInfoDialog
        message={MESSAGE}
        threadId="t-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: /Message information/ }),
    ).toBeInTheDocument();
    // Model as a badge with the provider alongside.
    expect(screen.getByText('claude-fable-5')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    // Locale-aware token counts, including the cached row.
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
    // The cost cell renders sub-dollar cents with significant digits.
    expect(screen.getByText('$0.0123')).toBeInTheDocument();
    // Performance: server interval labels, TTFT, derived throughput.
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('Start → first token')).toBeInTheDocument();
    expect(screen.getByText('Start → done')).toBeInTheDocument();
    expect(screen.queryByText('Your wait')).toBeNull();
    expect(screen.getByText('2.00 s')).toBeInTheDocument();
    expect(screen.getByText('450 ms')).toBeInTheDocument();
    expect(screen.getByText('129 tok/s')).toBeInTheDocument();
    // The field stack must grow with the clocks — overflow-hidden on a
    // flex child zeroes min-height and clips throughput / the hint.
    expect(screen.getByText('129 tok/s').closest('.shrink-0')).not.toHaveClass(
      'overflow-hidden',
    );
    // Relative time renders under the absolute timestamp.
    expect(screen.getByText(/ago$/)).toBeInTheDocument();

    // The design-system pattern puts an h2 dialog title above h4 field
    // labels, so the heading-order rule is off — everything else audits.
    await checkAccessibility(baseElement, {
      rules: { 'heading-order': { enabled: false } },
    });
  });

  it('renders one card per tool call with its input and output', () => {
    render(
      <MessageInfoDialog
        message={MESSAGE}
        threadId="t-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('rag_search')).toBeInTheDocument();
    expect(screen.getByText('{"query":"returns"}')).toBeInTheDocument();
    expect(screen.getByText('{"status":"ok","hits":2}')).toBeInTheDocument();
  });

  it('shows the voice-output breakdown when the thread has TTS usage', () => {
    voiceUsage.current = {
      totalCharacters: 500,
      totalCostCents: 3,
      chunkCount: 2,
      breakdown: [
        {
          provider: 'openai',
          model: 'tts-1',
          voice: 'nova',
          characters: 500,
          costCents: 3,
          chunkCount: 2,
        },
      ],
    };

    render(
      <MessageInfoDialog
        message={MESSAGE}
        threadId="t-1"
        organizationId="org-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('tts-1')).toBeInTheDocument();
    expect(screen.getByText('(openai)')).toBeInTheDocument();
    expect(screen.getByText(/nova/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.03/)).toBeInTheDocument();
  });

  it('skips the voice-usage read without a thread', () => {
    voiceUsage.current = {
      totalCharacters: 500,
      totalCostCents: 3,
      chunkCount: 2,
      breakdown: [
        {
          provider: 'openai',
          model: 'tts-1',
          characters: 500,
          costCents: 3,
          chunkCount: 2,
        },
      ],
    };

    render(<MessageInfoDialog message={MESSAGE} open onOpenChange={vi.fn()} />);

    expect(screen.queryByText('tts-1')).toBeNull();
  });

  it('hides what a turn did not record and keeps the error trail', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          parts: [{ type: 'text', text: 'partial' }],
          usage: { inputTokens: 10 },
          error: 'the provider exploded',
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Start → first token')).toBeNull();
    expect(screen.queryByText('Performance')).toBeNull();
    expect(screen.queryByText('$0.0123')).toBeNull();
    expect(screen.getByText('the provider exploded')).toBeInTheDocument();
  });

  it('falls back to the no-metadata notice when nothing was recorded', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          model: undefined,
          providerSlug: undefined,
          usage: undefined,
          parts: [{ type: 'text', text: 'plain' }],
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'Token usage and model information are not available for this message.',
      ),
    ).toBeInTheDocument();
  });

  it('drills into the TTFT breakdown and comes back', async () => {
    const { user } = render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          usage: {
            ...MESSAGE.usage,
            setupMs: 120,
            timeToFirstReasoningMs: 300,
          },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    // The headline TTFT cell is the doorway once breakdown anchors exist.
    await user.click(screen.getByRole('button', { name: '450 ms' }));

    expect(
      screen.getByRole('heading', { name: 'Start → first token — details' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Setup before model')).toBeInTheDocument();
    expect(screen.getByText('120 ms')).toBeInTheDocument();
    expect(screen.getByText('Time to first reasoning')).toBeInTheDocument();
    expect(screen.getByText('300 ms')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'Message information' }),
    ).toBeInTheDocument();
  });

  it('keeps the TTFT cell inert without breakdown anchors', () => {
    render(<MessageInfoDialog message={MESSAGE} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('450 ms')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '450 ms' })).toBeNull();
  });

  it('shows Send → first words when the watching browser stamped it', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          usage: { ...MESSAGE.usage, perceivedWaitMs: 6400 },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Your wait')).toBeInTheDocument();
    expect(screen.getByText('Send → first words')).toBeInTheDocument();
    expect(screen.getByText('6.40 s')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('Start → done')).toBeInTheDocument();
    expect(screen.getByText('Start → first token')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Your wait starts when you send. Server times start when the reply begins, so the first number can be larger.',
      ),
    ).toBeInTheDocument();
  });

  it('hides Send → first words and throughput when those clocks are absent or empty', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          usage: {
            durationMs: 2410,
            timeToFirstTokenMs: 2410,
            outputTokens: 18,
          },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Your wait')).toBeNull();
    expect(screen.queryByText('Send → first words')).toBeNull();
    expect(screen.queryByText(/tok\/s/)).toBeNull();
    expect(screen.queryByText(/Your wait starts when you send/)).toBeNull();
    expect(screen.getByText('Start → first token')).toBeInTheDocument();
    expect(screen.getByText('Start → done')).toBeInTheDocument();
    expect(screen.getAllByText('2.41 s')).toHaveLength(2);
  });
});

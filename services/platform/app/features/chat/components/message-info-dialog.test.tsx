// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { ChatMessageView } from '../types';

/** What the mocked voice-usage query answers with; `skip` stays loading so
 * the no-thread gate is observable. */
const voiceUsage = vi.hoisted(() => ({ current: undefined as unknown }));
/** The names the mocked composer catalog gives the model and its provider. */
const catalogNames = vi.hoisted(() => ({
  current: {} as { model?: string; provider?: string },
}));

vi.mock('../data/chat-backend', () => ({
  useChatQueryClient: () => ({}) as never,
  useComposerModelNames: () => catalogNames.current,
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
    catalogNames.current = {};
  });

  it('renders the recorded facts: model, tokens, cost, timings', async () => {
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
    // The model by its id, with the provider row beside the location rows.
    expect(screen.getByText('claude-fable-5')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    // Locale-aware token counts: the total beside the heading, the cached
    // share on the input row, the reasoning share on the output row.
    expect(screen.getByText('1,200 total')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText(/250 cached \(25%\)/)).toBeInTheDocument();
    expect(screen.getByText(/64 reasoning/)).toBeInTheDocument();
    // The cost cell renders sub-dollar cents with significant digits.
    expect(screen.getByText('$0.0123')).toBeInTheDocument();
    // The headline timings and the derived output speed.
    expect(screen.getByText('Time to first token')).toBeInTheDocument();
    expect(screen.getByText('Total time')).toBeInTheDocument();
    expect(screen.getByText('2.00 s')).toBeInTheDocument();
    // TTFT heads the strip and, with no setup stamped, the whole wait
    // before the first token is the legend's waiting phase.
    expect(screen.getAllByText('450 ms')).toHaveLength(2);
    expect(screen.getByText('Output speed')).toBeInTheDocument();
    expect(screen.getByText('129 tok/s')).toBeInTheDocument();
    // The sections must grow with their content — overflow-hidden on a flex
    // child zeroes min-height and clips the timings.
    expect(screen.getByText('129 tok/s').closest('.shrink-0')).not.toHaveClass(
      'overflow-hidden',
    );
    // Nobody watched this reply arrive, so there is no client-side wait.
    expect(screen.queryByText(/On your screen/)).toBeNull();
    // Relative time renders beside the absolute timestamp.
    expect(screen.getByText(/ago$/)).toBeInTheDocument();

    await checkAccessibility(baseElement);
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

    expect(screen.queryByText('Time to first token')).toBeNull();
    expect(screen.queryByText('Performance')).toBeNull();
    expect(screen.queryByText('$0.0123')).toBeNull();
    expect(screen.queryByText(/total$/)).toBeNull();
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

  it('draws where the time went: preparing, waiting, thinking, writing', () => {
    render(
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

    const legend = screen.getByRole('list');
    expect(legend).toHaveTextContent('Preparing120 ms');
    expect(legend).toHaveTextContent('Waiting for the model180 ms');
    expect(legend).toHaveTextContent('Thinking150 ms');
    expect(legend).toHaveTextContent('Writing1.55 s');
  });

  it('says when the first words reached the screen, when someone watched', () => {
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

    expect(
      screen.getByText(
        'On your screen, the first words appeared 6.40 s after you sent.',
      ),
    ).toBeInTheDocument();
  });

  it('hides the output speed when the clocks leave no window', () => {
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

    expect(screen.queryByText(/tok\/s/)).toBeNull();
    expect(screen.queryByText('Output speed')).toBeNull();
    expect(screen.queryByText(/On your screen/)).toBeNull();
    expect(screen.getByText('Time to first token')).toBeInTheDocument();
    expect(screen.getByText('Total time')).toBeInTheDocument();
    expect(screen.getAllByText('2.41 s')).toHaveLength(2);
  });

  it('sizes the timing strip to the timings a turn recorded', () => {
    // An agent-runtime turn records its duration only.
    render(
      <MessageInfoDialog
        message={{ ...MESSAGE, usage: { durationMs: 5000 } }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Time to first token')).toBeNull();
    expect(screen.getByText('Total time').closest('dl')).toHaveClass(
      'grid-cols-1',
    );
  });

  it('names the model and provider as the catalog does, the id beneath', () => {
    catalogNames.current = { model: 'Claude Fable 5', provider: 'Anthropic' };
    render(
      <MessageInfoDialog
        message={MESSAGE}
        organizationId="org-1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Claude Fable 5')).toBeInTheDocument();
    expect(screen.getByText('claude-fable-5')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.queryByText('anthropic')).toBeNull();
  });

  it('shows where the reply ran as the provider reported it', async () => {
    const { baseElement } = render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          providerSlug: 'openrouter',
          usage: {
            ...MESSAGE.usage,
            serving: {
              providers: ['Google Vertex', 'Anthropic'],
              regions: ['Switzerland North'],
              models: ['claude-fable-5-20260115'],
            },
          },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Served by')).toBeInTheDocument();
    expect(screen.getByText('Google Vertex, Anthropic')).toBeInTheDocument();
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('Switzerland North')).toBeInTheDocument();
    expect(screen.queryByText('Not reported')).toBeNull();
    expect(screen.getByText('Model version')).toBeInTheDocument();
    expect(screen.getByText('claude-fable-5-20260115')).toBeInTheDocument();

    await checkAccessibility(baseElement);
  });

  it('reads the region codes a provider echoes as words', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          usage: { ...MESSAGE.usage, serving: { regions: ['global', 'us'] } },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Global, no fixed region, United States'),
    ).toBeInTheDocument();
  });

  it('names the region a regional endpoint set, and says so', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          providerSlug: 'eu-openrouter',
          usage: {
            ...MESSAGE.usage,
            serving: {
              providers: ['Mistral'],
              endpoint: { host: 'eu.openrouter.ai', region: 'europe' },
            },
          },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Europe')).toBeInTheDocument();
    expect(
      screen.getByText('Set by the regional endpoint eu.openrouter.ai'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Not reported')).toBeNull();
  });

  it('says a region was not reported instead of guessing one', () => {
    render(<MessageInfoDialog message={MESSAGE} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('Not reported')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Shown when the provider reports it or a regional endpoint sets it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Served by')).toBeNull();
    expect(screen.queryByText('Model version')).toBeNull();
  });

  it('drops what in the stored blob is not a usable value', () => {
    render(
      <MessageInfoDialog
        message={{
          ...MESSAGE,
          usage: {
            ...MESSAGE.usage,
            // The blob is free-form JSON the client never validated.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a malformed row, on purpose
            serving: {
              providers: [1, '', 'Groq'],
              endpoint: { host: 'eu.openrouter.ai', region: 'mars' },
            } as never,
          },
        }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Groq')).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    expect(screen.queryByText(/eu\.openrouter\.ai/)).toBeNull();
  });
});

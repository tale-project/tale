// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { toSettledItems } from '../lib/thread-view-core';

vi.mock('@/app/features/governance/components/data-notice-footer', () => ({
  DataNoticeFooter: () => <div data-testid="data-notice-footer" />,
}));
// Image-attachment parts resolve display URLs through a Convex query; this
// harness renders without a provider, so the seam answers inert.
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));
import type { ChatMessageView } from '../types';
import { MessageThread } from './message-thread';

const CONVERSATION: ChatMessageView[] = [
  {
    id: 'm1',
    role: 'user',
    sequence: 1,
    createdAt: 1,
    parts: [
      { type: 'text', text: 'Summarize the attached report.' },
      { type: 'attachment', name: 'report.pdf', mediaType: 'application/pdf' },
    ],
  },
  {
    id: 'm2',
    role: 'assistant',
    sequence: 2,
    createdAt: 2,
    parts: [
      { type: 'text', text: 'Reading it now.' },
      {
        type: 'tool-call',
        callId: 'c1',
        capabilityId: 'get_knowledge',
        input: {},
      },
      {
        type: 'tool-result',
        callId: 'c1',
        capabilityId: 'get_knowledge',
        output: {},
        structured: true,
      },
      {
        type: 'approval',
        approvalId: 'ap1',
        question: 'Send the summary by email?',
      },
      {
        // Resolved on purpose: the ask row is history, so it only renders
        // once the question has ended. A pending one is shown by the
        // composer, not the transcript.
        type: 'human-input',
        requestId: 'hi1',
        question: 'Which address?',
        outcome: 'answered',
      },
    ],
  },
];

describe('MessageThread', () => {
  it('renders every part of a message in authored order', () => {
    render(<MessageThread messages={toSettledItems(CONVERSATION)} />);

    const items = screen.getAllByRole('listitem');
    const assistant = items[1];
    const rendered = within(assistant)
      .getAllByText(/.+/)
      .map((node) => node.textContent);

    // Tool steps render in the thought timeline ABOVE the answer text (the
    // restored 0.3 layout); the remaining parts keep their authored order
    // below it.
    const order = [
      'Called get_knowledge',
      'Reading it now.',
      'Send the summary by email?',
      'Which address?',
    ];
    const positions = order.map((text) =>
      rendered.findIndex((value) => value === text),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('names an attachment part', () => {
    render(<MessageThread messages={toSettledItems(CONVERSATION)} />);

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('marks an undecided approval as pending and a decided one by its decision', () => {
    render(
      <MessageThread
        messages={toSettledItems([
          {
            ...CONVERSATION[1],
            parts: [
              {
                type: 'approval',
                approvalId: 'ap1',
                question: 'Send it?',
                decision: 'rejected',
              },
            ],
          },
        ])}
      />,
    );

    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByText('Approval requested')).toBeNull();
  });

  it('explains a message a guardrail stopped instead of showing an empty turn', () => {
    render(
      <MessageThread
        messages={toSettledItems([
          {
            id: 'm3',
            role: 'assistant',
            sequence: 3,
            createdAt: 3,
            parts: [],
            blockedReason: 'contained personal data',
          },
        ])}
      />,
    );

    // The taxonomy stays out of the transcript — the notice is generic; the
    // raw reason lives in the message info dialog.
    expect(
      screen.getByText(/blocked by your organization's content policy/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/contained personal data/)).toBeNull();
  });

  it('shows the welcome state for a conversation that has not started', () => {
    render(<MessageThread messages={[]} />);

    expect(
      screen.getByRole('heading', { name: 'What are we working on?' }),
    ).toBeInTheDocument();
  });
});

describe('MessageThread generation state', () => {
  it('says nothing while no turn is in flight', () => {
    render(
      <MessageThread
        messages={toSettledItems(CONVERSATION)}
        generation={null}
      />,
    );

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('announces the streaming turn politely', () => {
    render(
      <MessageThread
        messages={toSettledItems(CONVERSATION)}
        generation={{ status: 'streaming' }}
      />,
    );

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Writing the reply…');
  });

  it('says what a waiting turn is blocked on', () => {
    render(
      <MessageThread
        messages={toSettledItems(CONVERSATION)}
        generation={{ status: 'waiting-approval', waitingOn: 'an approval' }}
      />,
    );

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Waiting for your approval');
    expect(region).toHaveTextContent('an approval');
  });
});

describe('MessageThread transcript contract', () => {
  it('exposes the transcript as a labelled log with per-message testids', () => {
    render(<MessageThread messages={toSettledItems(CONVERSATION)} />);

    const log = screen.getByRole('log', { name: 'Message history' });
    const items = within(log).getAllByTestId('chat-message');
    expect(items.map((el) => el.dataset.messageRole)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('renders assistant text as markdown and user text as written', () => {
    render(
      <MessageThread
        messages={toSettledItems([
          {
            id: 'u1',
            role: 'user',
            sequence: 0,
            createdAt: 1,
            parts: [{ type: 'text', text: '**not markdown**' }],
          },
          {
            id: 'a1',
            role: 'assistant',
            sequence: 1,
            createdAt: 2,
            parts: [{ type: 'text', text: 'some **bold** text' }],
          },
        ])}
      />,
    );

    // The user's words render exactly as typed; the assistant's render.
    expect(screen.getByText('**not markdown**')).toBeInTheDocument();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('offers Copy and Show info under a settled assistant message', () => {
    render(<MessageThread messages={toSettledItems(CONVERSATION)} />);

    expect(screen.getByTestId('message-copy-button')).toBeInTheDocument();
    expect(screen.getByTestId('message-info-button')).toBeInTheDocument();
  });

  it('shows no toolbar while the reply is still streaming', () => {
    render(
      <MessageThread
        messages={[
          ...toSettledItems(CONVERSATION),
          {
            id: 'm9',
            key: 'm9',
            role: 'assistant',
            sequence: 9,
            createdAt: 9,
            parts: [],
            text: '',
            isStreaming: true,
            isFinalReveal: false,
          },
        ]}
        generation={{ status: 'queued', messageId: 'm9' }}
      />,
    );

    const items = screen.getAllByTestId('chat-message');
    const streaming = items.at(-1);
    if (!streaming) throw new Error('expected a streaming item');
    expect(within(streaming).queryByTestId('message-copy-button')).toBeNull();
    // The pre-first-byte gap carries exactly ONE live indicator: the shell.
    expect(
      within(streaming).getByTestId('thinking-gap-shell'),
    ).toBeInTheDocument();
    expect(within(streaming).queryByTestId('message-info-button')).toBeNull();
  });

  it('drops the gap shell the moment the thought timeline has content', () => {
    // Between tool rounds: steps exist, text is still empty. The timeline's
    // header is the one live indicator — a second "Thinking" pulse below it
    // reads as a glitch.
    render(
      <MessageThread
        messages={[
          ...toSettledItems(CONVERSATION),
          {
            id: 'm9',
            key: 'm9',
            role: 'assistant',
            sequence: 9,
            createdAt: 9,
            parts: [
              {
                type: 'tool-call',
                callId: 'call_1',
                capabilityId: 'web_fetch',
                input: { url: 'https://example.com' },
              },
            ],
            text: '',
            isStreaming: true,
            isFinalReveal: false,
          },
        ]}
        generation={{ status: 'streaming', messageId: 'm9' }}
      />,
    );

    const items = screen.getAllByTestId('chat-message');
    const streaming = items.at(-1);
    if (!streaming) throw new Error('expected a streaming item');
    expect(within(streaming).queryByTestId('thinking-gap-shell')).toBeNull();
  });

  it('keeps the gap shell while a short clause is held ("Paris.")', () => {
    render(
      <MessageThread
        messages={[
          ...toSettledItems(CONVERSATION),
          {
            id: 'm9',
            key: 'm9',
            role: 'assistant',
            sequence: 9,
            createdAt: 9,
            parts: [],
            text: 'Paris.',
            isStreaming: true,
            isFinalReveal: false,
          },
        ]}
        generation={{ status: 'streaming', messageId: 'm9' }}
      />,
    );

    const items = screen.getAllByTestId('chat-message');
    const streaming = items.at(-1);
    if (!streaming) throw new Error('expected a streaming item');
    expect(
      within(streaming).getByTestId('thinking-gap-shell'),
    ).toBeInTheDocument();
  });

  it('drops the gap shell once the first clause is revealed', () => {
    render(
      <MessageThread
        messages={[
          ...toSettledItems(CONVERSATION),
          {
            id: 'm9',
            key: 'm9',
            role: 'assistant',
            sequence: 9,
            createdAt: 9,
            parts: [],
            text: 'Hello there. ',
            isStreaming: false,
            isFinalReveal: true,
          },
        ]}
        generation={{ status: 'streaming', messageId: 'm9' }}
      />,
    );

    const items = screen.getAllByTestId('chat-message');
    const streaming = items.at(-1);
    if (!streaming) throw new Error('expected a streaming item');
    expect(within(streaming).queryByTestId('thinking-gap-shell')).toBeNull();
    expect(within(streaming).getByText(/Hello there/)).toBeInTheDocument();
  });
});

describe('MessageThread accessibility', () => {
  it('passes an axe audit', async () => {
    const { container } = render(
      <MessageThread
        messages={toSettledItems(CONVERSATION)}
        generation={{ status: 'streaming' }}
      />,
    );
    await waitFor(() => checkAccessibility(container));
  });
});

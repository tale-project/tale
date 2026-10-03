// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClockOffsetProvider,
  useReportServerNow,
} from '@/app/hooks/use-clock-offset';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { toSettledItems } from '../lib/thread-view-core';

// Image-attachment parts resolve display URLs through a Convex query; this
// harness renders without a provider, so the seam answers inert.
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

// Counts the toolbar's renders — the per-row chrome whose needless
// re-renders froze a long thread on open and on every send (#4121). The
// wrapper renders the real toolbar.
const toolbarRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./message-toolbar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./message-toolbar')>();
  const { createElement } = await import('react');
  return {
    ...actual,
    MessageToolbar: (props: Parameters<typeof actual.MessageToolbar>[0]) => {
      toolbarRenders.count += 1;
      return createElement(actual.MessageToolbar, props);
    },
  };
});
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
    ],
  },
];

/** `count` question-and-answer turns: settled user and assistant rows. */
function turns(count: number): ChatMessageView[] {
  const rows: ChatMessageView[] = [];
  for (let index = 1; index <= count; index += 1) {
    rows.push(
      {
        id: `u${index}`,
        role: 'user',
        sequence: index * 2 - 1,
        createdAt: index * 2 - 1,
        parts: [
          { type: 'text', text: `Question ${index}: how do tides work?` },
        ],
      },
      {
        id: `a${index}`,
        role: 'assistant',
        sequence: index * 2,
        createdAt: index * 2,
        parts: [
          {
            type: 'text',
            text: `Answer ${index}. The **moon** pulls the sea.`,
          },
        ],
      },
    );
  }
  return rows;
}

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

  it('drops the gap shell when the turn failed before any text', () => {
    // A failed settle drains the row like any other, but with no text nothing
    // ever paints a first glyph — the shell used to keep its dots and
    // ticking timer under the error.
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
            isStreaming: false,
            isFinalReveal: true,
            error: 'The model provider answered 401: Incorrect API key',
            status: 'failed',
          },
        ]}
      />,
    );

    const items = screen.getAllByTestId('chat-message');
    const failed = items.at(-1);
    if (!failed) throw new Error('expected a failed item');
    expect(within(failed).queryByTestId('thinking-gap-shell')).toBeNull();
    expect(within(failed).getByRole('alert')).toBeInTheDocument();
  });

  it("shows a failed reply's error above its toolbar", async () => {
    // After the body, the error drew under the toolbar: a failed turn with no
    // text showed its info and menu buttons first and the failure below them.
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
            isStreaming: false,
            // A settled history row: its toolbar shows at once.
            isFinalReveal: false,
            error: 'The model provider answered 500',
            status: 'failed',
          },
        ]}
      />,
    );

    const failed = screen.getAllByTestId('chat-message').at(-1);
    if (!failed) throw new Error('expected a failed item');
    const info = await within(failed).findByTestId('message-info-button');
    const alert = within(failed).getByRole('alert');
    expect(
      alert.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('drops the gap shell when the reply was stopped before any text', () => {
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
            isStreaming: false,
            isFinalReveal: true,
            status: 'cancelled',
          },
        ]}
      />,
    );

    const items = screen.getAllByTestId('chat-message');
    const stopped = items.at(-1);
    if (!stopped) throw new Error('expected a stopped item');
    expect(within(stopped).queryByTestId('thinking-gap-shell')).toBeNull();
    expect(within(stopped).getByText('Generation stopped')).toBeInTheDocument();
  });

  it('drops the gap shell when the reply settled with no answer', async () => {
    // The turn finished `complete` with nothing in it — the model returned
    // an empty reply. Nothing ever paints a first glyph, so the shell kept
    // its dots and its ticking "Thinking · Ns" for as long as the
    // conversation stayed open, over a turn that was already over.
    const onRegenerate = vi.fn();
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
            isStreaming: false,
            isFinalReveal: true,
            status: 'complete',
            usage: { inputTokens: 120, outputTokens: 0, finishReason: 'stop' },
          },
        ]}
        onRegenerate={onRegenerate}
      />,
    );

    const unanswered = screen.getAllByTestId('chat-message').at(-1);
    if (!unanswered) throw new Error('expected an unanswered item');
    expect(within(unanswered).queryByTestId('thinking-gap-shell')).toBeNull();
    expect(within(unanswered).getByRole('status')).toHaveTextContent(
      'The model returned no answer. Try again, or choose another model.',
    );
    // No reveal to wait for: the toolbar is there at once.
    expect(
      within(unanswered).getByTestId('message-info-button'),
    ).toBeInTheDocument();
    within(unanswered).getByRole('button', { name: 'Try again' }).click();
    await waitFor(() => expect(onRegenerate).toHaveBeenCalledTimes(1));
  });

  it('says the output limit was spent when only reasoning came back', () => {
    // A thinks-by-default model used its whole output limit reasoning: the
    // thought timeline stands, and the body used to be blank beneath it.
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
            parts: [{ type: 'reasoning', text: 'Weighing three approaches…' }],
            text: '',
            reasoningText: 'Weighing three approaches…',
            isStreaming: false,
            isFinalReveal: true,
            status: 'complete',
            usage: {
              inputTokens: 120,
              outputTokens: 4096,
              reasoningTokens: 4096,
              finishReason: 'length',
            },
          },
        ]}
      />,
    );

    const unanswered = screen.getAllByTestId('chat-message').at(-1);
    if (!unanswered) throw new Error('expected an unanswered item');
    expect(within(unanswered).queryByTestId('thinking-gap-shell')).toBeNull();
    expect(within(unanswered).getByRole('status')).toHaveTextContent(
      'The model used up its output token limit before it wrote an answer.',
    );
    // A read-only surface offers no retry.
    expect(
      within(unanswered).queryByRole('button', { name: 'Try again' }),
    ).toBeNull();
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

describe('MessageThread row identity across a send', () => {
  it('keeps the previous turn mounted when a new user message demotes it to history', () => {
    // ONE list on purpose: the rows above the new message change region, not
    // parent. A remount would flash the history row at its placeholder size
    // and clamp the scroll position out from under the send glide.
    const before = toSettledItems(CONVERSATION);
    const { rerender } = render(
      <MessageThread messages={before} threadId="t1" threadRootId="t1" />,
    );
    const rows = screen.getAllByTestId('chat-message');
    const previousUser = rows[0]!;
    const previousReply = rows[rows.length - 1]!;

    const after = toSettledItems([
      ...CONVERSATION,
      {
        id: 'm3',
        role: 'user',
        sequence: 3,
        createdAt: 3,
        parts: [{ type: 'text', text: 'And the totals?' }],
      },
    ]);
    rerender(
      <MessageThread messages={after} threadId="t1" threadRootId="t1" />,
    );

    expect(previousUser.isConnected).toBe(true);
    expect(previousReply.isConnected).toBe(true);
    const rowsAfter = screen.getAllByTestId('chat-message');
    expect(rowsAfter).toHaveLength(3);
    expect(rowsAfter[0]).toBe(previousUser);
    expect(rowsAfter[1]).toBe(previousReply);
  });
});

describe('MessageThread render cost', () => {
  it('renders each settled reply once when the thread opens', () => {
    toolbarRenders.count = 0;
    render(
      <MessageThread
        messages={toSettledItems(turns(5))}
        threadId="t-cost"
        threadRootId="t-cost"
      />,
    );

    // One toolbar per reply, rendered once: a settled reply paints whole in
    // its first frame, so nothing is left to render a second time.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(5);
    expect(toolbarRenders.count).toBe(5);
  });

  it('re-renders no settled reply when a turn first reports the server clock', () => {
    // The first live text of a page session carries the first server clock
    // sample: it re-rendered every reply of the transcript, toolbar and all,
    // in the task that paints the reply's first words.
    const messages = toSettledItems(turns(5));
    function Reporter({ serverNow }: { serverNow?: number }) {
      useReportServerNow(serverNow);
      return null;
    }
    const tree = (serverNow?: number) => (
      <ClockOffsetProvider>
        <MessageThread
          messages={messages}
          threadId="t-clock"
          threadRootId="t-clock"
        />
        <Reporter serverNow={serverNow} />
      </ClockOffsetProvider>
    );
    const { rerender } = render(tree());
    toolbarRenders.count = 0;

    rerender(tree(Date.now() + 8_000));

    expect(toolbarRenders.count).toBe(0);
  });
});

/** An IntersectionObserver the test drives: it records what it watches and
 * reports a row inside the wake margin on demand. */
class ControlledObserver {
  static instances: ControlledObserver[] = [];
  readonly targets = new Set<Element>();
  readonly thresholds = [0];
  constructor(
    private readonly callback: IntersectionObserverCallback,
    private readonly options: IntersectionObserverInit = {},
  ) {
    ControlledObserver.instances.push(this);
  }
  get root() {
    return this.options.root ?? null;
  }
  get rootMargin() {
    return this.options.rootMargin ?? '';
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  /** Report `target` within the observer's margin of the log. */
  enter(target: Element) {
    const entry = { target, isIntersecting: true };
    this.callback(
      [entry as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const isDormant = (row: HTMLElement) => row.hasAttribute('data-dormant');

describe('MessageThread long threads', () => {
  beforeEach(() => {
    ControlledObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', ControlledObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openThread = (count: number, threadId = 't-long') =>
    render(
      <MessageThread
        messages={toSettledItems(turns(count))}
        threadId={threadId}
        threadRootId={threadId}
      />,
    );
  const rows = () =>
    within(screen.getByRole('log')).getAllByTestId('chat-message');

  it('renders the newest rows in full and the older ones dormant, words kept', () => {
    openThread(40);

    const all = rows();
    expect(all).toHaveLength(80);
    const firstAwake = all.findIndex((row) => !isDormant(row));
    // A dormant head, then the newest rows in full — nothing in between.
    expect(firstAwake).toBeGreaterThan(0);
    expect(all.slice(0, firstAwake).every(isDormant)).toBe(true);
    expect(all.slice(firstAwake).some(isDormant)).toBe(false);
    // A dormant row keeps the message's words, in the log, for find-in-page
    // and assistive technology — without the chrome, and without
    // announcing itself when it later renders in full.
    expect(all[0]).toHaveTextContent('Question 1: how do tides work?');
    expect(all[1]).toHaveTextContent('Answer 1. The **moon** pulls the sea.');
    expect(within(all[1]!).queryByRole('button')).toBeNull();
    expect(all[1]).toHaveAttribute('aria-live', 'off');
    expect(all[79]).not.toHaveAttribute('aria-live');
    // Only the rows in full carry a toolbar.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(
      (80 - firstAwake) / 2,
    );
  });

  it('renders the same rows in full however long the thread grows', () => {
    const { unmount } = openThread(40, 't-long-a');
    const awakeIn40 = rows().filter((row) => !isDormant(row)).length;
    unmount();

    openThread(150, 't-long-b');

    expect(rows()).toHaveLength(300);
    expect(rows().filter((row) => !isDormant(row))).toHaveLength(awakeIn40);
  });

  it('wakes a dormant row the log observer reports near the view, in place', async () => {
    openThread(40);
    const log = screen.getByRole('log');
    const observer = ControlledObserver.instances.at(-1)!;
    // Bound to the log, a margin of several log heights ahead, watching
    // exactly the dormant rows.
    expect(observer.root).toBe(log);
    expect(observer.rootMargin).toBe('300% 0px');
    const dormant = rows().filter(isDormant);
    expect([...observer.targets]).toEqual(dormant);

    const reply = rows()[1]!;
    act(() => observer.enter(reply));

    await waitFor(() => expect(isDormant(reply)).toBe(false));
    expect(within(reply).getByRole('button', { name: 'Copy' })).toBeVisible();
    // The same row element, now in full; no longer watched.
    expect(rows()[1]).toBe(reply);
    expect(observer.targets.has(reply)).toBe(false);
  });

  it('keeps a row in full once the thread grows past it', () => {
    const items = toSettledItems(turns(40));
    const { rerender } = render(
      <MessageThread
        messages={items}
        threadId="t-grow"
        threadRootId="t-grow"
      />,
    );
    const firstAwake = rows().find((row) => !isDormant(row))!;
    const rendersBefore = toolbarRenders.count;

    // The thread view hands back the same items for the rows that did not
    // change; only the new turn is new.
    rerender(
      <MessageThread
        messages={[...items, ...toSettledItems(turns(41).slice(80))]}
        threadId="t-grow"
        threadRootId="t-grow"
      />,
    );

    // A send pushes it out of the newest rows: it stays in full and does
    // not render again. Two toolbars render: the new reply's, and the
    // previous reply's, which is no longer the last.
    expect(isDormant(firstAwake)).toBe(false);
    expect(firstAwake.isConnected).toBe(true);
    expect(toolbarRenders.count - rendersBefore).toBe(2);
  });

  it('wakes the rows a shorter branch brings back among the newest', () => {
    const { rerender } = render(
      <MessageThread
        messages={toSettledItems(turns(40))}
        threadId="t-branch"
        threadRootId="t-branch"
      />,
    );
    const awakeCount = rows().filter((row) => !isDormant(row)).length;

    rerender(
      <MessageThread
        messages={toSettledItems(turns(20))}
        threadId="t-branch"
        threadRootId="t-branch"
      />,
    );

    expect(rows().slice(-awakeCount).some(isDormant)).toBe(false);
  });

  it('passes an axe audit with dormant rows', async () => {
    const { container } = openThread(30);
    expect(rows().some(isDormant)).toBe(true);
    await waitFor(() => checkAccessibility(container));
  });
});

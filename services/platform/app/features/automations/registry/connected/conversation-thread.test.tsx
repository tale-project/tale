// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isOutboundDirection } from './conversation-parts/message-bubble';
import {
  ConversationThread,
  type ConversationThreadProps,
  pickMessages,
} from './conversation-thread';

// i18n → echo `ns.key` so assertions read clearly.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: (_d: unknown, preset?: string) => `time:${preset ?? ''}`,
    formatDateSmart: () => 'smart-date',
    formatDateHeader: (d: string) => `header:${d.slice(0, 10)}`,
  }),
}));

// BoundButton pulls the live Convex binding hooks — stand in with a plain
// button exposing the resolved label + bound item id for assertions.
vi.mock('./bound-button', () => ({
  BoundButton: ({
    action,
    item,
  }: {
    action: { label?: string; labelKey?: string; path: string };
    item?: Record<string, unknown>;
  }) => (
    <button type="button" data-item-id={String(item?.messageId ?? item?._id)}>
      {action.labelKey ?? action.label ?? action.path}
    </button>
  ),
}));

// Markdown renderer is heavy (shiki) — content passthrough marker.
vi.mock(
  '@/app/features/chat/components/message-bubble/markdown-renderer',
  () => ({
    MarkdownContent: ({ content }: { content: string }) => (
      <div data-testid="markdown">{content}</div>
    ),
  }),
);
vi.mock('@/app/components/ui/data-display/email-preview', () => ({
  EmailPreview: ({ html }: { html: string }) => (
    <div data-testid="email-preview">{html}</div>
  ),
}));

// The reactive read — driven by hand per test.
let queryReturn: {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  blocked: boolean;
  needsConfig: boolean;
};
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => queryReturn,
}));

function loaded(data: unknown) {
  return {
    data,
    isLoading: false,
    error: undefined,
    blocked: false,
    needsConfig: false,
  };
}

const MESSAGE_MAP: ConversationThreadProps['message'] = {
  authorField: 'sender',
  bodyField: 'content',
  timestampField: 'timestamp',
  directionField: 'isCustomer',
  deliveryStateField: 'status',
};

const BASE: ConversationThreadProps = {
  query: {
    path: 'conversations/queries:getConversationWithMessages',
    args: { conversationId: '$state.conversationId' },
  },
  message: MESSAGE_MAP,
};

const CONVERSATION = {
  _id: 'c1',
  status: 'open',
  messages: [
    {
      id: 'm1',
      sender: 'Customer',
      content: 'Hello\nthere',
      timestamp: '2026-07-01T10:00:00.000Z',
      isCustomer: true,
      status: 'delivered',
      attachments: [],
    },
    {
      id: 'm2',
      sender: 'Agent',
      content: 'Reply text',
      timestamp: '2026-07-02T11:00:00.000Z',
      isCustomer: false,
      status: 'queued',
      attachments: [
        {
          id: 'a1',
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          size: 2048,
        },
      ],
    },
  ],
};

afterEach(() => {
  queryReturn = loaded(undefined);
});

describe('ConversationThread — bubbles via the message field map', () => {
  it('renders author, body (newlines preserved), per-day groups and the outbound delivery indicator', () => {
    queryReturn = loaded(CONVERSATION);
    render(<ConversationThread {...BASE} />);

    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    // Text mode preserves newlines (whitespace-pre-wrap on one node).
    expect(
      screen.getByText((_, el) => el?.textContent === 'Hello\nthere'),
    ).toBeInTheDocument();
    // Two different days → two date group headers.
    expect(screen.getByText('header:2026-07-01')).toBeInTheDocument();
    expect(screen.getByText('header:2026-07-02')).toBeInTheDocument();
    // Outbound queued message carries the delivery icon (localized label).
    expect(
      screen.getByLabelText('automations.thread.deliveryQueued'),
    ).toBeInTheDocument();
  });

  it('renders markdown bodies through the house renderer', () => {
    queryReturn = loaded(CONVERSATION);
    render(
      <ConversationThread
        {...BASE}
        message={{ ...MESSAGE_MAP, bodyFormat: 'markdown' }}
      />,
    );
    const rendered = screen.getAllByTestId('markdown');
    expect(rendered[0]).toHaveTextContent('Hello there');
  });

  it('renders html bodies through the sanitized EmailPreview, never as raw text', () => {
    queryReturn = loaded(CONVERSATION);
    render(
      <ConversationThread
        {...BASE}
        message={{ ...MESSAGE_MAP, bodyFormat: 'html' }}
      />,
    );
    // The body reaches the DOMPurify-backed EmailPreview (mocked here) —
    // regression pin for the retired inbox's HTML email rendering.
    expect(screen.getAllByTestId('email-preview').length).toBeGreaterThan(0);
  });

  it('renders attachments with the bound attachment action carrying the message id', () => {
    queryReturn = loaded(CONVERSATION);
    render(
      <ConversationThread
        {...BASE}
        attachmentAction={{
          label: 'Download',
          path: 'conversations/mutations:downloadAttachments',
          mode: 'mutation',
          args: { messageId: '$selected.messageId' },
        }}
      />,
    );

    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    const action = screen.getByRole('button', { name: 'Download' });
    expect(action).toHaveAttribute('data-item-id', 'm2');
  });

  it('renders header actions bound to the loaded conversation', () => {
    queryReturn = loaded(CONVERSATION);
    render(
      <ConversationThread
        {...BASE}
        actions={[
          {
            labelKey: 'list.reopen',
            path: 'conversations/mutations:reopenConversation',
            mode: 'mutation',
            when: "status == 'open'",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'list.reopen' }),
    ).toBeInTheDocument();
  });
});

describe('ConversationThread — framing states', () => {
  it('shows the awaiting-selection flavor while $state is unset', () => {
    queryReturn = { ...loaded(undefined), needsConfig: true };
    render(<ConversationThread {...BASE} />);
    expect(
      screen.getByText('automations.binding.awaitingSelection'),
    ).toBeInTheDocument();
  });

  it('prefers the authored placeholderKey over the default copy', () => {
    queryReturn = { ...loaded(undefined), needsConfig: true };
    render(
      <ConversationThread {...BASE} placeholderKey="inbox.selectPrompt" />,
    );
    expect(screen.getByText('inbox.selectPrompt')).toBeInTheDocument();
    expect(
      screen.queryByText('automations.binding.awaitingSelection'),
    ).not.toBeInTheDocument();
  });

  it('keeps needsConfig for unresolved non-state bindings', () => {
    queryReturn = { ...loaded(undefined), needsConfig: true };
    render(
      <ConversationThread
        {...BASE}
        query={{ path: BASE.query.path, args: { owner: '$config:owner' } }}
      />,
    );
    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
  });

  it('shows the empty state for a conversation with no messages', () => {
    queryReturn = loaded({ _id: 'c1', status: 'open', messages: [] });
    render(<ConversationThread {...BASE} />);
    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
  });
});

describe('helpers', () => {
  it('pickMessages reads `messages` records or bare arrays', () => {
    expect(pickMessages(CONVERSATION)).toHaveLength(2);
    expect(pickMessages([{ id: 'x' }])).toHaveLength(1);
    expect(pickMessages(undefined)).toEqual([]);
  });

  it('isOutboundDirection understands strings and inbound flags', () => {
    expect(isOutboundDirection('outbound')).toBe(true);
    expect(isOutboundDirection('inbound')).toBe(false);
    // `isCustomer: false` → outbound.
    expect(isOutboundDirection(false)).toBe(true);
    expect(isOutboundDirection(true)).toBe(false);
  });
});

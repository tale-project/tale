import { describe, it, expect, vi } from 'vitest';

import type { ChatItem } from '@/app/features/chat/hooks/use-merged-chat-items';
import type { ChatMessage } from '@/app/features/chat/hooks/use-message-processing';
import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import {
  ChatMessages,
  computeSlackPx,
  resolveResponseSlackEnabled,
} from './chat-messages';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
}));

vi.mock('../hooks/use-personalization-active', () => ({
  usePersonalizationActiveForThread: () => ({
    customInstructions: false,
    memories: false,
  }),
}));

vi.mock('./message-bubble', () => ({
  MessageBubble: ({
    message,
    thinkingShell,
  }: {
    message: {
      content: string;
      role: string;
      isOptimisticShell?: boolean;
      isStreaming?: boolean;
    };
    thinkingShell?: { phase: string };
  }) => {
    const showInBubbleThinking = Boolean(
      message.isOptimisticShell ||
      (thinkingShell &&
        message.role === 'assistant' &&
        !message.content &&
        (message.isStreaming || message.isOptimisticShell)),
    );
    return (
      <div data-testid={`message-${message.role}`}>
        {message.content}
        {showInBubbleThinking && <div data-testid="thinking" />}
      </div>
    );
  },
}));

vi.mock('./thought-timeline', () => ({
  ThinkingIndicator: () => <div data-testid="thinking" />,
}));

// In-bubble Thinking (optimistic shell + steer-owner bubble) — these tests
// probe WHETHER the indicator renders under the gating rules.
vi.mock('./approval-card-renderer', () => ({
  ApprovalCardRenderer: () => <div data-testid="approval-card" />,
}));

vi.mock('./collapsible-system-message', () => ({
  CollapsibleSystemMessage: () => <div data-testid="system-message" />,
}));

vi.mock('../context/branch-context', () => ({
  useBranchContext: () => ({
    rootThreadId: 'thread-1',
    activeBranchThreadId: undefined,
    branches: [],
    branchSelections: {},
    switchBranch: vi.fn(),
    selectNewBranch: vi.fn(),
  }),
}));

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const id = overrides.id ?? `msg-${Date.now()}-${Math.random()}`;
  return {
    id,
    key: id,
    role: 'assistant',
    content: 'Hello',
    timestamp: new Date(),
    ...overrides,
  };
}

function toItem(message: ChatMessage): ChatItem {
  return { type: 'message', data: message };
}

function createRef<T>(value: T | null = null) {
  return { current: value };
}

const defaultProps = {
  threadId: 'thread-1',
  organizationId: 'org-1',
  canLoadMore: false,
  isLoadingMore: false,
  loadMore: vi.fn(),
  isLoading: false,
  lastUserMessageRef: createRef<HTMLDivElement>(),
  containerRef: createRef<HTMLDivElement>(),
  activeApproval: null,
};

function optimisticShell(ts = 1): ChatMessage {
  return createMessage({
    id: `pending-assistant-${ts}`,
    key: `pending-assistant-${ts}`,
    role: 'assistant',
    content: '',
    isStreaming: true,
    isOptimisticShell: true,
  });
}

describe('ChatMessages', () => {
  describe('message visibility', () => {
    it('renders user messages with content', () => {
      const userMsg = createMessage({
        id: 'user-1',
        role: 'user',
        content: 'Hello world',
      });

      render(<ChatMessages {...defaultProps} items={[toItem(userMsg)]} />);

      expect(screen.getByTestId('message-user')).toBeInTheDocument();
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    it('renders user messages with empty content', () => {
      const userMsg = createMessage({
        id: 'user-empty',
        role: 'user',
        content: '',
      });

      render(<ChatMessages {...defaultProps} items={[toItem(userMsg)]} />);

      expect(screen.getByTestId('message-user')).toBeInTheDocument();
    });

    it('renders messages with attachments even when content is empty', () => {
      const msgWithAttachments = createMessage({
        id: 'msg-attach',
        role: 'assistant',
        content: '',
        attachments: [
          {
            fileId: 'file-1' as Id<'_storage'>,
            fileName: 'test.pdf',
            fileType: 'application/pdf',
            fileSize: 1024,
          },
        ],
      });

      render(
        <ChatMessages {...defaultProps} items={[toItem(msgWithAttachments)]} />,
      );

      expect(screen.getByTestId('message-assistant')).toBeInTheDocument();
    });

    it('renders messages with fileParts even when content is empty', () => {
      const msgWithFileParts = createMessage({
        id: 'msg-fileparts',
        role: 'assistant',
        content: '',
        fileParts: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'screenshot.png',
            url: 'https://example.com/image.png',
          },
        ],
      });

      render(
        <ChatMessages {...defaultProps} items={[toItem(msgWithFileParts)]} />,
      );

      expect(screen.getByTestId('message-assistant')).toBeInTheDocument();
    });

    it('hides assistant messages with no content, no attachments, and not aborted', () => {
      const emptyAssistant = createMessage({
        id: 'empty-assistant',
        role: 'assistant',
        content: '',
      });

      render(
        <ChatMessages {...defaultProps} items={[toItem(emptyAssistant)]} />,
      );

      expect(screen.queryByTestId('message-assistant')).not.toBeInTheDocument();
    });

    it('renders empty streaming assistant shells (steer owner)', () => {
      const emptyStreaming = createMessage({
        id: 'streaming-empty',
        role: 'assistant',
        content: '',
        isStreaming: true,
      });
      const steerUser = createMessage({
        id: 'u-steer',
        role: 'user',
        content: 'steer pick',
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[toItem(emptyStreaming), toItem(steerUser)]}
        />,
      );

      expect(screen.getAllByTestId('message-assistant')).toHaveLength(1);
      expect(screen.getByTestId('thinking')).toBeInTheDocument();
    });

    it('renders aborted assistant messages even with empty content', () => {
      const abortedMsg = createMessage({
        id: 'aborted-msg',
        role: 'assistant',
        content: '',
        isAborted: true,
      });

      render(<ChatMessages {...defaultProps} items={[toItem(abortedMsg)]} />);

      expect(screen.getByTestId('message-assistant')).toBeInTheDocument();
    });
  });

  describe('in-bubble thinking (mid-turn steer)', () => {
    const user1 = () =>
      createMessage({ id: 'u1', role: 'user', content: 'first question' });
    const user2 = () =>
      createMessage({ id: 'u2', role: 'user', content: 'queued steer' });

    it('does not flash thinking on the prior-turn assistant before the shell mounts', () => {
      const prevA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: 'previous reply',
      });
      const newU = createMessage({
        id: 'u2',
        role: 'user',
        content: 'are you ok',
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[toItem(user1()), toItem(prevA), toItem(newU)]}
        />,
      );

      expect(screen.queryByTestId('thinking')).not.toBeInTheDocument();
    });

    it('keeps the prior-turn assistant key stable while the shell is mounted', () => {
      const prevA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: 'previous reply',
      });
      const newU = createMessage({
        id: 'u2',
        role: 'user',
        content: 'next question',
      });
      const items = [
        toItem(user1()),
        toItem(prevA),
        toItem(newU),
        toItem(optimisticShell()),
      ];

      const { container, rerender } = render(
        <ChatMessages
          {...defaultProps}
          isLoading
          isSendPending
          items={items}
        />,
      );
      // The stale-latch bug fired on the SECOND render: the ref set by the
      // shell on render 1 was consumed by the prior-turn assistant (rendered
      // first in list order) on render 2, flipping its key to the shell key.
      // Fresh array identity so the memo wrapper doesn't skip the render.
      rerender(
        <ChatMessages
          {...defaultProps}
          isLoading
          isSendPending
          items={[...items]}
        />,
      );

      const keys = [...container.querySelectorAll('[data-message-key]')].map(
        (el) => el.getAttribute('data-message-key'),
      );
      expect(keys.filter((k) => k === 'a1')).toHaveLength(1);
      expect(
        keys.filter((k) => k?.startsWith('pending-assistant-')),
      ).toHaveLength(1);
    });

    it('hands the shell key to the real response bubble, not a prior assistant', () => {
      const prevA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: 'previous reply',
      });
      const newU = createMessage({
        id: 'u2',
        role: 'user',
        content: 'next question',
      });
      const shell = optimisticShell();
      const itemsWithShell = [
        toItem(user1()),
        toItem(prevA),
        toItem(newU),
        toItem(shell),
      ];

      const { container, rerender } = render(
        <ChatMessages
          {...defaultProps}
          isLoading
          isSendPending
          items={itemsWithShell}
        />,
      );
      rerender(
        <ChatMessages
          {...defaultProps}
          isLoading
          isSendPending
          items={[...itemsWithShell]}
        />,
      );

      const realA = createMessage({
        id: 'a2',
        role: 'assistant',
        content: '',
        isStreaming: true,
      });
      rerender(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[toItem(user1()), toItem(prevA), toItem(newU), toItem(realA)]}
        />,
      );

      const keys = [...container.querySelectorAll('[data-message-key]')].map(
        (el) => el.getAttribute('data-message-key'),
      );
      // The real response bubble inherits the shell key (no remount), and the
      // prior-turn assistant keeps its own key.
      expect(keys).toContain(shell.key);
      expect(keys.filter((k) => k === 'a1')).toHaveLength(1);
      expect(keys.filter((k) => k === 'a2')).toHaveLength(0);
    });

    it('does not flash thinking when isSendPending leads the optimistic user by one frame', () => {
      const prevA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: 'previous reply',
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          isSendPending
          items={[toItem(user1()), toItem(prevA)]}
        />,
      );

      expect(screen.queryByTestId('thinking')).not.toBeInTheDocument();
    });

    it('renders in-bubble thinking for a normal send (optimistic shell)', () => {
      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[toItem(user1()), toItem(optimisticShell())]}
        />,
      );

      expect(screen.getByTestId('thinking')).toBeInTheDocument();
    });

    it('shows thinking on the steer-owner bubble above the last user message', () => {
      const streamingA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        isStreaming: true,
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[toItem(user1()), toItem(streamingA), toItem(user2())]}
        />,
      );

      expect(screen.getByTestId('thinking')).toBeInTheDocument();
    });

    it('shows thinking on an EMPTY streaming shell above (steer owner)', () => {
      const emptyShell = createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        isStreaming: true,
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[toItem(user1()), toItem(emptyShell), toItem(user2())]}
        />,
      );

      expect(screen.getByTestId('thinking')).toBeInTheDocument();
    });

    it('renders optimistic shell thinking when the assistant above already completed', () => {
      const doneA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: 'done',
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[
            toItem(user1()),
            toItem(doneA),
            toItem(user2()),
            toItem(optimisticShell()),
          ]}
        />,
      );

      expect(screen.getByTestId('thinking')).toBeInTheDocument();
    });

    it('steer-owner bubble carries thinking across multiple queued steers', () => {
      const streamingA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        isStreaming: true,
      });
      const user3 = createMessage({
        id: 'u3',
        role: 'user',
        content: 'second queued steer',
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[
            toItem(user1()),
            toItem(streamingA),
            toItem(user2()),
            toItem(user3),
          ]}
        />,
      );

      expect(screen.getByTestId('thinking')).toBeInTheDocument();
    });

    // Anchored mode (external-agent turns): `liveAssistantMessageId` names the
    // op's CURRENT live segment bubble; the footer shows exactly while that
    // bubble has nothing to paint, regardless of where rows sit — no
    // positional flips, no blank-gap window.
    describe('anchored live bubble (liveAssistantMessageId)', () => {
      it('shows in-bubble thinking on the anchored empty shell — even above the last user message', () => {
        const emptyShell = createMessage({
          id: 'a-live',
          role: 'assistant',
          content: '',
          isStreaming: true,
        });

        render(
          <ChatMessages
            {...defaultProps}
            isLoading
            liveAssistantMessageId="a-live"
            items={[toItem(user1()), toItem(emptyShell), toItem(user2())]}
          />,
        );

        expect(screen.getByTestId('thinking')).toBeInTheDocument();
      });

      it('hands off when the anchored bubble has content', () => {
        const liveBubble = createMessage({
          id: 'a-live',
          role: 'assistant',
          content: 'first tokens',
          isStreaming: true,
        });

        render(
          <ChatMessages
            {...defaultProps}
            isLoading
            liveAssistantMessageId="a-live"
            items={[toItem(user1()), toItem(liveBubble)]}
          />,
        );

        expect(screen.queryByTestId('thinking')).not.toBeInTheDocument();
      });

      it('shows optimistic shell thinking when the anchored bubble has not arrived yet', () => {
        const sealed = createMessage({
          id: 'a-old',
          role: 'assistant',
          content: 'sealed segment',
        });

        render(
          <ChatMessages
            {...defaultProps}
            isLoading
            liveAssistantMessageId="a-live-not-yet-here"
            items={[toItem(user1()), toItem(sealed), toItem(optimisticShell())]}
          />,
        );

        expect(screen.getByTestId('thinking')).toBeInTheDocument();
      });

      it('ignores other renderable assistants — only the anchored bubble gates shell suppression', () => {
        // A sealed segment with content would satisfy the positional
        // `hasRenderableAssistantResponse` scan; anchored mode must keep the
        // footer up until the LIVE bubble itself paints.
        const sealed = createMessage({
          id: 'a-old',
          role: 'assistant',
          content: 'sealed segment',
        });
        const emptyLive = createMessage({
          id: 'a-live',
          role: 'assistant',
          content: '',
          isStreaming: true,
        });

        render(
          <ChatMessages
            {...defaultProps}
            isLoading
            liveAssistantMessageId="a-live"
            items={[toItem(user1()), toItem(sealed), toItem(emptyLive)]}
          />,
        );

        expect(screen.getByTestId('thinking')).toBeInTheDocument();
      });
    });

    it('unmounts in-bubble thinking once the fresh post-seam bubble paints below the steer', () => {
      const sealedA = createMessage({
        id: 'a1',
        role: 'assistant',
        content: 'segment one',
      });
      const freshBubble = createMessage({
        id: 'a2',
        role: 'assistant',
        content: 'answering the steer',
        isStreaming: true,
      });

      render(
        <ChatMessages
          {...defaultProps}
          isLoading
          items={[
            toItem(user1()),
            toItem(sealedA),
            toItem(user2()),
            toItem(freshBubble),
          ]}
        />,
      );

      expect(screen.queryByTestId('thinking')).not.toBeInTheDocument();
    });
  });

  describe('off-screen history performance (content-visibility)', () => {
    it('applies content-visibility to history but not the active turn', () => {
      const history = createMessage({
        id: 'h',
        role: 'assistant',
        content: 'old answer',
      });
      const user = createMessage({
        id: 'u',
        role: 'user',
        content: 'current question',
      });
      const response = createMessage({
        id: 'r',
        role: 'assistant',
        content: 'new answer',
      });

      render(
        <ChatMessages
          {...defaultProps}
          items={[toItem(history), toItem(user), toItem(response)]}
        />,
      );

      // History (before the current turn's user message) opts into
      // content-visibility so it skips layout/paint while off-screen.
      expect(screen.getByText('old answer').parentElement?.className).toContain(
        'content-visibility',
      );
      // The active turn stays fully rendered for accurate scroll measurement.
      expect(
        screen.getByText('current question').parentElement?.className ?? '',
      ).not.toContain('content-visibility');
      expect(
        screen.getByText('new answer').parentElement?.className ?? '',
      ).not.toContain('content-visibility');
    });
  });
});

describe('resolveResponseSlackEnabled', () => {
  it('disables slack when opening/switching to a settled thread (no active turn)', () => {
    // Freshly opened thread → lands at the natural conversation bottom.
    expect(
      resolveResponseSlackEnabled({
        threadChanged: true,
        isLoading: false,
        prevSessionActive: false,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: false, sessionActive: false });
  });

  it('does NOT carry a previous thread active state across a switch', () => {
    // prevSessionActive from thread A must not leak into thread B on switch.
    expect(
      resolveResponseSlackEnabled({
        threadChanged: true,
        isLoading: false,
        prevSessionActive: true,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: false, sessionActive: false });
  });

  it('enables slack immediately while the optimistic message is pending (send)', () => {
    // Covers new-chat first send + first send after opening — no flash.
    expect(
      resolveResponseSlackEnabled({
        threadChanged: false,
        isLoading: false,
        prevSessionActive: false,
        lastUserMessagePending: true,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: false });
  });

  it('enables slack while generating', () => {
    expect(
      resolveResponseSlackEnabled({
        threadChanged: false,
        isLoading: true,
        prevSessionActive: false,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: true });
  });

  it('keeps slack after completion in the same session (no jump)', () => {
    // sessionActive latched true earlier; generation ended (isLoading false).
    expect(
      resolveResponseSlackEnabled({
        threadChanged: false,
        isLoading: false,
        prevSessionActive: true,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: true });
  });

  it('anchors the active turn when opening a thread mid-generation', () => {
    expect(
      resolveResponseSlackEnabled({
        threadChanged: true,
        isLoading: true,
        prevSessionActive: false,
        lastUserMessagePending: false,
      }),
    ).toEqual({ slackEnabled: true, sessionActive: true });
  });
});

describe('computeSlackPx', () => {
  it('fills the viewport below a short user message (minus gap, padding, inset)', () => {
    expect(
      computeSlackPx({
        viewportH: 800,
        userMsgH: 60,
        gap: 12,
        padBottom: 24,
        topInset: 16,
      }),
    ).toBe(800 - 60 - 12 - 24 - 16);
  });

  it('still grants slack for a tall user message (top-anchor stays reachable)', () => {
    // No clamp threshold: a 300px message in an 800px viewport gets the
    // remaining space so the send-snap top-anchor position exists.
    expect(
      computeSlackPx({
        viewportH: 800,
        userMsgH: 300,
        gap: 12,
        padBottom: 24,
        topInset: 16,
      }),
    ).toBe(800 - 300 - 12 - 24 - 16);
  });

  it('degrades to 0 when the user message exceeds the viewport', () => {
    expect(
      computeSlackPx({
        viewportH: 800,
        userMsgH: 900,
        gap: 12,
        padBottom: 24,
        topInset: 16,
      }),
    ).toBe(0);
  });
});

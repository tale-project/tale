import { describe, it, expect, vi } from 'vitest';

import type { ChatItem } from '@/app/features/chat/hooks/use-merged-chat-items';
import type { ChatMessage } from '@/app/features/chat/hooks/use-message-processing';
import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/test/utils/render';

import { ChatMessages } from '../chat-messages';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
}));

vi.mock('../../hooks/use-personalization-active', () => ({
  usePersonalizationActiveForThread: () => false,
}));

vi.mock('../message-bubble', () => ({
  MessageBubble: ({
    message,
  }: {
    message: { content: string; role: string };
  }) => <div data-testid={`message-${message.role}`}>{message.content}</div>,
}));

vi.mock('../thinking-animation', () => ({
  ThinkingAnimation: () => <div data-testid="thinking" />,
}));

vi.mock('../approval-card-renderer', () => ({
  ApprovalCardRenderer: () => <div data-testid="approval-card" />,
}));

vi.mock('../collapsible-system-message', () => ({
  CollapsibleSystemMessage: () => <div data-testid="system-message" />,
}));

vi.mock('../../context/branch-context', () => ({
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
  activeMessage: undefined,
  isLoading: false,
  lastUserMessageRef: createRef<HTMLDivElement>(),
  containerRef: createRef<HTMLDivElement>(),
  activeApproval: null,
};

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
});

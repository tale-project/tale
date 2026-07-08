// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddedChat } from './embedded-chat';

// Wiring smoke test: the heavy chat internals are covered by their own suites;
// here the providers/leaves are markers so the assertion is the COMPOSITION —
// provider nesting, pipeline props, and the pinned Stop decision.
const { useEmbeddedChatMock } = vi.hoisted(() => ({
  useEmbeddedChatMock: vi.fn(),
}));

// Stable hook return — never a fresh object per render (project memory:
// unstable mocked hook returns re-render-loop the tree).
const hookReturn = {
  threadId: 'th-1',
  items: [],
  activeApproval: null,
  activeApprovalInline: null,
  loadMore: vi.fn(),
  canLoadMore: false,
  isLoadingMore: false,
  isLoading: false,
  isSendPending: false,
  inputValue: '',
  setInputValue: vi.fn(),
  attachments: [],
  uploadingFiles: [],
  uploadFiles: vi.fn(),
  removeAttachment: vi.fn(),
  clearAttachments: vi.fn(() => []),
  isIndexing: false,
  indexingStatuses: new Map(),
  isTranscribing: false,
  transcriptionStatuses: new Map(),
  handleSendMessage: vi.fn(),
};
vi.mock('../hooks/use-embedded-chat', () => ({
  useEmbeddedChat: useEmbeddedChatMock,
}));

vi.mock('@/app/features/chat/context/chat-layout-context', () => ({
  ChatLayoutProvider: ({
    children,
    organizationId,
  }: {
    children: ReactNode;
    organizationId: string;
  }) => (
    <div data-testid="chat-layout-provider" data-org={organizationId}>
      {children}
    </div>
  ),
}));

vi.mock('@/app/components/ui/forms/file-upload', () => ({
  FileUpload: {
    Root: ({ children }: { children: ReactNode }) => (
      <div data-testid="file-upload-root">{children}</div>
    ),
  },
}));

vi.mock('@/app/features/chat/context/branch-context', () => ({
  BranchProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="branch-provider">{children}</div>
  ),
}));

vi.mock('@/app/features/chat/hooks/queries', () => ({
  ThreadMessageMetadataProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="thread-metadata-provider">{children}</div>
  ),
}));

vi.mock('@/app/features/chat/components/chat-messages', () => ({
  ChatMessages: (props: {
    threadId?: string;
    hideBranchNavigator?: boolean;
  }) => (
    <div
      data-testid="chat-messages"
      data-thread={props.threadId ?? ''}
      data-hide-branch={String(props.hideBranchNavigator ?? false)}
    />
  ),
}));

vi.mock('@/app/features/chat/components/chat-input', () => ({
  ChatInput: (props: {
    variant?: string;
    placeholder?: string;
    onStopGenerating?: () => void;
  }) => (
    <div
      data-testid="chat-input"
      data-variant={props.variant ?? ''}
      data-placeholder={props.placeholder ?? ''}
      data-stop-wired={String(props.onStopGenerating !== undefined)}
    />
  ),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

describe('EmbeddedChat', () => {
  it('mounts the full provider stack and threads the pipeline props', () => {
    useEmbeddedChatMock.mockReturnValue(hookReturn);
    const resolveThread = vi.fn(async () => 'th-1');
    const additionalContext = { subject_type: 'task', subject_id: 't1' };
    const { container } = render(
      <EmbeddedChat
        organizationId="org-1"
        agentSlug="impl-agent"
        threadId="th-1"
        resolveThread={resolveThread}
        additionalContext={additionalContext}
        placeholder="Ask the implementer…"
      />,
    );

    // Provider stack, outermost → innermost, exactly the assistant's shape:
    // ChatLayoutProvider → FileUpload.Root → … → Branch → ThreadMetadata.
    const nested = container.querySelector(
      '[data-testid="chat-layout-provider"] [data-testid="file-upload-root"]' +
        ' [data-testid="branch-provider"] [data-testid="thread-metadata-provider"]' +
        ' [data-testid="chat-messages"]',
    );
    expect(nested).not.toBeNull();
    expect(screen.getByTestId('chat-layout-provider')).toHaveAttribute(
      'data-org',
      'org-1',
    );

    // The data layer received the embed's contract (incl. the i18n texts the
    // component resolves itself; t is an echo here).
    expect(useEmbeddedChatMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      agentSlug: 'impl-agent',
      threadId: 'th-1',
      resolveThread,
      additionalContext,
      errorMessageText: 'toast.sendFailed',
      analyzeAttachmentsText: 'embedded.analyzeAttachments',
    });

    // Panel renders the main-chat stack without branch chrome.
    expect(screen.getByTestId('chat-messages')).toHaveAttribute(
      'data-hide-branch',
      'true',
    );
    expect(screen.getByTestId('chat-messages')).toHaveAttribute(
      'data-thread',
      'th-1',
    );

    // Composer: assistant variant, host placeholder, and — pinned decision —
    // Stop is NOT wired (ChatInput renders it disabled while generating;
    // shared automation_discussion threads keep the creator-only backend Stop).
    const input = screen.getByTestId('chat-input');
    expect(input).toHaveAttribute('data-variant', 'assistant');
    expect(input).toHaveAttribute('data-placeholder', 'Ask the implementer…');
    expect(input).toHaveAttribute('data-stop-wired', 'false');
  });
});

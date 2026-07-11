import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import type { FileAttachment } from '../types';

/**
 * Regression for #2663: `handleSendMessage` used to guard on
 * `!message.trim()` alone, so an attachment-only send from the composer (text
 * empty, files attached) silently no-opped — no fork, no message, no toast,
 * even though `ChatInput` itself already allows that send (its own guard is
 * `!value.trim() && attachments.length === 0`). `forkAndChat` also had no
 * `attachments` arg at all, so even a fixed guard would have dropped the
 * files. Stub `ChatInput` down to a button that invokes the real
 * `onSendMessage` prop with a chosen (message, attachments) pair — the
 * behaviour under test lives entirely in `handleSendMessage`, not in
 * `ChatInput`'s own composer internals (covered elsewhere).
 */

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

let sharedThreadData: unknown;
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: sharedThreadData, isLoading: false }),
}));

const mockForkThreadMutate = vi.fn();
const mockForkAndChat = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useForkThread: () => ({ mutate: mockForkThreadMutate, isPending: false }),
  useForkAndChat: () => ({
    mutateAsync: mockForkAndChat,
    isPending: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useChatAgents: () => ({ agents: [{ name: 'assistant' }] }),
}));

vi.mock('../hooks/use-convex-file-upload', () => ({
  useConvexFileUpload: () => ({
    attachments: [],
    uploadingFiles: [],
    uploadFiles: vi.fn(),
    cancelUpload: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
  }),
}));

const ATTACHMENT: FileAttachment = {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture
  fileId: 'storage-1' as Id<'_storage'>,
  fileName: 'photo.png',
  fileType: 'image/png',
  fileSize: 2048,
};

vi.mock('./chat-input', () => ({
  ChatInput: ({
    onSendMessage,
  }: {
    onSendMessage: (message: string, attachments?: FileAttachment[]) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSendMessage('', [ATTACHMENT])}>
        send attachment only
      </button>
      <button type="button" onClick={() => onSendMessage('', undefined)}>
        send nothing
      </button>
    </div>
  ),
}));

vi.mock('./message-bubble', () => ({
  MessageBubble: () => null,
}));

const { SharedChatView } = await import('./shared-chat-view');

describe('SharedChatView — attachment-only send (#2663)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forks and sends when the composer send carries only attachments (no typed text)', async () => {
    sharedThreadData = {
      title: 'Shared chat',
      agentSlug: 'assistant',
      messages: [],
    };
    mockForkAndChat.mockResolvedValue({ threadId: 'thread_new' });
    const { user } = render(
      <SharedChatView organizationId="org_1" shareToken="tok_1" />,
    );

    await user.click(
      screen.getByRole('button', { name: 'send attachment only' }),
    );

    expect(mockForkAndChat).toHaveBeenCalledWith(
      expect.objectContaining({
        shareToken: 'tok_1',
        message: '',
        attachments: [
          {
            fileId: ATTACHMENT.fileId,
            fileName: ATTACHMENT.fileName,
            fileType: ATTACHMENT.fileType,
            fileSize: ATTACHMENT.fileSize,
          },
        ],
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { id: 'org_1', threadId: 'thread_new' },
      }),
    );
  });

  it('still no-ops a truly empty send (no text, no attachments)', async () => {
    sharedThreadData = {
      title: 'Shared chat',
      agentSlug: 'assistant',
      messages: [],
    };
    const { user } = render(
      <SharedChatView organizationId="org_1" shareToken="tok_1" />,
    );

    await user.click(screen.getByRole('button', { name: 'send nothing' }));

    expect(mockForkAndChat).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

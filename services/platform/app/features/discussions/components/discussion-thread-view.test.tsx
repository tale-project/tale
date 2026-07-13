// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../../chat/hooks/use-convex-file-upload', () => ({
  useConvexFileUpload: () => ({
    attachments: [],
    uploadingFiles: [],
    uploadFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
  }),
}));

vi.mock('../../chat/hooks/use-message-processing', () => ({
  useMessageProcessing: () => ({ messages: [] }),
}));

vi.mock('../../tasks/hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: () => null,
    currentUserId: 'user-1',
  }),
}));

vi.mock('../../tasks/lib/mention-actor-options', () => ({
  useMentionActorOptions: () => [],
}));

vi.mock('../hooks/mutations', () => ({
  usePostReply: () => ({ mutateAsync: vi.fn() }),
  useSetDiscussionStatus: () => ({ mutateAsync: vi.fn() }),
  useCreateTaskFromDiscussion: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/queries', () => ({
  useDiscussion: () => ({
    data: {
      title: 'Design review',
      discussionStatus: 'locked',
      discussionCategory: null,
      linkedTaskId: null,
    },
  }),
}));

const chatInputSpy = vi.fn();
vi.mock('../../chat/components/chat-input', () => ({
  ChatInput: (props: {
    disabled?: boolean;
    disabledReason?: string;
    disabledMessage?: string;
  }) => {
    chatInputSpy(props);
    return <div data-testid="chat-input" />;
  },
}));

vi.mock('../../chat/components/message-bubble', () => ({
  MessageBubble: () => null,
}));

import { DiscussionThreadView } from './discussion-thread-view';

describe('DiscussionThreadView', () => {
  it('passes the discussions locked copy to ChatInput when locked (#2680)', () => {
    render(
      <DiscussionThreadView
        organizationId="org-1"
        projectId={'project-1' as never}
        threadId="thread-1"
        onBack={vi.fn()}
      />,
    );

    expect(chatInputSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        disabled: true,
        disabledReason: 'locked',
        disabledMessage: 'discussions.reply.lockedPlaceholder',
      }),
    );
  });
});

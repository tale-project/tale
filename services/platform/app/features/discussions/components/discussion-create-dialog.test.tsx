// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
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

vi.mock('../hooks/mutations', () => ({
  useCreateDiscussion: () => ({ mutateAsync: vi.fn() }),
}));

const chatInputSpy = vi.fn();
vi.mock('../../chat/components/chat-input', () => ({
  ChatInput: (props: {
    actorMentionSource?: unknown;
    onSendMessage?: (message: string) => void;
    sendBlocked?: boolean;
  }) => {
    chatInputSpy(props);
    return (
      <div data-testid="chat-input-wrapper">
        <div
          data-testid="chat-input"
          data-has-actor-mention={props.actorMentionSource ? 'yes' : 'no'}
        />
        <button
          type="button"
          data-testid="chat-input-send"
          onClick={() => props.onSendMessage?.('Opening post')}
        >
          Send
        </button>
      </div>
    );
  },
}));

import { DiscussionCreateDialog } from './discussion-create-dialog';

describe('DiscussionCreateDialog', () => {
  it('wires actorMentionSource so @-mentions work in the opening post composer', () => {
    render(
      <DiscussionCreateDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        projectId={'project-1' as never}
        onCreated={vi.fn()}
      />,
    );

    expect(screen.getByTestId('chat-input')).toHaveAttribute(
      'data-has-actor-mention',
      'yes',
    );
    expect(chatInputSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMentionSource: expect.any(Function),
      }),
    );
    expect(chatInputSpy.mock.calls[0]?.[0]).not.toHaveProperty('sendBlocked');
  });

  it('requires title on send instead of blocking the composer upfront', async () => {
    const { user } = render(
      <DiscussionCreateDialog
        open
        onOpenChange={vi.fn()}
        organizationId="org-1"
        projectId={'project-1' as never}
        onCreated={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('chat-input-send'));

    expect(
      screen.getByText('discussions.create.titleRequired'),
    ).toBeInTheDocument();
  });
});

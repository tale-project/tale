import { act, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { bulkUpdateChatThreads, invalidateChatThreads, toast } = vi.hoisted(
  () => ({
    bulkUpdateChatThreads: vi.fn(),
    invalidateChatThreads: vi.fn(),
    toast: vi.fn(),
  }),
);
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org1',
}));
vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatQueryClient: () => ({}),
}));
vi.mock('@/app/lib/backend/chat', () => ({
  bulkUpdateChatThreads,
  invalidateChatThreads,
}));
vi.mock('@tale/ui/use-toast', () => ({ toast }));

import { ChatsSection } from './chats-section';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('account chat actions', () => {
  it('offers an enabled confirmation and cancellation makes no write', async () => {
    const { user } = render(<ChatsSection />);
    await user.click(screen.getByRole('button', { name: 'Delete all chats' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'including archived and project chats',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bulkUpdateChatThreads).not.toHaveBeenCalled();
  });

  it('blocks duplicate confirmation while pending and reports partial failures', async () => {
    let finish!: (result: { changed: number; failed: number }) => void;
    bulkUpdateChatThreads.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = render(<ChatsSection />);
    await user.click(screen.getByRole('button', { name: 'Archive all chats' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Archive all chats',
    });
    await user.dblClick(confirm);
    expect(bulkUpdateChatThreads).toHaveBeenCalledExactlyOnceWith(
      'org1',
      'archive',
    );
    expect(confirm).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      finish({ changed: 2, failed: 1 });
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(invalidateChatThreads).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      title: 'Updated 2 chats; 1 could not be changed.',
      variant: 'destructive',
    });
  });

  it('keeps confirmation open after a request failure so it can be retried', async () => {
    bulkUpdateChatThreads.mockRejectedValue(new Error('offline'));
    const { user } = render(<ChatsSection />);
    await user.click(screen.getByRole('button', { name: 'Delete all chats' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete all chats',
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

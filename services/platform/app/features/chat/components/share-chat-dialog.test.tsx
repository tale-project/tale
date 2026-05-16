import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { ShareChatDialog } from './share-chat-dialog';

const mockShareThread = vi.fn();
const mockUnshareThread = vi.fn();

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: { isShared: false, shareToken: null },
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useShareThread: () => ({ mutate: mockShareThread, isPending: false }),
  useUnshareThread: () => ({ mutate: mockUnshareThread, isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('ShareChatDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ShareChatDialog
          open={true}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });

    it('returns null when closed', async () => {
      const { container } = render(
        <ShareChatDialog
          open={false}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('rendering', () => {
    it('renders the share toggle when open', () => {
      render(
        <ShareChatDialog
          open={true}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      const { container } = render(
        <ShareChatDialog
          open={false}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('share toggle', () => {
    it('calls shareThread when toggled on', async () => {
      const { user } = render(
        <ShareChatDialog
          open={true}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      expect(mockShareThread).toHaveBeenCalledWith(
        { threadId: 'thread-1', organizationId: 'org-1' },
        expect.objectContaining({ onError: expect.any(Function) }),
      );
    });
  });
});

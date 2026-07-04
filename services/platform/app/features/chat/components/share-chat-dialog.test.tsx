import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ShareChatDialog } from './share-chat-dialog';

const mockShareThread = vi.fn();
const mockUnshareThread = vi.fn();
const mockToast = vi.fn();

interface ShareStatus {
  isShared: boolean;
  shareToken: string | null;
  isShareable?: boolean;
}

let shareStatusData: ShareStatus = { isShared: false, shareToken: null };

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: shareStatusData, isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useShareThread: () => ({ mutate: mockShareThread, isPending: false }),
  useUnshareThread: () => ({ mutate: mockUnshareThread, isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe('ShareChatDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shareStatusData = { isShared: false, shareToken: null };
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

    it('maps the arena ConvexError code to a specific failure toast', async () => {
      mockShareThread.mockImplementation(
        (_args: unknown, opts?: { onError?: (error: unknown) => void }) => {
          opts?.onError?.(
            new ConvexError({ code: 'CANNOT_SHARE_ARENA_THREAD' }),
          );
        },
      );

      const { user } = render(
        <ShareChatDialog
          open={true}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );

      await user.click(screen.getByRole('switch'));

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Arena chats can't be shared.",
          variant: 'destructive',
        }),
      );
    });
  });

  describe('un-shareable threads', () => {
    it('disables the toggle and explains why for a branch thread', () => {
      shareStatusData = {
        isShared: false,
        shareToken: null,
        isShareable: false,
      };

      render(
        <ShareChatDialog
          open={true}
          onOpenChange={vi.fn()}
          threadId="thread-1"
          organizationId="org-1"
        />,
      );

      expect(screen.getByRole('switch')).toBeDisabled();
      expect(
        screen.getByText("This chat can't be shared."),
      ).toBeInTheDocument();
    });
  });
});

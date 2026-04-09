import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ShareChatDialog } from '../share-chat-dialog';

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: { isShared: false, shareToken: null },
    isLoading: false,
  }),
}));

vi.mock('../../hooks/mutations', () => ({
  useShareThread: () => ({ mutate: vi.fn(), isPending: false }),
  useUnshareThread: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe('ShareChatDialog', () => {
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
});

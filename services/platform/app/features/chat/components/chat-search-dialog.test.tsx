import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ChatSearchDialog } from './chat-search-dialog';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-debounce', () => ({
  useDebounce: (value: string) => value,
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDateHeader: () => 'Today',
  }),
}));

vi.mock('../hooks/queries', () => ({
  useThreads: () => ({
    threads: [
      { _id: 'thread-1', title: 'First chat', _creationTime: Date.now() },
      {
        _id: 'thread-2',
        title: 'Second chat',
        _creationTime: Date.now() - 1000,
      },
    ],
  }),
}));

describe('ChatSearchDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ChatSearchDialog
          isOpen={true}
          onOpenChange={vi.fn()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});

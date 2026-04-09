import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ChatHeader } from '../chat-header';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    isHistoryOpen: false,
    setIsHistoryOpen: vi.fn(),
    clearChatState: vi.fn(),
  }),
}));

vi.mock('../chat-history-sidebar', () => ({
  ChatHistorySidebar: () => <div data-testid="chat-history-sidebar" />,
}));

vi.mock('../chat-search-dialog', () => ({
  ChatSearchDialog: () => null,
}));

vi.mock('@/app/components/layout/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="adaptive-header" className={className}>
      {children}
    </div>
  ),
}));

describe('ChatHeader', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ChatHeader organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});

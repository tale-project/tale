import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ChatHeader } from './chat-header';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    isHistoryOpen: false,
    setIsHistoryOpen: vi.fn(),
    clearChatState: vi.fn(),
  }),
}));

vi.mock('./chat-history-sidebar', () => ({
  ChatHistorySidebar: () => <div data-testid="chat-history-sidebar" />,
}));

// Stub the threads source so the header's SearchCommand doesn't reach Convex
// (the source hook calls `useThreads`, which needs a ConvexProvider).
vi.mock('./threads-search-source', () => ({
  createThreadsSearchSource: () => () => ({ results: [], status: 'idle' }),
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

vi.mock('../hooks/use-voice-output', () => ({
  useVoiceModeEffective: () => ({
    enabled: false,
    userDefault: false,
    source: 'default' as const,
  }),
}));

vi.mock('./thread-voice-output-switch', () => ({
  useThreadVoiceOutputCheckboxItem: () => null,
}));

describe('ChatHeader', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ChatHeader organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});

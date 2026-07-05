import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { ChatDashboardSidebar } from './chat-dashboard-sidebar';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({
      children,
      ...rest
    }: {
      children: React.ReactNode;
      to?: string;
      params?: Record<string, string>;
      preload?: string;
      className?: string;
      onClick?: () => void;
    }) => (
      <a href={rest.to} {...rest}>
        {children}
      </a>
    ),
    useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
    useRouter: () => ({ preloadRoute: vi.fn() }),
  };
});

vi.mock('@/app/components/ui/navigation/navigation', () => ({
  Navigation: () => <nav data-testid="dashboard-nav">nav</nav>,
}));

vi.mock('./chat-history-sidebar', () => ({
  ChatHistorySidebar: () => (
    <div data-testid="chat-history-sidebar">history</div>
  ),
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    isHistoryOpen: true,
    setIsHistoryOpen: vi.fn(),
  }),
}));

vi.mock('@/app/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

describe('ChatDashboardSidebar', () => {
  it('renders nav rail and history panel landmark', () => {
    render(<ChatDashboardSidebar organizationId="org-1" />);

    expect(screen.getByTestId('dashboard-nav')).toBeInTheDocument();
    expect(screen.getByTestId('chat-history-sidebar')).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', {
        name: enMessages.chat.unifiedSidebar.landmark,
      }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ChatDashboardSidebar organizationId="org-1" />,
      );
      await checkAccessibility(container);
    });
  });
});

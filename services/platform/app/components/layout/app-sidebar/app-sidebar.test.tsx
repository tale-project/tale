import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { AppSidebar } from './app-sidebar';

const { sidebarState } = vi.hoisted(() => ({
  sidebarState: {
    isExpanded: true,
    setExpanded: vi.fn(),
    toggleExpanded: vi.fn(),
    isMobileSheetOpen: false,
    setMobileSheetOpen: vi.fn(),
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
  },
}));

vi.mock('./sidebar-context', () => ({
  useSidebar: () => sidebarState,
}));

type MockLinkProps = React.ComponentProps<'a'> & {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
};

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params: _params, preload: _preload, children, ...rest },
    ref,
  ) {
    return (
      <a ref={ref} href={to} {...rest}>
        {children}
      </a>
    );
  }),
  useLocation: () => ({ pathname: '/dashboard/org-1/chat' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({
    accentColor: null,
    logoUrl: null,
    appName: null,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-is-mac', () => ({ useIsMac: () => false }));
vi.mock('@/app/hooks/use-is-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => true,
}));

vi.mock('@/app/hooks/use-navigation-items', () => ({
  useNavigationItems: () => ({
    primary: [
      {
        label: 'New chat',
        to: '/dashboard/$id/chat',
        params: { id: 'org-1' },
        href: '/dashboard/org-1/chat',
        emphasis: true,
      },
    ],
    pinned: [],
  }),
}));

// Leaf widgets pull in Convex/auth/Radix overlays; stub them so the test stays
// hermetic and focused on the panel's landmark + expand/collapse contract.
vi.mock('@/app/components/ui/logo/tale-logo', () => ({
  TaleLogo: () => <span>Tale</span>,
}));
vi.mock('@/app/features/chat/components/chat-history-sidebar', () => ({
  ChatHistorySidebar: () => (
    <div data-testid="chat-history-sidebar">history</div>
  ),
}));
vi.mock('@/app/components/user-button', () => ({
  UserButton: () => null,
}));
vi.mock('@/app/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => null,
}));
vi.mock('./mobile-sidebar-sheet', () => ({
  MobileSidebarSheet: () => null,
}));
vi.mock('./sidebar-search-command', () => ({
  SidebarSearchCommand: () => null,
}));

describe('AppSidebar', () => {
  it('renders the sidebar landmark with the chat history mounted while expanded', () => {
    sidebarState.isExpanded = true;
    render(<AppSidebar organizationId="org-1" />);

    expect(
      screen.getByRole('complementary', {
        name: enMessages.navigation.sidebar.landmark,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('chat-history-sidebar')).toBeInTheDocument();
    // Expanded: the collapse toggle sits in the header.
    expect(
      screen.getByRole('button', {
        name: enMessages.navigation.sidebar.collapse,
      }),
    ).toHaveAttribute('aria-expanded', 'true');
  });

  it('collapsed: chat history region is inert and hidden, toggle flips to expand', () => {
    sidebarState.isExpanded = false;
    render(<AppSidebar organizationId="org-1" />);

    // The region stays mounted (lazy latch starts unmounted here since the
    // sidebar never expanded during this render) and is out of the a11y tree.
    expect(
      screen.queryByTestId('chat-history-sidebar'),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {
      name: enMessages.navigation.sidebar.expand,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'chat-history-panel');
  });

  it('keeps the chat history mounted after a collapse (clip, not unmount)', () => {
    sidebarState.isExpanded = true;
    const { rerender } = render(<AppSidebar organizationId="org-1" />);
    expect(screen.getByTestId('chat-history-sidebar')).toBeInTheDocument();

    sidebarState.isExpanded = false;
    rerender(<AppSidebar organizationId="org-1" />);

    // Still in the DOM (smooth re-open) but inert + aria-hidden. jsdom doesn't
    // reflect the `inert` IDL property, so assert the attribute React sets.
    const history = screen.getByTestId('chat-history-sidebar');
    const region = history.closest('[aria-hidden]');
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(region).toHaveAttribute('inert');
  });

  describe('accessibility', () => {
    it('passes axe audit while expanded', async () => {
      sidebarState.isExpanded = true;
      const { container } = render(<AppSidebar organizationId="org-1" />);
      await checkAccessibility(container);
    });

    it('passes axe audit while collapsed', async () => {
      sidebarState.isExpanded = false;
      const { container } = render(<AppSidebar organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});

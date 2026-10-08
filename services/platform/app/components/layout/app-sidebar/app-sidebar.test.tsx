import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { enMessages } from '@/tests/utils/messages';
import { render, screen } from '@/tests/utils/render';

import { AppSidebar } from './app-sidebar';

vi.mock('./sidebar-context', () => ({
  useSidebar: () => ({
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
  }),
  useOptionalSidebar: () => ({
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
  }),
}));

type MockLinkProps = React.ComponentProps<'a'> & {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
  search?: Record<string, unknown>;
};

vi.mock('@tanstack/react-router', () => ({
  // `search` is a router prop, not a DOM attribute — surfaced as data-* so a
  // test can assert what a link navigates with.
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params: _params, preload: _preload, search, children, ...rest },
    ref,
  ) {
    return (
      <a
        ref={ref}
        href={to}
        data-search={search ? JSON.stringify(search) : undefined}
        {...rest}
      >
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

vi.mock('@tale/ui/use-is-mac', () => ({ useIsMac: () => false }));

vi.mock('@/app/hooks/use-navigation-items', () => ({
  isItemActive: (item: { href: string }, pathname: string) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`),
  useNavigationItems: () => ({
    primary: [
      {
        label: 'Chat',
        to: '/dashboard/$id/chat',
        params: { id: 'org-1' },
        href: '/dashboard/org-1/chat',
      },
    ],
    pinned: [],
  }),
}));

// Leaf widgets pull in Convex/auth/Radix overlays; stub them so the test stays
// hermetic and focused on the rail's landmark + tile contract.
vi.mock('@/app/components/logo/tale-logo', () => ({
  TaleLogo: () => <span>Tale</span>,
}));
vi.mock('@/app/components/user-button', () => ({
  UserButton: () => null,
}));
vi.mock('@/app/features/notifications/components/notification-bell', () => ({
  NotificationBell: () => null,
}));
vi.mock('./sidebar-search-command', () => ({
  SidebarSearchCommand: () => null,
}));

describe('AppSidebar', () => {
  it('renders the sidebar landmark with icon-only nav tiles', () => {
    render(<AppSidebar organizationId="org-1" />);

    expect(
      screen.getByRole('complementary', {
        name: enMessages.navigation.sidebar.landmark,
      }),
    ).toBeInTheDocument();
    // Tiles are icon-only links: the label rides along as the accessible name.
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute(
      'href',
      '/dashboard/$id/chat',
    );
  });

  it('opens a fresh chat from the logo, never the last one', () => {
    render(<AppSidebar organizationId="org-1" />);

    const logo = screen.getByRole('link', { name: 'Tale' });
    expect(logo).toHaveAttribute('href', '/dashboard/$id/chat');
    expect(logo).toHaveAttribute('data-search', '{"new":true}');
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<AppSidebar organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});

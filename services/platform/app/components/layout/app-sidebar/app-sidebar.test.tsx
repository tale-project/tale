import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.yml';
import { AppSidebar } from './app-sidebar';

vi.mock('./sidebar-context', () => ({
  useSidebar: () => ({
    isMobileSheetOpen: false,
    setMobileSheetOpen: vi.fn(),
    isSearchOpen: false,
    setSearchOpen: vi.fn(),
  }),
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

vi.mock('@/app/hooks/use-navigation-items', () => ({
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
vi.mock('@/app/components/ui/logo/tale-logo', () => ({
  TaleLogo: () => <span>Tale</span>,
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

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<AppSidebar organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});

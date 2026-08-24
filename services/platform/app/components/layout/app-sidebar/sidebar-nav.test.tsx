import {
  MessageCircle,
  LayoutGrid,
  Folder,
  Network,
  BookOpen,
} from 'lucide-react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SidebarNav } from './sidebar-nav';

// Labels are shared between the mocked nav-items hook (read inside the hoisted
// factory) and the assertions below, so the two can never drift apart.
const { primaryLabels, externalLabel } = vi.hoisted(() => ({
  primaryLabels: ['Chat', 'Automations', 'Projects', 'Agents'],
  externalLabel: 'Help center',
}));

type MockLinkProps = React.ComponentProps<'a'> & {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
};

vi.mock('@tanstack/react-router', () => ({
  // Router-only props (`to`, `params`, `preload`) are stripped so that only real
  // DOM attributes — crucially `aria-label` — reach the rendered anchor.
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
  useLocation: () => ({ pathname: '/dashboard/test-org/chat' }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: null, logoUrl: null }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-is-mac', () => ({
  useIsMac: () => false,
}));

vi.mock('@/app/hooks/use-navigation-items', () => ({
  useNavigationItems: () => ({
    primary: [
      {
        label: primaryLabels[0],
        to: '/dashboard/$id/chat',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/chat',
        icon: MessageCircle,
        // A shortcut item: its accessible name must stay the plain label, with
        // the shortcut chip living only in the sighted-hover tooltip.
        shortcut: '⌥ ⌘ N',
      },
      {
        label: primaryLabels[1],
        to: '/dashboard/$id/automations',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/automations',
        icon: LayoutGrid,
      },
      {
        label: primaryLabels[2],
        to: '/dashboard/$id/projects',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/projects',
        icon: Folder,
      },
      {
        label: primaryLabels[3],
        to: '/dashboard/$id/agents',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/agents',
        icon: Network,
      },
      {
        // External items render a native <a> — the other branch.
        label: externalLabel,
        to: 'https://help.example.com',
        params: {},
        href: 'https://help.example.com',
        icon: BookOpen,
        external: true,
      },
    ],
    pinned: [],
  }),
}));

describe('SidebarNav', () => {
  describe('accessibility', () => {
    it('exposes a discernible accessible name on every icon tile link', () => {
      render(<SidebarNav organizationId="test-org" />);

      // Regression for #1975: the label used to live only in a hover tooltip, so
      // each link had an empty accessible name. Each destination must now be
      // reachable by its localized name (screen readers, keyboard users).
      for (const name of [...primaryLabels, externalLabel]) {
        expect(screen.getByRole('link', { name })).toBeInTheDocument();
      }
    });

    it('passes an axe link-name audit', async () => {
      const { container } = render(<SidebarNav organizationId="test-org" />);
      await waitFor(() => checkAccessibility(container));
    });
  });
});

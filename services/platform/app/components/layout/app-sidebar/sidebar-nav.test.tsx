import { cleanup } from '@testing-library/react';
import {
  MessageCircle,
  LayoutGrid,
  Folder,
  Network,
  BookOpen,
} from 'lucide-react';
import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SidebarNav } from './sidebar-nav';

// Labels are shared between the mocked nav-items hook (read inside the hoisted
// factory) and the assertions below, so the two can never drift apart.
const {
  primaryLabels,
  externalLabel,
  badgedLabel,
  badgedCount,
  badgedMeaning,
  quietLabel,
  mockLocation,
} = vi.hoisted(() => ({
  primaryLabels: ['Chat', 'Automations', 'Projects', 'Agents'],
  externalLabel: 'Help center',
  // A badged tile (the Inbox's unread chip) and one whose count is zero.
  badgedLabel: 'Inbox',
  badgedCount: 3,
  badgedMeaning: '3 unread conversations',
  quietLabel: 'Documents',
  mockLocation: { pathname: '/dashboard/test-org/chat' },
}));

type MockLinkProps = React.ComponentProps<'a'> & {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
  search?: Record<string, unknown>;
};

vi.mock('@tanstack/react-router', () => ({
  // Router-only props (`to`, `params`, `preload`) are stripped so that only real
  // DOM attributes — crucially `aria-label` — reach the rendered anchor.
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    { to, params: _params, preload: _preload, search, children, ...rest },
    ref,
  ) {
    // `search` is a router prop, not a DOM attribute — surface it as a data-*
    // so a test can assert what the rail decided to navigate with.
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
  useLocation: () => mockLocation,
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: null, logoUrl: null }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@tale/ui/use-is-mac', () => ({
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
        reentrySearch: { new: true },
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
        label: badgedLabel,
        to: '/dashboard/$id/conversations',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/conversations',
        icon: Folder,
        badge: badgedCount,
        badgeLabel: badgedMeaning,
      },
      {
        // A badge of 0 is the resting state, not a chip reading "0".
        label: quietLabel,
        to: '/dashboard/$id/documents',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/documents',
        icon: Folder,
        badge: 0,
        badgeLabel: '0 unread conversations',
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

beforeEach(() => {
  mockLocation.pathname = '/dashboard/test-org/chat';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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

    it('carries the badge’s MEANING in the tile’s accessible name', () => {
      render(<SidebarNav organizationId="test-org" />);

      // The link sets `aria-label`, which overrides descendant content, so a
      // count rendered inside the tile reaches no screen reader — and a bare
      // "3" would say nothing anyway. The name has to carry both.
      const tile = screen.getByRole('link', {
        name: `${badgedLabel}, ${badgedMeaning}`,
      });
      expect(tile).toBeInTheDocument();

      // The chip itself is decorative: sighted users see the number, AT reads
      // it once, from the name.
      const chip = screen.getByText(String(badgedCount));
      expect(chip).toHaveAttribute('aria-hidden', 'true');
    });

    it('leaves an unbadged tile’s name plain', () => {
      render(<SidebarNav organizationId="test-org" />);

      // A count of 0 is the resting state: no chip, and no ", 0 unread…"
      // dangling off the name of a tile with nothing to report.
      expect(
        screen.getByRole('link', { name: quietLabel }),
      ).toBeInTheDocument();
      expect(screen.queryByText('0')).toBeNull();
      // And a tile that never had a badge is untouched.
      expect(
        screen.getByRole('link', { name: primaryLabels[2] }),
      ).toBeInTheDocument();
    });

    it('passes an axe link-name audit', async () => {
      const { container } = render(<SidebarNav organizationId="test-org" />);
      await waitFor(() => checkAccessibility(container));
    });
  });

  // -------------------------------------------------------------------------
  // A rail click is a request for the SECTION. It lands on that section's own
  // entry point every time — the first tab of a tabbed section — so the same
  // click never opens two different pages on two different days.
  // -------------------------------------------------------------------------
  describe('destination', () => {
    it('opens the section entry point, not a deeper page inside it', () => {
      mockLocation.pathname =
        '/dashboard/test-org/automations/qa__layout-check/runs';

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[1] }),
      ).toHaveAttribute('href', '/dashboard/$id/automations');
    });

    it('opens the same entry point from a section the user is not in', () => {
      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[2] }),
      ).toHaveAttribute('href', '/dashboard/$id/projects');
    });

    it('opens a fresh composer when re-entering chat', () => {
      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[0] }),
      ).toHaveAttribute('data-search', '{"new":true}');
    });

    it('does not apply the re-entry search to a section left alone', () => {
      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[2] }),
      ).not.toHaveAttribute('data-search');
    });

    it('resumes rather than starting fresh when entering chat from elsewhere', () => {
      // The re-entry search belongs to the ACTIVE tile only. Leaking it to an
      // inactive chat tile would replace "reopen my last chat" with a blank
      // composer on every arrival from another section.
      mockLocation.pathname = '/dashboard/test-org/projects';

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[0] }),
      ).not.toHaveAttribute('data-search');
    });
  });
});

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
const { primaryLabels, externalLabel, mockLocation, mockReadNavTarget } =
  vi.hoisted(() => ({
    primaryLabels: ['Chat', 'Automations', 'Projects', 'Agents'],
    externalLabel: 'Help center',
    mockLocation: { pathname: '/dashboard/test-org/chat' },
    mockReadNavTarget: vi.fn(),
  }));

type MockLinkProps = React.ComponentProps<'a'> & {
  to?: string;
  params?: Record<string, string>;
  preload?: string;
  search?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

vi.mock('@tanstack/react-router', () => ({
  // Router-only props (`to`, `params`, `preload`) are stripped so that only real
  // DOM attributes — crucially `aria-label` — reach the rendered anchor.
  Link: React.forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
    {
      to,
      params: _params,
      preload: _preload,
      search,
      state,
      children,
      ...rest
    },
    ref,
  ) {
    // `search` and `state` are router props, not DOM attributes — surface them
    // as data-* so a test can assert what the rail decided to navigate with.
    return (
      <a
        ref={ref}
        href={to}
        data-search={search ? JSON.stringify(search) : undefined}
        data-nav-state={state ? JSON.stringify(state) : undefined}
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

vi.mock('@/app/hooks/use-is-mac', () => ({
  useIsMac: () => false,
}));

vi.mock('@/app/lib/nav-memory', () => ({
  readNavTarget: mockReadNavTarget,
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
        section: 'chat',
        reentrySearch: { new: true },
      },
      {
        label: primaryLabels[1],
        to: '/dashboard/$id/automations',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/automations',
        icon: LayoutGrid,
        section: 'automations',
      },
      {
        label: primaryLabels[2],
        to: '/dashboard/$id/projects',
        params: { id: 'test-org' },
        href: '/dashboard/test-org/projects',
        icon: Folder,
        section: 'projects',
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

beforeEach(() => {
  mockLocation.pathname = '/dashboard/test-org/chat';
  mockReadNavTarget.mockReturnValue(undefined);
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

    it('passes an axe link-name audit', async () => {
      const { container } = render(<SidebarNav organizationId="test-org" />);
      await waitFor(() => checkAccessibility(container));
    });
  });

  // -------------------------------------------------------------------------
  // The rail is where section memory is resolved: section roots never redirect,
  // so a shared `/projects` link still means the projects list.
  // -------------------------------------------------------------------------
  describe('section memory', () => {
    it('reopens the remembered place for a section the user is not in', () => {
      mockReadNavTarget.mockImplementation((_org: string, section: string) =>
        section === 'projects'
          ? { path: 'projects/p1/tasks/board', search: { task: 'AG-31' } }
          : undefined,
      );

      render(<SidebarNav organizationId="test-org" />);

      const link = screen.getByRole('link', { name: primaryLabels[2] });
      expect(link).toHaveAttribute(
        'href',
        '/dashboard/test-org/projects/p1/tasks/board',
      );
      expect(link).toHaveAttribute('data-search', '{"task":"AG-31"}');
    });

    it('marks a restored navigation so a dead target can fall back', () => {
      mockReadNavTarget.mockImplementation((_org: string, section: string) =>
        section === 'projects'
          ? { path: 'projects/p1/tasks/board' }
          : undefined,
      );

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[2] }),
      ).toHaveAttribute('data-nav-state', '{"navRestore":true}');
    });

    it('goes to the default entry for the section already open', () => {
      // Chat is active (see mockLocation) AND has a remembered thread. The
      // active tile is the one-click way back out, so the memory must lose.
      mockReadNavTarget.mockReturnValue({ path: 'chat/t-remembered' });

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[0] }),
      ).toHaveAttribute('href', '/dashboard/$id/chat');
    });

    it('opens a fresh composer when re-entering chat', () => {
      mockReadNavTarget.mockReturnValue(undefined);

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[0] }),
      ).toHaveAttribute('data-search', '{"new":true}');
    });

    it('does not apply the re-entry search to a section left alone', () => {
      mockReadNavTarget.mockReturnValue(undefined);

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
      mockReadNavTarget.mockReturnValue(undefined);

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[0] }),
      ).not.toHaveAttribute('data-search');
    });

    it('falls back to the section default when nothing is remembered', () => {
      mockReadNavTarget.mockReturnValue(undefined);

      render(<SidebarNav organizationId="test-org" />);

      expect(
        screen.getByRole('link', { name: primaryLabels[2] }),
      ).toHaveAttribute('href', '/dashboard/$id/projects');
    });
  });
});

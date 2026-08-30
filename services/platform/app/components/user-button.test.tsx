import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { UserButton } from './user-button';

// i18n: the component pulls from three namespaces — `auth`, `navigation`, and
// `global`. The inner `t()` receives the namespace-relative key, so the map is
// keyed by relative path. Strings mirror the real en.json values the e2e
// asserts against (messages/en.json + messages/global.json), so the migrated
// "user menu" test stays faithful to the spec it replaces.
vi.mock('@/lib/i18n/client', () => ({
  useT: (_ns: string) => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        // auth.userButton.*
        'userButton.defaultName': 'User',
        'userButton.documentation': 'Documentation',
        'userButton.logOut': 'Log out',
        'userButton.logOutConfirm.title': 'Log out',
        'userButton.logOutConfirm.description':
          'Are you sure you want to log out?',
        'userButton.logOutConfirm.confirm': 'Log out',
        'userButton.manageAccount': 'Manage account',
        'userButton.toast.signOutFailed': 'Sign out failed',
        'userButton.language': 'Language',
        'userButton.themeSystem': 'System theme',
        'userButton.themeLight': 'Light theme',
        'userButton.themeDark': 'Dark theme',
        // navigation.*
        'orgSwitcher.label': 'Organization',
        'teamFilter.label': 'Team',
        'teamFilter.allTeams': 'All',
        // global.languages.*
        'languages.en': 'English',
        'languages.de': 'Deutsch',
        'languages.fr': 'Français',
        // common.actions.* (ConfirmDialog cancel button)
        'actions.cancel': 'Cancel',
      };
      return translations[key] ?? key;
    },
  }),
}));

// The org / team / language pickers render as inline collapsibles on mobile and
// Radix sub-menu triggers (role="menuitem") on larger screens. The e2e runs on
// a desktop viewport, where those rows are sub-menu triggers, so pin the hook
// to the desktop branch.
let mockIsMobile = false;
vi.mock('@tale/ui/use-is-mobile', () => ({
  useIsMobile: () => mockIsMobile,
}));

// Mock toast
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/app/hooks/use-changelog-notification', () => ({
  useChangelogNotification: () => ({
    currentVersion: undefined,
    lastSeenVersion: undefined,
    stateLoaded: true,
    hasUnseenVersion: false,
    shouldShowToast: false,
    needsBaseline: false,
    markSeen: vi.fn(),
    markToasted: vi.fn(),
  }),
}));

// Mock theme
const mockSetTheme = vi.fn();
vi.mock('@tale/ui/theme', () => ({
  useTheme: () => ({
    theme: 'system',
    resolvedTheme: 'light',
    setTheme: mockSetTheme,
  }),
  ThemeContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

// Mock auth
const mockSignOut = vi.fn().mockResolvedValue(undefined);
let mockAuthState = {
  user: { name: 'John Doe', email: 'john@example.com' },
  isLoading: false,
  isAuthenticated: true,
  signIn: vi.fn(),
  signOut: mockSignOut,
};
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => mockAuthState,
  useSessionUser: () => ({
    isLoading: mockAuthState.isLoading,
    isAuthenticated: mockAuthState.isAuthenticated,
  }),
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useUserOrganizationsWithDetails: () => ({
    organizations: [],
    isLoading: false,
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}));

// Mock current member context
let mockMemberContext = {
  data: { displayName: 'John Doe', role: 'admin' },
  isLoading: false,
};
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => mockMemberContext,
}));

// Mock team filter
let mockTeamFilter: {
  teams: { id: string; name: string }[] | null;
  selectedTeamId: string | null;
  setSelectedTeamId: ReturnType<typeof vi.fn>;
  isLoadingTeams: boolean;
  filterByTeam: <T>(items: T[]) => T[];
} | null = {
  teams: null,
  selectedTeamId: null,
  setSelectedTeamId: vi.fn(),
  isLoadingTeams: false,
  filterByTeam: <T,>(items: T[]) => items,
};
vi.mock('@/app/hooks/use-team-filter', () => ({
  useOptionalTeamFilter: () => mockTeamFilter,
}));

// Mock notifications and PWA hooks — both were added when user-button gained
// a notifications view and an "Install app" entry. The component renders
// `useNotificationsUnreadCount` (TanStack Query under the hood, which needs
// a QueryClient) and `useInstallPrompt` (touches window APIs).
vi.mock('@/app/features/notifications/hooks/queries', () => ({
  useNotificationsUnreadCount: () => ({ data: 0 }),
}));

vi.mock('@tale/ui/pwa/use-install-prompt', () => ({
  useInstallPrompt: () => ({
    canInstall: false,
    isInstalled: false,
    promptInstall: vi.fn().mockResolvedValue('unavailable' as const),
  }),
}));

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ preloadRoute: vi.fn() }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'org-123' }),
  useLocation: () => ({ href: '/dashboard/org-123' }),
}));

// Mock Radix tooltip. `Portal` is included because the account-header label
// inside the open menu renders the app `Tooltip` (which uses Portal); the
// trigger-only tests never opened the menu, but the migrated "user menu" test
// does.
vi.mock('@radix-ui/react-tooltip', () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger: ({
    children,
    asChild: _asChild,
    ...props
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div {...props}>{children}</div>,
  Content: ({ children }: { children: React.ReactNode }) => (
    <div role="tooltip">{children}</div>
  ),
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  mockAuthState = {
    user: { name: 'John Doe', email: 'john@example.com' },
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signOut: mockSignOut,
  };
  mockMemberContext = {
    data: { displayName: 'John Doe', role: 'admin' },
    isLoading: false,
  };
  mockTeamFilter = {
    teams: null,
    selectedTeamId: null,
    setSelectedTeamId: vi.fn(),
    isLoadingTeams: false,
    filterByTeam: <T,>(items: T[]) => items,
  };
  mockIsMobile = false;
});

describe('UserButton', () => {
  function getDropdownTrigger(container: HTMLElement) {
    return container.querySelector('[aria-haspopup="menu"]');
  }

  it('renders without crashing', () => {
    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
  });

  it('shows tooltip text', () => {
    render(<UserButton />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Manage account');
  });

  it('sidebar variant: expanded row shows the display name inline, no tooltip', () => {
    render(<UserButton sidebarExpanded />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('sidebar variant: collapsed tile keeps the hover tooltip', () => {
    render(<UserButton sidebarExpanded={false} />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Manage account');
  });

  it('renders user icon', () => {
    const { container } = render(<UserButton />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders dropdown trigger when auth is loading', () => {
    mockAuthState = {
      ...mockAuthState,
      user: null as never,
      isLoading: true,
      isAuthenticated: false,
    };

    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
  });

  it('renders dropdown trigger with organizationId from route params', () => {
    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
  });

  it('renders without crashing when team filter context is unavailable', () => {
    mockTeamFilter = null;
    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
  });

  it('renders without crashing when teams are present', () => {
    // Exercises the org / team / language picker rows, which render as
    // inline collapsibles on mobile and Radix sub-menu popups on larger
    // screens. Regression guard that the responsive branch builds without
    // crashing when teams are present.
    mockTeamFilter = {
      teams: [
        { id: 'team-1', name: 'Engineering' },
        { id: 'team-2', name: 'Design' },
      ],
      selectedTeamId: 'team-1',
      setSelectedTeamId: vi.fn(),
      isLoadingTeams: false,
      filterByTeam: <T,>(items: T[]) => items,
    };
    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
  });

  // Migrated from tests/e2e/specs/preferences.spec.ts
  // ("user menu: renders the account, preference, and session items"). The
  // assertion is pure rendered-menu structure — no persistence, navigation, or
  // backend enforcement — so it belongs in a jsdom component test. We open the
  // account dropdown and assert the account header, the org/team pickers, the
  // three theme tabs, the language picker, and the session items all render.
  describe('user menu', () => {
    async function openMenu() {
      const result = render(<UserButton />);
      // The trigger toggles the controlled `open` state; click it to open the
      // account dropdown.
      const trigger = result.container.querySelector(
        '[aria-haspopup="menu"]',
      ) as HTMLElement;
      await result.user.click(trigger);
      const menu = await screen.findByRole('menu');
      return { ...result, menu };
    }

    it('renders the account, preference, and session items', async () => {
      // Teams must be present for the team-filter row to render.
      mockTeamFilter = {
        teams: [
          { id: 'team-1', name: 'Engineering' },
          { id: 'team-2', name: 'Design' },
        ],
        selectedTeamId: 'team-1',
        setSelectedTeamId: vi.fn(),
        isLoadingTeams: false,
        filterByTeam: <T,>(items: T[]) => items,
      };

      await openMenu();
      const menu = screen.getByRole('menu');

      // Account header anchors on the owner's email.
      expect(menu).toHaveTextContent('john@example.com');

      // Org + team pickers render as sub-menu triggers (menuitems) on desktop.
      // Each trigger's accessible name is its static label followed by a
      // trailing "current selection" badge, so match on the label prefix.
      expect(
        within(menu).getByRole('menuitem', { name: /^Organization/ }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole('menuitem', { name: /^Team/ }),
      ).toBeInTheDocument();

      // Theme control: the three theme tabs each render with their aria-label.
      expect(
        within(menu).getByRole('tab', { name: 'System theme' }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole('tab', { name: 'Light theme' }),
      ).toBeInTheDocument();
      expect(
        within(menu).getByRole('tab', { name: 'Dark theme' }),
      ).toBeInTheDocument();

      // Language control (sub-menu trigger).
      expect(
        within(menu).getByRole('menuitem', { name: 'Language' }),
      ).toBeInTheDocument();

      // Session items: asserted present, never activated. The Documentation
      // item links out to the maintained docs site, opening in a new tab.
      const documentation = within(menu).getByRole('menuitem', {
        name: 'Documentation',
      });
      expect(documentation).toBeInTheDocument();
      const documentationLink = documentation.closest('a');
      expect(documentationLink).toHaveAttribute(
        'href',
        'https://tale.dev/docs',
      );
      expect(documentationLink).toHaveAttribute('target', '_blank');
      expect(documentationLink).toHaveAttribute('rel', 'noopener noreferrer');
      expect(
        within(menu).getByRole('menuitem', { name: 'Log out' }),
      ).toBeInTheDocument();
    });

    it('restores focus to the menu trigger after cancelling sign out', async () => {
      const result = render(<UserButton />);
      const trigger = screen.getByRole('button', { name: 'Manage account' });
      await result.user.click(trigger);
      const menu = await screen.findByRole('menu');

      await result.user.click(
        within(menu).getByRole('menuitem', { name: 'Log out' }),
      );

      const dialog = await screen.findByRole('dialog', { name: 'Log out' });
      expect(dialog).toBeInTheDocument();

      await result.user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<UserButton />);
      // Disable aria-allowed-attr: Radix mocks render <div> with
      // aria-haspopup/aria-expanded which axe flags without a proper role.
      await checkAccessibility(container, {
        rules: { 'aria-allowed-attr': { enabled: false } },
      });
    });
  });
});

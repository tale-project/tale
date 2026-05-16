import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { UserButton } from '../user-button';

vi.mock('@/lib/i18n/client', () => ({
  useT: (_ns: string) => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'userButton.defaultName': 'User',
        'userButton.helpFeedback': 'Help & Feedback',
        'userButton.logOut': 'Log out',
        'userButton.manageAccount': 'Manage account',
        'userButton.toast.signOutFailed': 'Sign out failed',
        'teamFilter.label': 'Team filter',
        'teamFilter.allTeams': 'All teams',
      };
      return translations[key] ?? key;
    },
  }),
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
vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => mockAuthState,
  useConvexAuth: () => ({
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

// Mock router
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ preloadRoute: vi.fn() }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'org-123' }),
  useLocation: () => ({ href: '/dashboard/org-123' }),
}));

// Mock Radix tooltip
vi.mock('@radix-ui/react-tooltip', () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
});

describe('UserButton', () => {
  function getDropdownTrigger(container: HTMLElement) {
    return container.querySelector('[aria-haspopup="menu"]');
  }

  it('renders without crashing', () => {
    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
  });

  it('renders with a label for mobile navigation', () => {
    render(<UserButton label="Account" />);
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('shows tooltip text', () => {
    render(<UserButton />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Manage account');
  });

  it('shows custom tooltip text', () => {
    render(<UserButton tooltipText="My profile" />);
    expect(screen.getByRole('tooltip')).toHaveTextContent('My profile');
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

  it('does not render tooltip wrapper when label is provided', () => {
    render(<UserButton label="Account" />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('renders without crashing when team filter context is unavailable', () => {
    mockTeamFilter = null;
    const { container } = render(<UserButton />);
    expect(getDropdownTrigger(container)).toBeInTheDocument();
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

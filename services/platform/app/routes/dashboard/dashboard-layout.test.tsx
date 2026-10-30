// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createContext, useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionLapseRecovery } from '@/app/components/session-lapse-recovery';
import { useAbilityLoading } from '@/app/hooks/use-ability';
import { ORG_SWITCH_TIMEOUT_MS } from '@/app/lib/auth/set-active-organization';
import {
  cacheMemberContext,
  clearMemberContextCache,
} from '@/app/lib/member-context-cache';

// jsdom doesn't ship ResizeObserver; Radix primitives (popovers, sheets,
// tooltips) pulled in by the layout's children depend on it. Stub before any
// component mounts.
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver =
  MockResizeObserver as unknown as typeof ResizeObserver;

// --- Mocks ---

const mockUseParams = vi.fn(() => ({ id: 'test-org-id' }));
const mockNavigate = vi.fn();

// The shell's outlet holds a probe that reports what a page under it reads
// from the shell, unless a test mounts a real child layout there; that
// layout's own outlet is then the probe.
const outletLayout = vi.hoisted(() => ({
  current: null as React.ComponentType | null,
}));
const OutletDepth = createContext(0);
function OutletProbe() {
  const depth = useContext(OutletDepth);
  const abilityLoading = useAbilityLoading();
  const Layout = depth === 0 ? outletLayout.current : null;
  if (Layout) {
    return (
      <OutletDepth.Provider value={depth + 1}>
        <Layout />
      </OutletDepth.Provider>
    );
  }
  return (
    <div data-testid="outlet" data-ability-loading={String(abilityLoading)} />
  );
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    // DashboardLayout warms the chat config catalog in an auth-gated effect via
    // Route.useRouteContext(); stub it so the prewarm is a harmless no-op here.
    useRouteContext: () => ({
      queryClient: { fetchQuery: vi.fn().mockResolvedValue(undefined) },
    }),
    ...config,
  }),
  Outlet: () => <OutletProbe />,
  // A failed switch's way back is a link; it reports where it goes.
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: { id: string };
    children: React.ReactNode;
  }) => <a href={to.replace('$id', params?.id ?? '')}>{children}</a>,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/dashboard/test-org-id' }),
  useParams: () => mockUseParams(),
  useBlocker: () => ({ status: 'idle', proceed: vi.fn(), reset: vi.fn() }),
}));

// The Home panel reads the chat, task and inbox lanes; the layout test only
// asserts the frame around it.
vi.mock('@/app/features/home/components/home-panel', () => ({
  HomePanel: () => <nav data-testid="home-panel" />,
}));

vi.mock('@/app/features/auth/hooks/use-password-expiry-gate', () => ({
  usePasswordExpiryGate: vi.fn(),
}));

const mockUseConvexAuth = vi.fn(() => ({
  isLoading: false,
  isAuthenticated: true,
}));
// The layout reads the session probe through useAuth; control its flags here.
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => mockUseConvexAuth(),
}));

// The org hint stream (EventSource) is out of scope here.
vi.mock('@/app/lib/backend/use-backend-hints', () => ({
  useBackendHints: vi.fn(),
}));

// The layout's one plain query is the session probe.
const mockUseQuery = vi.fn((): { data: unknown } => ({ data: undefined }));
vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: unknown) => options,
  useQuery: () => mockUseQuery(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const mockSetActive = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn().mockResolvedValue({ data: null }),
    organization: { setActive: mockSetActive },
  },
}));

// The audit entry a switch leaves; the layout's other reads stay real.
const mockRecordOrgSwitch = vi.hoisted(() => vi.fn());
vi.mock('@/app/lib/backend/org', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/org')>()),
  recordOrgSwitch: mockRecordOrgSwitch,
}));

// The organizations a failed switch names.
vi.mock('@/app/features/organization/hooks/queries', () => ({
  useUserOrganizationsWithDetails: () => ({
    organizations: [
      { organizationId: 'test-org-id', role: 'admin', name: 'Globex' },
      { organizationId: 'other-org-id', role: 'owner', name: 'Acme' },
    ],
  }),
}));

const mockUseCurrentMemberContext = vi.fn(
  (_organizationId?: string, _skip?: boolean) =>
    ({ data: null, isLoading: true, isError: false }) as {
      data: Record<string, unknown> | null | undefined;
      isLoading: boolean;
      isError: boolean;
      isFetching?: boolean;
      errorUpdateCount?: number;
      refetch?: () => Promise<unknown>;
    },
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: (organizationId?: string, skip?: boolean) =>
    mockUseCurrentMemberContext(organizationId, skip),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

// The ability grants nothing unless a test names the subjects it grants.
const grantedSubjects = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/permissions/ability', () => ({
  defineAbilityFor: () => ({
    can: (_action: string, subject: string) => grantedSubjects.has(subject),
    cannot: (_action: string, subject: string) => !grantedSubjects.has(subject),
  }),
}));

vi.mock('@/app/features/auth/components/two-factor-grace-banner', () => ({
  TwoFactorGraceBanner: () => null,
}));

vi.mock(
  '@/app/features/auth/components/two-factor-low-backup-codes-banner',
  () => ({
    TwoFactorLowBackupCodesBanner: () => null,
  }),
);

vi.mock('@/app/features/changelog/components/changelog-toast-trigger', () => ({
  ChangelogToastTrigger: () => null,
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  BrandingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useBrandingContext: () => ({ accentColor: undefined, logoUrl: undefined }),
}));

vi.mock('@tale/ui/adaptive-header', () => ({
  AdaptiveHeaderProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AdaptiveHeaderSlot: () => null,
  AdaptiveHeaderRoot: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AdaptiveHeaderTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

// The Knowledge layout's tab strip links into the router.
vi.mock('@/app/features/knowledge/components/knowledge-navigation', () => ({
  KnowledgeNavigation: () => <nav aria-label="knowledge tabs" />,
}));

vi.mock('@/app/components/layout/app-sidebar/sidebar-context', () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/app/components/layout/app-sidebar/app-sidebar', () => ({
  AppSidebar: () => null,
}));

vi.mock('@/app/hooks/use-clock-offset', () => ({
  ClockOffsetProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/app/components/user-button', () => ({
  UserButton: () => null,
}));

vi.mock('@/app/components/layout/mobile-bottom-nav', () => ({
  MobileBottomNav: () => null,
}));

// --- Tests ---

let DashboardLayout: React.ComponentType;

beforeEach(
  async () => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ id: 'test-org-id' });
    mockUseQuery.mockReturnValue({ data: undefined });
    mockSetActive.mockReset().mockResolvedValue({ data: {}, error: null });
    mockRecordOrgSwitch.mockReset().mockResolvedValue(undefined);

    const mod = await import('@/app/routes/dashboard/$id');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DashboardLayout = (mod.Route as any).component as React.ComponentType;
  },
  // The first route import can exceed the 10 s default while the full
  // repository suite transforms hundreds of server test modules in parallel.
  30_000,
);

afterEach(() => {
  cleanup();
  outletLayout.current = null;
  grantedSubjects.clear();
  clearMemberContextCache();
});

/** A member context that loaded once and whose refresh then failed. */
function failedRefresh(
  refetch: () => Promise<unknown> = vi.fn().mockResolvedValue(undefined),
  isFetching = false,
) {
  return {
    data: {
      status: 'ok',
      role: 'admin',
      memberId: 'm1',
      organizationId: 'org-1',
    },
    isLoading: false,
    isError: true,
    isFetching,
    errorUpdateCount: 1,
    refetch,
  };
}

/**
 * A first load: the shell hydrates from the role this tab saw last, while
 * the live member context is still on its way.
 */
function firstLoadFromLastRole() {
  cacheMemberContext({
    userId: 'user-1',
    organizationId: 'test-org-id',
    role: 'admin',
  });
  mockUseQuery.mockReturnValue({
    data: {
      data: {
        user: { id: 'user-1' },
        session: { activeOrganizationId: 'test-org-id' },
      },
    },
  });
  mockUseConvexAuth.mockReturnValue({
    isLoading: false,
    isAuthenticated: true,
  });
  mockUseCurrentMemberContext.mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
  });
}

/** Mounts the real Knowledge layout under the shell's outlet. */
async function mountKnowledgeLayout() {
  const mod = await import('@/app/routes/dashboard/$id/_knowledge');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outletLayout.current = (mod.Route as any).component as React.ComponentType;
}

describe('DashboardLayout', () => {
  it('shows skeleton (not outlet) while Convex auth is loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });

    render(<DashboardLayout />);

    // Outlet must not render until access is confirmed — child routes mount
    // org-scoped Convex subscriptions that throw on UnauthorizedError.
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('shows skeleton (not outlet) while member context query is loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('shows skeleton when both auth and query are loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('renders child routes when auth complete and member has role', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: {
        status: 'ok',
        role: 'admin',
        memberId: 'm1',
        organizationId: 'org-1',
      },
      isLoading: false,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows access denied when user is not a member (no redirect)', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: { status: 'not_member' },
      isLoading: false,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(screen.getByText('accessDenied.noMembership')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    // not_member intentionally preserves the AccessDenied "you've been removed"
    // UX — should NOT trigger redirect.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard/ when organization does not exist', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: { status: 'not_found' },
      isLoading: false,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard',
      replace: true,
    });
    // Until redirect commits, the AccessDenied fallback is shown without
    // layout chrome (no outlet, no Navigation subscriptions).
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('does not redirect twice on re-render with not_found status', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: { status: 'not_found' },
      isLoading: false,
      isError: false,
    });

    const { rerender } = render(<DashboardLayout />);
    rerender(<DashboardLayout />);
    rerender(<DashboardLayout />);

    // useRef guard keeps redirect a one-shot effect across re-renders.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('passes organizationId from route params to useCurrentMemberContext', () => {
    mockUseParams.mockReturnValue({ id: 'my-org-456' });
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(mockUseCurrentMemberContext.mock.calls[0]?.[0]).toBe('my-org-456');
  });

  it('passes skip=true when auth is loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(mockUseCurrentMemberContext.mock.calls[0]?.[1]).toBe(true);
  });

  it('passes skip=false when auth is ready', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
    });

    render(<DashboardLayout />);

    expect(mockUseCurrentMemberContext.mock.calls[0]?.[1]).toBe(false);
  });

  it('shows recoverable failure when query errors without prior data', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<DashboardLayout />);

    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(
      screen.getByText('common.errors.errorLoadingPage'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'common.actions.tryAgain' }),
    );
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      screen.queryByText('accessDenied.refreshFailed.title'),
    ).not.toBeInTheDocument();
  });

  // A refresh that fails keeps the last answer: the pages under the outlet go
  // on with the last known role instead of waiting for access that a failed
  // read never delivers (#4859), and the shell says so with a retry.
  it('keeps outlet visible when query errors but has previous data', () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue(failedRefresh(refetch));

    const { rerender } = render(<DashboardLayout />);

    expect(screen.getByTestId('outlet')).toHaveAttribute(
      'data-ability-loading',
      'false',
    );
    // No placeholder masks the shell: its one status is the notice.
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('accessDenied.refreshFailed.title');
    const retry = within(notice).getByRole('button', {
      name: 'common.actions.tryAgain',
    });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);

    // While the retry runs, the notice stays and Try again is busy.
    mockUseCurrentMemberContext.mockReturnValue(failedRefresh(refetch, true));
    rerender(<DashboardLayout />);
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('outlet')).toHaveAttribute(
      'data-ability-loading',
      'false',
    );
  });

  it("renders a Knowledge tab's content through a failed refresh", async () => {
    grantedSubjects.add('knowledgeRead');
    await mountKnowledgeLayout();
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue(failedRefresh());

    render(<DashboardLayout />);

    expect(
      screen.getByRole('heading', { name: 'knowledge.title' }),
    ).toBeInTheDocument();
    // The Knowledge layout holds its tab back only while access loads.
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('reports access as loading under the outlet on a first load from the last role', () => {
    firstLoadFromLastRole();

    render(<DashboardLayout />);

    expect(screen.getByTestId('outlet')).toHaveAttribute(
      'data-ability-loading',
      'true',
    );
    expect(
      screen.queryByText('accessDenied.refreshFailed.title'),
    ).not.toBeInTheDocument();
  });

  it('holds a Knowledge tab back while access is still loading', async () => {
    grantedSubjects.add('knowledgeRead');
    await mountKnowledgeLayout();
    firstLoadFromLastRole();

    render(<DashboardLayout />);

    expect(
      screen.getByRole('heading', { name: 'knowledge.title' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('keeps the live nav rail during a membership refetch with no placeholder flash', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: {
        status: 'ok',
        role: 'admin',
        memberId: 'm1',
        organizationId: 'org-1',
      },
      isLoading: false,
      isError: false,
    });

    const { rerender } = render(<DashboardLayout />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    mockUseCurrentMemberContext.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    rerender(<DashboardLayout />);

    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The last role keeps the rail, but access is still being loaded.
    expect(screen.getByTestId('outlet')).toHaveAttribute(
      'data-ability-loading',
      'true',
    );
  });

  // A notice floating over the page covered a phone's header — its
  // navigation and actions — until the person signed in. In the shell it
  // sits in the alert stack, above the page, once.
  it("shows a lapsed session's standing notice in the shell's alert stack", () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: {
        status: 'ok',
        role: 'admin',
        memberId: 'm1',
        organizationId: 'org-1',
      },
      isLoading: false,
      isError: false,
    });

    render(
      <SessionLapseRecovery
        recovery={{
          isLapsed: true,
          open: false,
          checking: false,
          checkFailed: false,
          liveSessionVersion: 0,
          setOpen: vi.fn(),
          continueToLogIn: vi.fn(),
        }}
      >
        <DashboardLayout />
      </SessionLapseRecovery>,
    );

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('auth.sessionLapse.title');
    expect(
      screen.getAllByRole('button', { name: 'auth.sessionLapse.signIn' }),
    ).toEqual([within(notice).getByRole('button')]);
    expect(
      notice.compareDocumentPosition(screen.getByTestId('outlet')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(notice.className).not.toMatch(/\bfixed\b/);
  });
});

describe("the session's switch to the address's organization", () => {
  /** A member of this organization whose session is still in another. */
  function sessionElsewhere() {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseQuery.mockReturnValue({
      data: {
        data: {
          user: { id: 'user-1' },
          session: { activeOrganizationId: 'other-org-id' },
        },
      },
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: {
        status: 'ok',
        role: 'admin',
        memberId: 'm1',
        organizationId: 'test-org-id',
      },
      isLoading: false,
      isError: false,
    });
  }

  // Better Auth answers a refusal instead of throwing it: the layout
  // recorded the switch and held its spinner for good.
  it('says it failed, records nothing and stops spinning when the server refuses it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sessionElsewhere();
    mockSetActive.mockResolvedValue({
      data: null,
      error: {
        status: 429,
        statusText: 'Too Many Requests',
        message: 'Too many requests. Please try again later.',
      },
    });

    render(<DashboardLayout />);

    expect(
      await screen.findByText('navigation.orgSwitcher.switchFailed'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Too many requests. Please try again later.'),
    ).toBeInTheDocument();
    expect(mockSetActive).toHaveBeenCalledWith({
      organizationId: 'test-org-id',
    });
    expect(mockRecordOrgSwitch).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('status', {
        name: 'navigation.orgSwitcher.switchingLabel',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    // Back to the organization the session is still in, or Try again.
    expect(
      screen.getByRole('link', { name: 'navigation.orgSwitcher.backTo' }),
    ).toHaveAttribute('href', '/dashboard/other-org-id');
    expect(
      screen.getByRole('button', { name: 'common.actions.tryAgain' }),
    ).toBeEnabled();
  });

  it('switches again on Try again, and records only the switch that happened', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sessionElsewhere();
    mockSetActive.mockResolvedValueOnce({
      data: null,
      error: { status: 503, statusText: 'Service Unavailable' },
    });

    render(<DashboardLayout />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'common.actions.tryAgain' }),
    );

    await waitFor(() => expect(mockRecordOrgSwitch).toHaveBeenCalledTimes(1));
    expect(mockRecordOrgSwitch).toHaveBeenCalledWith('test-org-id');
    expect(mockSetActive).toHaveBeenCalledTimes(2);
    // Until the session reads the new organization, the spinner stands again.
    expect(
      screen.queryByText('navigation.orgSwitcher.switchFailed'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', {
        name: 'navigation.orgSwitcher.switchingLabel',
      }),
    ).toBeInTheDocument();
  });

  it('says the switch did not finish once the bound passes, instead of spinning for good', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      sessionElsewhere();
      mockSetActive.mockReturnValue(new Promise(() => {}));

      render(<DashboardLayout />);
      expect(
        screen.getByRole('status', {
          name: 'navigation.orgSwitcher.switchingLabel',
        }),
      ).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(ORG_SWITCH_TIMEOUT_MS);
      });
      expect(
        screen.getByText('navigation.orgSwitcher.switchFailed'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('navigation.orgSwitcher.switchTimedOut'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('status', {
          name: 'navigation.orgSwitcher.switchingLabel',
        }),
      ).not.toBeInTheDocument();
      expect(mockRecordOrgSwitch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

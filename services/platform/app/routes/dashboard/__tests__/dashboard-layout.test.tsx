// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---

const mockUseParams = vi.fn(() => ({ id: 'test-org-id' }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    ...config,
  }),
  Outlet: () => <div data-testid="outlet" />,
}));

const mockUseConvexAuth = vi.fn(() => ({
  isLoading: false,
  isAuthenticated: true,
}));
vi.mock('convex/react', () => ({
  useConvexAuth: () => mockUseConvexAuth(),
}));

const mockUseCurrentMemberContext = vi.fn(
  (_organizationId?: string, _skip?: boolean) =>
    ({ data: null, isLoading: true }) as {
      data: Record<string, unknown> | null | undefined;
      isLoading: boolean;
    },
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: (organizationId?: string, skip?: boolean) =>
    mockUseCurrentMemberContext(organizationId, skip),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@/lib/permissions/ability', () => ({
  defineAbilityFor: () => ({ can: () => false, cannot: () => true }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    members: { queries: { getCurrentMemberContext: 'mock-query-ref' } },
  },
}));

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: vi.fn(),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  BrandingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('@/app/components/layout/adaptive-header', () => ({
  AdaptiveHeaderProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AdaptiveHeaderSlot: () => null,
}));

vi.mock('@/app/components/ui/navigation/mobile-navigation', () => ({
  MobileNavigation: () => null,
}));

vi.mock('@/app/components/ui/navigation/navigation', () => ({
  Navigation: () => null,
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  TeamFilterProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// --- Tests ---

let DashboardLayout: React.ComponentType;

beforeEach(async () => {
  vi.clearAllMocks();
  mockUseParams.mockReturnValue({ id: 'test-org-id' });

  const mod = await import('@/app/routes/dashboard/$id');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DashboardLayout = (mod.Route as any).component as React.ComponentType;
});

afterEach(() => {
  cleanup();
});

describe('DashboardLayout', () => {
  it('shows spinner when Convex auth is loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: false,
    });

    render(<DashboardLayout />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows spinner when member context query is loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
    });

    render(<DashboardLayout />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows spinner when both auth and query are loading', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: true,
    });

    render(<DashboardLayout />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('renders child routes when auth complete and member has role', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: { role: 'admin', memberId: 'm1', organizationId: 'org-1' },
      isLoading: false,
    });

    render(<DashboardLayout />);

    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows access denied when auth complete but no role', () => {
    mockUseConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    });
    mockUseCurrentMemberContext.mockReturnValue({
      data: null,
      isLoading: false,
    });

    render(<DashboardLayout />);

    expect(screen.getByText('accessDenied.noMembership')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    });

    render(<DashboardLayout />);

    expect(mockUseCurrentMemberContext).toHaveBeenCalledWith('my-org-456');
  });
});

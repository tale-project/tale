import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils/render';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_test',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: vi.fn().mockReturnValue({
    data: null,
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      { userId: 'user_1', displayName: 'Alice', email: 'alice@test.com' },
      { userId: 'user_2', displayName: 'Bob', email: 'bob@test.com' },
    ],
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [
      { id: 'team_1', name: 'Engineering' },
      { id: 'team_2', name: 'Marketing' },
    ],
  }),
}));

const { useGovernancePolicy } = await import('../hooks/queries');
const mockedUseGovernancePolicy = vi.mocked(useGovernancePolicy);

const { FeatureFlagsEditor } = await import('./feature-flags-editor');

describe('FeatureFlagsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseGovernancePolicy.mockReturnValue({
      data: null,
      isLoading: false,
    } as never);
  });

  it('renders empty state when no rules exist', () => {
    render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(
      screen.getByText(/no feature control rules configured/i),
    ).toBeInTheDocument();
  });

  it('renders rules table when rules exist', () => {
    mockedUseGovernancePolicy.mockReturnValue({
      data: {
        config: {
          enabled: true,
          rules: [
            {
              scope: 'default',
              webSearch: true,
              codeExecution: false,
              fileUpload: true,
              maxContextTokens: 32768,
            },
          ],
        },
      },
      isLoading: false,
    } as never);

    render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('\u2718')).toBeInTheDocument();
  });

  it('renders add rule button', () => {
    render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(
      screen.getByRole('button', { name: /add rule/i }),
    ).toBeInTheDocument();
  });

  it('renders loading skeleton while loading', () => {
    mockedUseGovernancePolicy.mockReturnValue({
      data: null,
      isLoading: true,
    } as never);

    const { container } = render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  describe('loaded state', () => {
    it('is not marked busy once loaded', () => {
      render(<FeatureFlagsEditor organizationId="org_1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps the real table header while loaded', () => {
      render(<FeatureFlagsEditor organizationId="org_1" />);
      expect(
        screen.getByRole('heading', { name: /feature controls/i }),
      ).toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    beforeEach(() => {
      mockedUseGovernancePolicy.mockReturnValue({
        data: null,
        isLoading: true,
      } as never);
    });

    it('exposes a single busy/status region', () => {
      render(<FeatureFlagsEditor organizationId="org_1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('keeps the real table header while loading (no gray bars)', () => {
      render(<FeatureFlagsEditor organizationId="org_1" />);
      expect(
        screen.getByRole('heading', { name: /feature controls/i }),
      ).toBeInTheDocument();
    });

    it('renders placeholder rows, not the empty-state, while loading', () => {
      const { container } = render(
        <FeatureFlagsEditor organizationId="org_1" />,
      );
      // Empty-state copy must NOT show during load (an empty tbody would read
      // as "no rules").
      expect(
        screen.queryByText(/no feature control rules configured/i),
      ).not.toBeInTheDocument();
      // 3 placeholder rows in the body, each with the real column count.
      const bodyRows = container.querySelectorAll('tbody tr');
      expect(bodyRows).toHaveLength(3);
      expect(bodyRows[0].querySelectorAll('td')).toHaveLength(7);
    });
  });
});

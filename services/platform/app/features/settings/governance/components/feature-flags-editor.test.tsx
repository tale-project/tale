import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
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

  it('renders enabled toggle', () => {
    render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('renders loading skeleton while loading', () => {
    mockedUseGovernancePolicy.mockReturnValue({
      data: null,
      isLoading: true,
    } as never);

    const { container } = render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with empty state', async () => {
      const { container } = render(
        <FeatureFlagsEditor organizationId="org_1" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with rules table', async () => {
      mockedUseGovernancePolicy.mockReturnValue({
        data: {
          config: {
            enabled: true,
            rules: [
              {
                scope: 'default',
                webSearch: true,
                codeExecution: true,
                fileUpload: true,
              },
            ],
          },
        },
        isLoading: false,
      } as never);

      const { container } = render(
        <FeatureFlagsEditor organizationId="org_1" />,
      );
      await checkAccessibility(container);
    });
  });
});

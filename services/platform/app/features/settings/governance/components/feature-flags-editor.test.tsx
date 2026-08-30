import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen } from '@/tests/utils/render';

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

// Hoisted so the save spy is inspectable across renders (each render must see
// the SAME `mutateAsync`, not a fresh `vi.fn()`).
const { saveMutateAsync } = vi.hoisted(() => ({
  saveMutateAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: saveMutateAsync,
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

/**
 * The section is opt-in: a policy that has never been configured reads off, and
 * a section that is off shows no rules table and no Add-rule button. Tests that
 * exercise the body switch the section on first — which is also the real flow
 * (turn the feature on, then add rules).
 */
function setSectionOn(rules: unknown[] = []) {
  mockedUseGovernancePolicy.mockReturnValue({
    data: { config: { enabled: true, rules } },
    isLoading: false,
  } as never);
}

describe('FeatureFlagsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSectionOn();
  });

  it('renders empty state when no rules exist', () => {
    render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(
      screen.getByText(/no feature control rules configured/i),
    ).toBeInTheDocument();
  });

  it('hides the rules table and Add-rule while the section is off', () => {
    mockedUseGovernancePolicy.mockReturnValue({
      data: null,
      isLoading: false,
    } as never);

    render(<FeatureFlagsEditor organizationId="org_1" />);

    expect(
      screen.getByRole('switch', { name: /feature controls/i }),
    ).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /add rule/i })).toBeNull();
    expect(
      screen.queryByText(/no feature control rules configured/i),
    ).toBeNull();
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

  // #2660: a sub-4096 "Max context tokens" used to save optimistically, then
  // fail server-side with an uncaught AppError — nothing persisted, no
  // user-visible error. The client must now block it inline instead.
  describe('Max context tokens floor (#2660)', () => {
    it('blocks a sub-4096 value with an inline error and does not save', async () => {
      const { user } = render(<FeatureFlagsEditor organizationId="org_1" />);
      await user.click(screen.getByRole('button', { name: /add rule/i }));

      const tokensInput = screen.getByLabelText(/max context tokens/i);
      await user.type(tokensInput, '1000');

      expect(screen.getByRole('alert')).toHaveTextContent(/4,096|4096/);
      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      expect(confirmButton).toBeDisabled();

      await user.click(confirmButton);
      expect(saveMutateAsync).not.toHaveBeenCalled();
    });

    it('lets a quick-set preset button clear the error and save', async () => {
      const { user } = render(<FeatureFlagsEditor organizationId="org_1" />);
      await user.click(screen.getByRole('button', { name: /add rule/i }));

      const tokensInput = screen.getByLabelText(/max context tokens/i);
      await user.type(tokensInput, '1000');
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '8K' }));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      const confirmButton = screen.getByRole('button', { name: /confirm/i });
      expect(confirmButton).not.toBeDisabled();
      await user.click(confirmButton);

      expect(saveMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          policyType: 'feature_flags',
          config: expect.objectContaining({
            rules: [expect.objectContaining({ maxContextTokens: 8192 })],
          }),
        }),
      );
    });
  });
});

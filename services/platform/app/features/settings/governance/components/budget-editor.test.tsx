import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// The rule dialog's FormDialog reads the org id from route params; provide it
// directly so the editor renders without a RouterProvider in tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const STABLE_MEMBERS = { members: [] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, rules: [] as unknown[] } as
      | Record<string, unknown>
      | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

const { BudgetEditor } = await import('./budget-editor');

function setLoaded(rules: unknown[] = []) {
  state.isLoading = false;
  state.config = { enabled: true, rules };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('BudgetEditor', () => {
  describe('loaded state', () => {
    it('renders the empty state when no rules exist', () => {
      setLoaded([]);
      render(<BudgetEditor organizationId="org-1" />);
      expect(
        screen.getByText(/no budget rules configured/i),
      ).toBeInTheDocument();
    });

    it('renders a real rule row when rules exist', () => {
      setLoaded([
        { scope: 'default', period: 'monthly', maxTokens: 1_000_000 },
      ]);
      render(<BudgetEditor organizationId="org-1" />);
      expect(screen.getByText('default')).toBeInTheDocument();
      expect(screen.getByText('monthly')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded([]);
      render(<BudgetEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /budget rules/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded([]);
      render(<BudgetEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<BudgetEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('keeps the real section heading while loading (no gray bars)', () => {
      setLoading();
      render(<BudgetEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /budget rules/i }),
      ).toBeInTheDocument();
    });

    it('renders placeholder rows, not the empty-state, while loading', () => {
      setLoading();
      const { container } = render(<BudgetEditor organizationId="org-1" />);
      // An empty tbody would read as "no rules" — assert the empty-state copy
      // is absent and that masked placeholder rows stand in instead.
      expect(
        screen.queryByText(/no budget rules configured/i),
      ).not.toBeInTheDocument();
      const bodyRows = container.querySelectorAll('tbody tr');
      expect(bodyRows).toHaveLength(3);
      expect(bodyRows[0].querySelectorAll('td')).toHaveLength(7);
    });

    it('masks the action buttons (no live edit/remove buttons while loading)', () => {
      setLoading();
      render(<BudgetEditor organizationId="org-1" />);
      // The only button in the a11y tree is the masked header action which is
      // itself aria-hidden; per-row edit/remove buttons are absent.
      expect(
        screen.queryByRole('button', { name: /remove rule/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('structural parity (skeleton matches content)', () => {
    it('renders the same column count in both states', () => {
      setLoaded([
        { scope: 'default', period: 'monthly', maxTokens: 1_000_000 },
      ]);
      const loaded = render(<BudgetEditor organizationId="org-1" />);
      const loadedCols = loaded.container
        .querySelector('tbody tr')
        ?.querySelectorAll('td').length;
      loaded.unmount();

      setLoading();
      const loading = render(<BudgetEditor organizationId="org-1" />);
      const loadingCols = loading.container
        .querySelector('tbody tr')
        ?.querySelectorAll('td').length;

      expect(loadingCols).toBe(loadedCols);
      expect(loadedCols).toBe(7);
    });
  });
});

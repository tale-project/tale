import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

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
//
// `result` is the object the mocked hook hands back. It MUST be referentially
// stable between renders: the real react-query/convex hook returns a stable
// value until the data changes, and the editor's `savedConfig` memo (plus the
// effect that seeds `rules` from it) is keyed on that reference. Returning a
// fresh `{ data, isLoading }` object per render re-seeds `rules` every render,
// which spins an unbounded re-render loop that exhausts the heap (the whole
// worker OOMs). Rebuild the snapshot only when a scenario helper changes state.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, rules: [] as unknown[] } as
      | Record<string, unknown>
      | undefined,
    result: undefined as unknown,
  },
}));

function refreshPolicy() {
  state.result = {
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  };
}
refreshPolicy();

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => state.result,
}));

const { BudgetEditor } = await import('./budget-editor');

function setLoaded(rules: unknown[] = []) {
  state.isLoading = false;
  state.config = { enabled: true, rules };
  refreshPolicy();
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
  refreshPolicy();
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

  // Issue #2061: the editor must not persist a "silently dead" rule — a
  // user/team/role scope with no target, or a rule with no positive limit.
  describe('rule dialog validation (#2061)', () => {
    it('blocks saving a rule with no limit set and shows an inline error', async () => {
      setLoaded([]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      // The Add dialog is open (default scope, no limits → invalid).
      expect(
        await screen.findByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      // The limit-required error surfaces and the dialog stays open (no save).
      expect(
        await screen.findByText(/set at least one limit/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();
      // No rule was committed — the table still shows the empty state.
      expect(
        screen.getByText(/no budget rules configured/i),
      ).toBeInTheDocument();
    });

    it('saves a default-scope rule once a positive limit is provided', async () => {
      setLoaded([]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      const tokenInput = await screen.findByLabelText(/max tokens/i);
      await user.type(tokenInput, '1000000');

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      // Dialog closed (saved) and the new rule row is shown.
      expect(
        screen.queryByRole('button', { name: /confirm/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('default')).toBeInTheDocument();
    });

    // The headline case of #2061: a user/team/role scope with no target is a
    // permanently dead rule (the enforcer requires a `scopeId` match). Editing a
    // pre-seeded role rule that has a limit but no target exercises the
    // target-required guard without driving the Radix scope <Select>.
    it('blocks saving a scoped (role) rule with no target and shows an inline error', async () => {
      setLoaded([{ scope: 'role', period: 'monthly', maxTokens: 1_000_000 }]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      expect(
        await screen.findByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      // The target-required error surfaces and the dialog stays open (no save).
      expect(
        await screen.findByText(/select a target for this scope/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();
    });

    it('saves a scoped (role) rule once a target and limit are present', async () => {
      setLoaded([
        {
          scope: 'role',
          scopeId: 'admin',
          period: 'monthly',
          maxTokens: 1_000_000,
        },
      ]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      expect(
        await screen.findByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      // No target/limit error — the dialog closes (saved).
      expect(
        screen.queryByRole('button', { name: /confirm/i }),
      ).not.toBeInTheDocument();
    });

    // A per-field `0` is not "no limit": the enforcer reads it as the strictest
    // cap and blocks every request. Typing `0` must be rejected, not saved.
    it('rejects a limit field set to zero (a "block-everything" rule)', async () => {
      setLoaded([]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      const tokenInput = await screen.findByLabelText(/max tokens/i);
      await user.type(tokenInput, '0');

      await user.click(screen.getByRole('button', { name: /confirm/i }));

      // The per-field "must be greater than zero" error surfaces, the dialog
      // stays open, and nothing is committed.
      expect(
        await screen.findByText(/must be greater than zero/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /confirm/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/no budget rules configured/i),
      ).toBeInTheDocument();
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

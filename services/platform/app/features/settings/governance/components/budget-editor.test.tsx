import { AppShell } from '@tale/ui/app-shell';
import { cleanup, render as renderWithProviders } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen, within } from '@/tests/utils/render';

vi.mock('@tale/ui/use-toast', () => ({
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

const upsert = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: upsert, isPending: false }),
}));

const STABLE_MEMBERS = { members: [] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

// The apiKey budget scope's picker reads every member's API key (the
// admin-only org listing), not only the admin's own. Mock with a
// referentially-stable result (same rationale as the policy mock below) so the
// editor's memos don't re-run every render. One live key so the picker has an
// option and the table can resolve an apiKeyId to its name and owner, then the
// keys saved rules still name after they stopped being live — each in the
// state the listing describes it in.
const STABLE_API_KEYS = {
  data: [
    {
      id: 'key-1',
      name: 'CI Key',
      start: 'taleAB',
      userId: 'u-dana',
      ownerName: 'Dana',
      ownerEmail: 'dana@example.test',
      createdAt: 1,
      expiresAt: null,
      status: 'active',
    },
    {
      id: 'key-expired',
      name: 'Nightly export',
      start: 'taleCD',
      userId: 'u-dana',
      ownerName: 'Dana',
      ownerEmail: 'dana@example.test',
      createdAt: null,
      expiresAt: 2,
      status: 'expired',
    },
    {
      id: 'key-revoked',
      name: 'opencode laptop',
      start: 'taleEF',
      userId: 'u-dario',
      ownerName: null,
      ownerEmail: 'dario@example.test',
      createdAt: null,
      expiresAt: null,
      status: 'revoked',
    },
    {
      id: 'key-left',
      name: 'Old script',
      start: 'taleGH',
      userId: 'u-gone',
      ownerName: 'Former Person',
      ownerEmail: null,
      createdAt: null,
      expiresAt: null,
      status: 'holder_left',
    },
    {
      id: 'key-unavailable',
      name: 'Archived export',
      start: 'taleJK',
      userId: 'u-dana',
      ownerName: 'Dana',
      ownerEmail: 'dana@example.test',
      createdAt: null,
      expiresAt: null,
      status: 'unavailable',
    },
    {
      id: 'key-unknown',
      name: null,
      start: null,
      userId: null,
      ownerName: null,
      ownerEmail: null,
      createdAt: null,
      expiresAt: null,
      status: 'unknown',
    },
  ] as unknown[],
};
// The projects a project rule can cap, archived ones included: the table
// still names the project a saved rule caps after it was archived.
const STABLE_PROJECTS = {
  data: [
    { _id: 'project-1', name: 'Website relaunch' },
    { _id: 'project-2', name: 'Annual report' },
    { _id: 'project-old', name: 'Old campaign', archivedAt: 1 },
  ] as unknown[],
  isLoading: false,
};
const backendQueryRefs = vi.hoisted(() => [] as unknown[]);
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (ref: unknown) => {
    backendQueryRefs.push(ref);
    if (ref === 'projects/queries:listProjects') return STABLE_PROJECTS;
    return ref === 'governance/api_keys:listOrgApiKeys'
      ? STABLE_API_KEYS
      : { data: undefined, isLoading: false };
  },
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
    /** The project caps file; null while it was never written. */
    projectConfig: null as Record<string, unknown> | null,
    result: undefined as unknown,
    projectResult: undefined as unknown,
  },
}));

function refreshPolicy() {
  state.result = {
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  };
  state.projectResult = {
    data: state.isLoading
      ? undefined
      : state.projectConfig === null
        ? null
        : { config: state.projectConfig },
    isLoading: state.isLoading,
  };
}
refreshPolicy();

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: (_organizationId: string, policyType: string) =>
    policyType === 'project_budgets' ? state.projectResult : state.result,
}));

const { BudgetEditor } = await import('./budget-editor');

/** The budgets file holding `rules`, and the project caps file holding
 *  `projectRules` (written, and empty, unless they are left out). */
function setLoaded(rules: unknown[] = [], projectRules?: unknown[]) {
  state.isLoading = false;
  state.config = { enabled: true, rules };
  state.projectConfig =
    projectRules !== undefined ? { rules: projectRules } : null;
  refreshPolicy();
}
/** A budgets file as an earlier release saved it: project caps in its own
 *  `projectRules`, and no project caps file yet. */
function setLegacy(rules: unknown[], projectRules: unknown[]) {
  state.isLoading = false;
  state.config = { enabled: true, rules, projectRules };
  state.projectConfig = null;
  refreshPolicy();
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
  state.projectConfig = null;
  refreshPolicy();
}

describe('BudgetEditor', () => {
  it.each(['en', 'de', 'fr'])(
    'localizes role options and table targets (%s) (#4476)',
    async (language) => {
      await i18n.changeLanguage(language);
      try {
        setLoaded([
          {
            scope: 'role',
            scopeId: 'developer',
            period: 'monthly',
            maxTokens: 100,
          },
          {
            scope: 'role',
            scopeId: 'future-role',
            period: 'monthly',
            maxTokens: 100,
          },
          { scope: 'role', period: 'monthly', maxTokens: 100 },
        ]);
        const t = i18n.getFixedT(language, 'governance');
        const user = userEvent.setup();
        renderWithProviders(
          <AppShell i18n={i18n}>
            <BudgetEditor organizationId="org-1" />
          </AppShell>,
        );
        const targetCell = (index: number) => {
          const row = screen
            .getByRole('button', {
              name: t('budgets.editRuleAriaLabel', { index }),
            })
            .closest('tr')!;
          return within(row).getAllByRole('cell')[1];
        };
        expect(targetCell(1).textContent).toBe(
          t('featureFlags.roleLabels.developer'),
        );
        expect(targetCell(2).textContent).toBe('future-role');
        expect(targetCell(3).textContent).toBe('—');
        await user.click(
          screen.getByRole('button', {
            name: t('budgets.editRuleAriaLabel', { index: 1 }),
          }),
        );
        const dialog = within(await screen.findByRole('dialog'));
        const roleSelect = dialog.getByRole('combobox', {
          name: t('budgets.role'),
        });
        expect(roleSelect).toHaveTextContent(
          t('featureFlags.roleLabels.developer'),
        );
        await user.click(roleSelect);
        for (const value of ['admin', 'developer', 'editor', 'member']) {
          expect(
            i18n.exists(`featureFlags.roleLabels.${value}`, {
              lng: language,
              ns: 'governance',
            }),
          ).toBe(true);
          expect(
            screen.getByRole('option', {
              name: t(`featureFlags.roleLabels.${value}`),
            }),
          ).toBeInTheDocument();
        }
        await user.click(
          screen.getByRole('option', {
            name: t('featureFlags.roleLabels.member'),
          }),
        );
        await user.click(
          dialog.getByRole('button', { name: t('budgets.confirm') }),
        );
        expect(targetCell(1).textContent).toBe(
          t('featureFlags.roleLabels.member'),
        );
      } finally {
        cleanup();
        await i18n.changeLanguage('en');
      }
    },
  );

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
      // The scope and the period read as the catalog spells them, not as the
      // stored enum.
      expect(screen.getByRole('cell', { name: 'Default' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'Monthly' })).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded([]);
      render(<BudgetEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /^budget rules$/i }),
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
        screen.getByRole('heading', { name: /^budget rules$/i }),
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
      expect(screen.getByRole('cell', { name: 'Default' })).toBeInTheDocument();
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

    // The apiKey scope carries its target on `apiKeyId` (not `scopeId`). A rule
    // with a limit but no key is a permanently dead rule, so the same
    // target-required guard must fire. Pre-seed an apiKey rule without a target
    // and edit it (avoids driving the Radix scope <Select>).
    it('blocks saving an apiKey rule with no target and shows an inline error', async () => {
      setLoaded([{ scope: 'apiKey', period: 'monthly', maxRequests: 100 }]);
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

    it('saves an apiKey rule once a key target and limit are present', async () => {
      setLoaded([
        {
          scope: 'apiKey',
          apiKeyId: 'key-1',
          period: 'monthly',
          maxRequests: 100,
        },
      ]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      // The table resolves the apiKeyId to the key's name and its owner —
      // any member's key, read from the organization's listing.
      const target = screen.getByRole('cell', { name: /CI Key/ });
      expect(within(target).getByText('CI Key')).toBeInTheDocument();
      expect(within(target).getByText('Dana')).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'API key' })).toBeInTheDocument();
      expect(backendQueryRefs).toContain('governance/api_keys:listOrgApiKeys');

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

    // A rule stores the key's bare id and outlives the key. Its row used to
    // fall back to that id the moment the key left the live listing — a
    // string of random characters with no name and no owner, for a rule
    // another admin may have created.
    it('names a rule’s key, its state and its owner after the key stopped being live', () => {
      setLoaded(
        [
          'key-expired',
          'key-revoked',
          'key-left',
          'key-unavailable',
          'key-unknown',
        ].map((apiKeyId) => ({
          scope: 'apiKey',
          apiKeyId,
          period: 'monthly',
          maxRequests: 100,
        })),
      );
      render(<BudgetEditor organizationId="org-1" />);

      const expired = screen.getByRole('cell', { name: /Nightly export/ });
      expect(within(expired).getByText('Expired')).toBeInTheDocument();
      expect(within(expired).getByText('Dana')).toBeInTheDocument();

      // A deleted key keeps the name and owner the audit trail recorded.
      const revoked = screen.getByRole('cell', { name: /opencode laptop/ });
      expect(within(revoked).getByText('Revoked')).toBeInTheDocument();
      expect(
        within(revoked).getByText('dario@example.test'),
      ).toBeInTheDocument();

      const left = screen.getByRole('cell', { name: /Old script/ });
      expect(within(left).getByText('Former member')).toBeInTheDocument();
      expect(within(left).getByText('Former Person')).toBeInTheDocument();

      // The identity is known even when the removal cause was not recorded.
      const unavailable = screen.getByRole('cell', { name: /Archived export/ });
      expect(within(unavailable).getByText('Unavailable')).toBeInTheDocument();
      expect(within(unavailable).getByText('Dana')).toBeInTheDocument();
      expect(
        within(unavailable).queryByText('Revoked'),
      ).not.toBeInTheDocument();

      // A key the organization knows nothing about is said to be one.
      const unknown = screen.getByRole('cell', { name: /key-unknown/ });
      expect(within(unknown).getByText('Unknown key')).toBeInTheDocument();

      // No cell is a bare id any more.
      for (const id of [
        'key-expired',
        'key-revoked',
        'key-left',
        'key-unavailable',
      ]) {
        expect(screen.queryByText(id)).not.toBeInTheDocument();
      }
    });

    it.each([
      ['key-expired', 'Nightly export'],
      ['key-unavailable', 'Archived export'],
    ])(
      'offers only live keys, and keeps the edited rule’s %s',
      async (apiKeyId, name) => {
        setLoaded([
          {
            scope: 'apiKey',
            apiKeyId,
            period: 'monthly',
            maxRequests: 100,
          },
        ]);
        const { user } = render(<BudgetEditor organizationId="org-1" />);

        await user.click(screen.getByRole('button', { name: /edit rule/i }));
        const dialog = await screen.findByRole('dialog');
        // The field names the rule's key instead of an empty placeholder, and
        // says the rule limits nothing any more.
        const picker = within(dialog).getByRole('button', { name: /API key/ });
        expect(picker).toHaveTextContent(`${name} · Dana`);
        expect(
          within(dialog).getByText(/can no longer spend in this organization/),
        ).toBeInTheDocument();

        await user.click(picker);
        const options = (await screen.findAllByRole('option')).map(
          (option) => option.textContent,
        );
        expect(options.some((text) => text?.includes('CI Key · Dana'))).toBe(
          true,
        );
        expect(options.some((text) => text?.includes(name))).toBe(true);
        expect(options).toHaveLength(2);
        // Keys no rule in the dialog names and that cannot spend are not on
        // offer: a rule on one would limit nothing.
        expect(options.some((text) => text?.includes('opencode laptop'))).toBe(
          false,
        );
        expect(options.some((text) => text?.includes('Old script'))).toBe(
          false,
        );
      },
    );

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

  describe('project rules [GOV-R14]', () => {
    const PROJECT_RULE = {
      scope: 'project',
      scopeId: 'project-1',
      period: 'monthly',
      maxCostCents: 20_000,
    };
    const DEFAULT_RULE = {
      scope: 'default',
      period: 'monthly',
      maxCostCents: 5_000,
    };

    it('names the project a rule caps, marks an archived one, and says when it is gone', () => {
      setLoaded(
        [],
        [
          PROJECT_RULE,
          { ...PROJECT_RULE, scopeId: 'project-old' },
          { ...PROJECT_RULE, scopeId: 'project-gone' },
        ],
      );
      render(<BudgetEditor organizationId="org-1" />);
      expect(screen.getAllByRole('cell', { name: 'Project' })).toHaveLength(3);
      expect(
        screen.getByRole('cell', { name: 'Website relaunch' }),
      ).toBeInTheDocument();
      const archived = screen.getByRole('cell', { name: /Old campaign/ });
      expect(within(archived).getByText('Archived')).toBeInTheDocument();
      // Never a bare id: a project that is gone says so.
      expect(
        screen.getByRole('cell', { name: 'Deleted project' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('project-gone')).not.toBeInTheDocument();
    });

    it('says a rule’s project is gone in its dialog', async () => {
      setLoaded([], [{ ...PROJECT_RULE, scopeId: 'project-gone' }]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(
        dialog.getByText(/This project no longer exists/),
      ).toBeInTheDocument();
    });

    it('starts a switched scope without the previous scope’s target', async () => {
      upsert.mockClear();
      setLoaded([
        { scope: 'role', scopeId: 'admin', period: 'monthly', maxCostCents: 5 },
      ]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      const dialog = within(await screen.findByRole('dialog'));
      await user.click(dialog.getByRole('combobox', { name: 'Scope' }));
      await user.click(screen.getByRole('option', { name: 'Project' }));
      await user.click(dialog.getByRole('button', { name: /confirm/i }));

      // A role's id is no project: the rule needs a target before it saves.
      expect(
        await screen.findByText(/select a target for this scope/i),
      ).toBeInTheDocument();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('keeps the table in the order a save reads back', async () => {
      upsert.mockClear();
      setLoaded([DEFAULT_RULE], [PROJECT_RULE]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      const dialog = within(await screen.findByRole('dialog'));
      await user.click(dialog.getByRole('combobox', { name: 'Scope' }));
      await user.click(screen.getByRole('option', { name: 'Organization' }));
      await user.type(dialog.getByLabelText(/max cost/i), '9');
      await user.click(dialog.getByRole('button', { name: /confirm/i }));

      // The new organization rule sits with the other `rules`, ahead of the
      // project's cap — where the saved file puts it.
      const scopes = screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
      expect(scopes).toEqual(['Default', 'Organization', 'Project']);
    });

    it('saves a project’s cap in its own file, and leaves the budgets file as it is', async () => {
      upsert.mockClear();
      setLoaded([DEFAULT_RULE], [PROJECT_RULE]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: 'Edit rule 2' }));
      const dialog = within(await screen.findByRole('dialog'));
      await user.type(dialog.getByLabelText(/warning threshold/i), '80');
      await user.click(dialog.getByRole('button', { name: /confirm/i }));

      // An image that predates project caps still reads the budgets file,
      // and saves it whole: the project's cap is never in it.
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'project_budgets',
        config: { rules: [{ ...PROJECT_RULE, warningThresholdPercent: 80 }] },
      });
    });

    it('moves the project caps an earlier release saved into their own file before the budgets file drops them', async () => {
      upsert.mockClear();
      setLegacy([DEFAULT_RULE], [PROJECT_RULE]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);
      expect(
        screen.getByRole('cell', { name: 'Website relaunch' }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Edit rule 1' }));
      const dialog = within(await screen.findByRole('dialog'));
      await user.clear(dialog.getByLabelText(/max cost/i));
      await user.type(dialog.getByLabelText(/max cost/i), '60');
      await user.click(dialog.getByRole('button', { name: /confirm/i }));

      expect(upsert.mock.calls).toEqual([
        [
          {
            organizationId: 'org-1',
            policyType: 'project_budgets',
            config: { rules: [PROJECT_RULE] },
          },
        ],
        [
          {
            organizationId: 'org-1',
            policyType: 'budgets',
            config: {
              enabled: true,
              rules: [{ ...DEFAULT_RULE, maxCostCents: 6_000 }],
            },
          },
        ],
      ]);
    });

    it('switches the rules off without touching the project caps an earlier release saved', async () => {
      upsert.mockClear();
      setLegacy([DEFAULT_RULE], [PROJECT_RULE]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('switch', { name: /budget rules/i }));

      expect(upsert).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'budgets',
        config: {
          enabled: false,
          rules: [DEFAULT_RULE],
          projectRules: [PROJECT_RULE],
        },
      });
    });

    it('offers the active projects, and keeps the edited rule’s archived one', async () => {
      setLoaded([], [{ ...PROJECT_RULE, scopeId: 'project-old' }]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      const dialog = await screen.findByRole('dialog');
      const picker = within(dialog).getByRole('button', { name: /Project/ });
      expect(picker).toHaveTextContent('Old campaign');

      await user.click(picker);
      const options = (await screen.findAllByRole('option')).map(
        (option) => option.textContent,
      );
      expect(options).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Website relaunch'),
          expect.stringContaining('Annual report'),
          expect.stringContaining('Old campaign'),
        ]),
      );
      expect(options).toHaveLength(3);
    });

    it('offers a warning threshold for a project’s cap, saying who sees the warning [GOV-R6]', async () => {
      setLoaded([
        {
          scope: 'default',
          period: 'monthly',
          maxCostCents: 100,
          warningThresholdPercent: 80,
        },
      ]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByLabelText(/warning threshold/i)).toHaveValue(80);
      await user.click(dialog.getByRole('combobox', { name: 'Scope' }));
      await user.click(screen.getByRole('option', { name: 'Project' }));
      // The threshold stays: a project's cap warns everyone chatting in it.
      expect(dialog.getByLabelText(/warning threshold/i)).toHaveValue(80);
      expect(
        dialog.getByText(/everyone chatting in this project sees a warning/i),
      ).toBeInTheDocument();
    });

    it('blocks saving a project rule that names no project', async () => {
      setLoaded([]);
      const { user } = render(<BudgetEditor organizationId="org-1" />);

      await user.click(screen.getByRole('button', { name: /add rule/i }));
      const dialog = within(await screen.findByRole('dialog'));
      await user.click(dialog.getByRole('combobox', { name: 'Scope' }));
      await user.click(screen.getByRole('option', { name: 'Project' }));
      await user.type(dialog.getByLabelText(/max cost/i), '50');
      await user.click(dialog.getByRole('button', { name: /confirm/i }));

      expect(
        await screen.findByText(/select a target for this scope/i),
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

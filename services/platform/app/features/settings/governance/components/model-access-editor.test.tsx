import { AppShell } from '@tale/ui/app-shell';
import { render as renderWithProviders } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { ModelAccessEditor } from './model-access-editor';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { upsert } = vi.hoisted(() => ({
  upsert: { mutateAsync: vi.fn(async (_args: unknown) => undefined) },
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: upsert.mutateAsync,
    isPending: false,
  }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
// A fresh object per render is fine: the editor seeds local state once via an
// init ref, so it never loops on a changing reference.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: {
      enabled: true,
      mode: 'blocklist' as const,
      rules: [] as unknown[],
    } as Record<string, unknown> | null,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

const STABLE_MEMBERS = { members: [] };
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [] };
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => STABLE_TEAMS,
}));

const STABLE_PROVIDERS = {
  providers: [
    {
      name: 'openai',
      displayName: 'OpenAI',
      models: [{ id: 'openai/gpt-4o', displayName: 'GPT-4o', tags: ['chat'] }],
    },
  ],
};
vi.mock('../hooks/model-catalog', () => ({
  useListProviders: () => STABLE_PROVIDERS,
  useModelCapabilities: () => new Map(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

function setLoaded() {
  state.isLoading = false;
  state.config = {
    enabled: true,
    mode: 'blocklist',
    rules: [
      { scope: 'default', allowedModels: [], blockedModels: ['openai/gpt-4o'] },
    ],
  };
}
function setLoading() {
  state.isLoading = true;
  state.config = null;
}

describe('ModelAccessEditor', () => {
  it.each(['en', 'de', 'fr'])(
    'localizes scope, role and mode labels (%s)',
    async (language) => {
      await i18n.changeLanguage(language);
      try {
        setLoaded();
        state.config = {
          enabled: true,
          mode: 'blocklist',
          rules: [
            {
              scope: 'role',
              scopeId: 'developer',
              allowedModels: [],
              blockedModels: ['openai/gpt-4o'],
            },
          ],
        };

        const t = i18n.getFixedT(language, 'governance');
        // Keep the selected test language: the shared render helper's client
        // locale bridge would replace it with the detected browser preference.
        const user = userEvent.setup();
        renderWithProviders(
          <AppShell i18n={i18n}>
            <ModelAccessEditor organizationId="org-1" />
          </AppShell>,
        );
        expect(
          screen.getByRole('cell', { name: t('modelAccess.scopeLabels.role') }),
        ).toBeInTheDocument();

        expect(
          screen.getByRole('cell', {
            name: t('modelAccess.roleLabels.developer'),
          }),
        ).toBeInTheDocument();

        const modeSelect = screen.getByRole('combobox');
        expect(modeSelect).toHaveTextContent(
          t('modelAccess.modeLabels.blocklist'),
        );
        await user.click(modeSelect);
        expect(
          screen.getByRole('option', {
            name: t('modelAccess.modeLabels.allowlist'),
          }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('option', {
            name: t('modelAccess.modeLabels.blocklist'),
          }),
        ).toBeInTheDocument();
        await user.keyboard('{Escape}');

        await user.click(
          screen.getByRole('button', {
            name: t('modelAccess.editRule', { index: 1 }),
          }),
        );
        const dialog = within(screen.getByRole('dialog'));
        const scopeSelect = dialog.getByRole('combobox', {
          name: t('modelAccess.scope'),
        });
        expect(scopeSelect).toHaveTextContent(
          t('modelAccess.scopeLabels.role'),
        );
        await user.click(scopeSelect);
        for (const value of ['default', 'user', 'team', 'role']) {
          expect(
            i18n.exists(`modelAccess.scopeLabels.${value}`, {
              lng: language,
              ns: 'governance',
            }),
          ).toBe(true);
          expect(
            screen.getByRole('option', {
              name: t(`modelAccess.scopeLabels.${value}`),
            }),
          ).toBeInTheDocument();
        }
        await user.keyboard('{Escape}');
        const roleSelect = dialog.getByRole('combobox', {
          name: t('modelAccess.role'),
        });
        expect(roleSelect).toHaveTextContent(
          t('modelAccess.roleLabels.developer'),
        );
        await user.click(roleSelect);
        for (const value of ['admin', 'developer', 'editor', 'member']) {
          expect(
            i18n.exists(`modelAccess.roleLabels.${value}`, {
              lng: language,
              ns: 'governance',
            }),
          ).toBe(true);
          expect(
            screen.getByRole('option', {
              name: t(`modelAccess.roleLabels.${value}`),
            }),
          ).toBeInTheDocument();
        }
        await user.keyboard('{Escape}');
      } finally {
        cleanup();
        await i18n.changeLanguage('en');
      }
    },
  );

  describe('loaded state', () => {
    it('renders the real enable switch (in the a11y tree)', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(
        screen.getByRole('switch', { name: 'Enable model access policy' }),
      ).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /model access/i }),
      ).toBeInTheDocument();
    });

    it('renders the saved rule rows (real data, no placeholders)', () => {
      setLoaded();
      const { container } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      const rows = container.querySelectorAll('tbody tr');
      expect(rows).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: /edit rule/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch/buttons while loading)', () => {
      setLoading();
      render(<ModelAccessEditor organizationId="org-1" />);
      // The masked Switch renders a SkeletonBox (no role=switch) and masked
      // Buttons are aria-hidden → all excluded from the a11y tree.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('renders placeholder rows so the table reads as loading, not empty', () => {
      setLoading();
      const { container } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      // The body is forced visible while loading even though `enabled` has not
      // been seeded yet; three placeholder rows render, NOT the empty-state.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(
        screen.queryByText(/no access rules configured/i),
      ).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /model access/i }),
      ).toBeInTheDocument();
    });
  });

  /**
   * The model endpoints for API keys are switched on the same policy file:
   * off until an admin turns them on, independent of the rules' own switch,
   * and never dropped by a save of the rules.
   */
  describe('model endpoints for API keys', () => {
    const endpointsSwitch = () =>
      screen.getByRole('switch', {
        name: 'Enable model endpoints for API keys',
      });

    it('reads off for a policy written before the switch existed', () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: 'Model endpoints for API keys' }),
      ).toBeInTheDocument();
      expect(endpointsSwitch()).toHaveAttribute('aria-checked', 'false');
    });

    it('turns them on, writing the rules back beside the switch', async () => {
      setLoaded();
      upsert.mutateAsync.mockClear();
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(endpointsSwitch());
      expect(upsert.mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'model_access',
        config: {
          enabled: true,
          mode: 'blocklist',
          rules: [
            {
              scope: 'default',
              allowedModels: [],
              blockedModels: ['openai/gpt-4o'],
            },
          ],
          modelApi: { enabled: true },
        },
      });
      expect(endpointsSwitch()).toHaveAttribute('aria-checked', 'true');
    });

    it('keeps the switch when the rules’ own switch is saved', async () => {
      setLoaded();
      state.config = { ...state.config, modelApi: { enabled: true } };
      upsert.mutateAsync.mockClear();
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      expect(endpointsSwitch()).toHaveAttribute('aria-checked', 'true');
      await user.click(
        screen.getByRole('switch', { name: 'Enable model access policy' }),
      );
      expect(upsert.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            enabled: false,
            modelApi: { enabled: true },
          }),
        }),
      );
    });

    it('puts the switch back when the save fails', async () => {
      setLoaded();
      upsert.mutateAsync.mockClear();
      upsert.mutateAsync.mockRejectedValueOnce(new Error('validation'));
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(endpointsSwitch());
      await vi.waitFor(() => {
        expect(endpointsSwitch()).toHaveAttribute('aria-checked', 'false');
      });
    });
  });
});

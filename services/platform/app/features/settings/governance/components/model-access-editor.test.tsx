import { AppShell } from '@tale/ui/app-shell';
import { render as renderWithProviders } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inPolicyWriteOrder } from '@/app/lib/backend/policy-write-order';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { act, cleanup, render, screen, within } from '@/tests/utils/render';

import { ModelAccessEditor } from './model-access-editor';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast }),
}));

const { upsert, toast } = vi.hoisted(() => ({
  upsert: {
    mutateAsync: vi.fn(async (_args: unknown) => undefined),
    isPending: false,
  },
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: upsert.mutateAsync,
    isPending: upsert.isPending,
  }),
}));

const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: {
      enabled: true,
      mode: 'blocklist' as const,
      rules: [] as unknown[],
    } as Record<string, unknown> | null,
    defaultConfig: null as Record<string, unknown> | null,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: (_organizationId: string, policyType: string) => ({
    data: state.isLoading
      ? undefined
      : {
          config:
            policyType === 'default_models'
              ? state.defaultConfig
              : state.config,
        },
    isLoading: state.isLoading,
  }),
}));

const STABLE_MEMBERS = {
  members: [{ userId: 'member-proof', displayName: 'Proof member' }],
};
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => STABLE_MEMBERS,
}));

const STABLE_TEAMS = { teams: [{ id: 'team-proof', name: 'Proof team' }] };
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

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('ModelAccessEditor', () => {
  beforeEach(() => {
    upsert.mutateAsync.mockReset();
    upsert.mutateAsync.mockResolvedValue(undefined);
    upsert.isPending = false;
    toast.mockClear();
    state.defaultConfig = null;
  });

  describe('immediate saves and server readback', () => {
    const accessSwitch = () =>
      screen.getByRole('switch', { name: 'Enable model access policy' });

    it('invalidates delete confirmation when readback replaces indexed rules', async () => {
      setLoaded();
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(screen.getByRole('button', { name: /delete rule/i }));
      state.config = {
        ...state.config,
        rules: [
          {
            scope: 'role',
            scopeId: 'member',
            allowedModels: [],
            blockedModels: [],
          },
          ...(state.config!.rules as unknown[]),
        ],
      };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(upsert.mutateAsync).not.toHaveBeenCalled();
      await user.click(
        screen.getAllByRole('button', { name: /delete rule/i })[1],
      );
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(upsert.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            rules: [
              {
                scope: 'role',
                scopeId: 'member',
                allowedModels: [],
                blockedModels: [],
              },
            ],
          }),
        }),
      );
    });

    it('invalidates an edit draft when readback replaces indexed rules', async () => {
      setLoaded();
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(screen.getByRole('button', { name: /edit rule/i }));
      state.config = {
        ...state.config,
        rules: [
          {
            scope: 'role',
            scopeId: 'member',
            allowedModels: [],
            blockedModels: [],
          },
          ...(state.config!.rules as unknown[]),
        ],
      };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(upsert.mutateAsync).not.toHaveBeenCalled();
      expect(
        screen.getAllByRole('button', { name: /edit rule/i }),
      ).toHaveLength(2);
      await user.click(
        screen.getAllByRole('button', { name: /edit rule/i })[1],
      );
      expect(
        within(screen.getByRole('dialog')).getByRole('combobox', {
          name: 'Scope',
        }),
      ).toHaveTextContent('Default');
    });

    it('preserves an earlier acknowledged save when a later save fails before cache refresh', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      upsert.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
      const endpointsSwitch = () =>
        screen.getByRole('switch', {
          name: 'Enable model endpoints for API keys',
        });
      await user.click(endpointsSwitch());
      await vi.waitFor(() =>
        expect(endpointsSwitch()).toHaveAttribute('aria-checked', 'false'),
      );
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
      await user.click(endpointsSwitch());
      expect(upsert.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            enabled: true,
            modelApi: { enabled: true },
          }),
        }),
      );
    });

    it('applies a newer complete readback after rejection held behind the pending flag', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      const request = Promise.withResolvers<undefined>();
      upsert.mutateAsync.mockReturnValueOnce(request.promise);
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      upsert.isPending = true;
      state.config = {
        enabled: true,
        mode: 'allowlist',
        rules: [],
        modelApi: { enabled: true },
      };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      request.reject(new Error('save failed'));
      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'destructive' }),
        ),
      );
      upsert.isPending = false;
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('combobox')).toHaveTextContent('Allowlist');
      expect(screen.queryByRole('button', { name: /edit rule/i })).toBeNull();
      expect(
        screen.getByRole('switch', {
          name: 'Enable model endpoints for API keys',
        }),
      ).toHaveAttribute('aria-checked', 'true');
    });

    it('blocks whole-policy writes while the shared policy read is settling', async () => {
      setLoaded();
      render(<ModelAccessEditor organizationId="org-1" />);
      const request = Promise.withResolvers<undefined>();
      let write!: Promise<undefined>;
      act(() => {
        write = inPolicyWriteOrder(
          'org-1',
          'model_access',
          () => request.promise,
        );
      });
      try {
        expect(accessSwitch()).toBeDisabled();
        expect(
          screen.getByRole('switch', {
            name: 'Enable model endpoints for API keys',
          }),
        ).toBeDisabled();
        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(
          screen.getByRole('button', { name: /delete rule/i }),
        ).toBeDisabled();
        expect(
          screen.getByRole('button', { name: /edit rule/i }),
        ).toBeDisabled();
        expect(upsert.mutateAsync).not.toHaveBeenCalled();
      } finally {
        await act(async () => {
          request.resolve(undefined);
          await write;
        });
      }
      expect(accessSwitch()).not.toBeDisabled();
    });

    it('rolls back failed enablement, keeps one failure toast, and allows retry', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      upsert.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
      const { user, rerender, unmount } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      await vi.waitFor(() => {
        expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      });
      expect(screen.queryByRole('button', { name: /edit rule/i })).toBeNull();
      expect(toast).toHaveBeenCalledTimes(1);
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
      state.config = structuredClone(state.config);
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      unmount();
      const remounted = render(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      await remounted.user.click(accessSwitch());
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(upsert.mutateAsync).toHaveBeenCalledTimes(2);
    });

    it('applies fresh enabled, mode, rules and endpoint state without remounting', () => {
      setLoaded();
      const { rerender, container } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
      state.config = {
        enabled: false,
        mode: 'allowlist',
        rules: [],
        modelApi: { enabled: true },
      };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(
        screen.getByRole('switch', {
          name: 'Enable model endpoints for API keys',
        }),
      ).toHaveAttribute('aria-checked', 'true');
      state.config = { ...state.config, enabled: true };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.queryByRole('button', { name: /edit rule/i })).toBeNull();
      expect(screen.getByRole('combobox')).toHaveTextContent(/allowlist/i);
      expect(upsert.mutateAsync).not.toHaveBeenCalled();
    });

    it('does not replace a successful optimistic save with the unchanged cached policy', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(
        screen.getByRole('button', { name: /edit rule/i }),
      ).toBeInTheDocument();
    });

    it('rolls back a failed enablement after confirming affected defaults', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      state.defaultConfig = {
        enabled: true,
        rules: [
          {
            scope: 'default',
            providerName: 'openai',
            modelId: 'openai/gpt-4o',
          },
        ],
      };
      upsert.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(accessSwitch());
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(upsert.mutateAsync).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Save anyway' }));
      await vi.waitFor(() => {
        expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      });
      expect(toast).toHaveBeenCalledTimes(1);
    });

    it('restores the previous mode when its immediate save fails', async () => {
      setLoaded();
      upsert.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(screen.getByRole('combobox'));
      await user.click(screen.getByRole('option', { name: 'Allowlist' }));
      await vi.waitFor(() => {
        expect(screen.getByRole('combobox')).toHaveTextContent('Blocklist');
      });
      expect(toast).toHaveBeenCalledTimes(1);
    });

    it('restores a rule when deletion fails', async () => {
      setLoaded();
      upsert.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: /delete rule/i }));
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await vi.waitFor(() => {
        expect(
          screen.getByRole('button', { name: /edit rule/i }),
        ).toBeInTheDocument();
      });
      expect(toast).toHaveBeenCalledTimes(1);
    });

    it('defers readback while a save is in flight, then applies the latest server state', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      const request = Promise.withResolvers<undefined>();
      upsert.mutateAsync.mockReturnValueOnce(request.promise);
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      upsert.isPending = true;
      state.config = { ...state.config, modelApi: { enabled: true } };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(accessSwitch()).toBeDisabled();
      request.resolve(undefined);
      await vi.waitFor(() => {
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'success' }),
        );
      });
      upsert.isPending = false;
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(
        screen.getByRole('switch', {
          name: 'Enable model endpoints for API keys',
        }),
      ).toHaveAttribute('aria-checked', 'true');
    });

    it('does not roll back over a newer authoritative readback when rejection settles', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      const request = Promise.withResolvers<undefined>();
      upsert.mutateAsync.mockReturnValueOnce(request.promise);
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      state.config = { ...state.config, enabled: true, rules: [] };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      request.reject(new Error('save failed'));
      await vi.waitFor(() => {
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'destructive' }),
        );
      });
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByRole('button', { name: /edit rule/i })).toBeNull();
    });

    it('keeps a confirmation draft until cancellation, then applies fresh readback', async () => {
      setLoaded();
      state.config = { ...state.config, enabled: false };
      state.defaultConfig = {
        enabled: true,
        rules: [
          {
            scope: 'default',
            providerName: 'openai',
            modelId: 'openai/gpt-4o',
          },
        ],
      };
      const { user, rerender } = render(
        <ModelAccessEditor organizationId="org-1" />,
      );
      await user.click(accessSwitch());
      state.config = { ...state.config, modelApi: { enabled: true } };
      rerender(<ModelAccessEditor organizationId="org-1" />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(accessSwitch()).toHaveAttribute('aria-checked', 'false');
      expect(
        screen.getByRole('switch', {
          name: 'Enable model endpoints for API keys',
        }),
      ).toHaveAttribute('aria-checked', 'true');
      expect(upsert.mutateAsync).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });
  });
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

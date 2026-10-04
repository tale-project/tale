import { modelAccessConfigSchema } from '@tale/shared/schemas/governance';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { settingsWriteAdapters } from '@/app/lib/backend/settings';
import { evaluateModelAccess } from '@/backend/core/governance/model_access_enforcement';
import { isRecord } from '@/lib/utils/type-utils';
import { render, screen, within } from '@/tests/utils/render';

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
  it('stages repairs of several legacy rules and writes only the complete valid policy', async () => {
    setLoaded();
    state.config = {
      enabled: false,
      mode: 'blocklist',
      rules: [
        { scope: 'user', allowedModels: [], blockedModels: ['openai/gpt-4o'] },
        { scope: 'team', allowedModels: [], blockedModels: ['openai/gpt-4o'] },
      ],
    };
    upsert.mutateAsync.mockClear();
    const { user } = render(<ModelAccessEditor organizationId="org-1" />);
    expect(screen.getAllByText('Missing target')).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Edit rule' })[0]);
    await user.click(screen.getByRole('button', { name: 'User' }));
    await user.click(screen.getByRole('option', { name: 'Proof member' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(upsert.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getAllByText('Missing target')).toHaveLength(1);
    await user.click(screen.getAllByRole('button', { name: 'Edit rule' })[1]);
    await user.click(screen.getByRole('button', { name: 'Team' }));
    await user.click(screen.getByRole('option', { name: 'Proof team' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(upsert.mutateAsync).toHaveBeenCalledOnce();
    expect(upsert.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          enabled: false,
          mode: 'blocklist',
          modelApi: { enabled: false },
          rules: [
            {
              scope: 'user',
              scopeId: 'member-proof',
              allowedModels: [],
              blockedModels: ['openai/gpt-4o'],
            },
            {
              scope: 'team',
              scopeId: 'team-proof',
              allowedModels: [],
              blockedModels: ['openai/gpt-4o'],
            },
          ],
        },
      }),
    );
  });

  it('shows existing untargeted rules without dropping their neighboring restrictions', async () => {
    setLoaded();
    state.config = {
      enabled: true,
      mode: 'blocklist',
      rules: [
        {
          scope: 'default',
          allowedModels: [],
          blockedModels: ['openai/gpt-4o'],
        },
        { scope: 'user', allowedModels: [], blockedModels: ['openai/gpt-4o'] },
      ],
    };
    upsert.mutateAsync.mockClear();
    const { user, container } = render(
      <ModelAccessEditor organizationId="org-1" />,
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByText('Missing target')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some rules have no target',
    );
    await user.click(
      screen.getByRole('switch', { name: 'Enable model access policy' }),
    );
    expect(upsert.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(['User', 'Team', 'Role'])(
    'repairs an existing %s target and saves an enforceable block',
    async (scope) => {
      setLoaded();
      state.config = {
        enabled: true,
        mode: 'blocklist',
        rules: [
          {
            scope: scope.toLowerCase(),
            allowedModels: [],
            blockedModels: ['openai/gpt-4o'],
          },
        ],
      };
      upsert.mutateAsync.mockClear();
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Edit rule' }));
      window.__ENV__ = { BASE_PATH: '' };
      let stored: unknown;
      const transport = vi
        .spyOn(window, 'fetch')
        .mockImplementation(async (_url, init) => {
          if (typeof init?.body !== 'string')
            throw new Error('Expected JSON body');
          const body: unknown = JSON.parse(init.body);
          if (!isRecord(body)) throw new Error('Expected a policy request');
          stored = modelAccessConfigSchema.parse(body.config);
          return Response.json({ ok: true });
        });
      upsert.mutateAsync.mockImplementationOnce(async (args) => {
        if (!isRecord(args)) throw new Error('Expected policy arguments');
        const adapter =
          settingsWriteAdapters['governance/file_actions:saveGovernancePolicy'];
        if (!adapter) throw new Error('Missing policy save adapter');
        await adapter.run(args, {});
      });
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'Select a target for this rule.',
      );
      expect(transport).not.toHaveBeenCalled();
      const target = within(dialog).getByRole(
        scope === 'Role' ? 'combobox' : 'button',
        { name: scope },
      );
      const descriptionId = target.getAttribute('aria-describedby');
      expect(descriptionId).toBeTruthy();
      expect(document.getElementById(descriptionId ?? '')).toHaveTextContent(
        'Select a target for this rule.',
      );
      if (scope === 'Role') {
        await user.click(screen.getByRole('combobox', { name: 'Role' }));
        await user.click(screen.getByRole('option', { name: 'Member' }));
      } else {
        await user.click(screen.getByRole('button', { name: scope }));
        await user.click(
          screen.getByRole('option', {
            name: scope === 'User' ? 'Proof member' : 'Proof team',
          }),
        );
      }
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(upsert.mutateAsync).toHaveBeenCalledOnce();
      expect(transport).toHaveBeenCalledOnce();
      const call = upsert.mutateAsync.mock.calls[0]?.[0];
      expect(call).toMatchObject({ policyType: 'model_access' });
      const config = modelAccessConfigSchema.parse(stored);
      expect(
        evaluateModelAccess(
          config,
          {
            userId: 'member-proof',
            teamIds: ['team-proof'],
            userRole: 'member',
          },
          'openai/gpt-4o',
        ).allowed,
      ).toBe(false);
      expect(screen.queryByText('Missing target')).not.toBeInTheDocument();
    },
  );

  it('clears the old target when switching between targeted scopes', async () => {
    setLoaded();
    state.config = {
      enabled: true,
      mode: 'blocklist',
      rules: [
        {
          scope: 'role',
          scopeId: 'member',
          allowedModels: [],
          blockedModels: ['openai/gpt-4o'],
        },
      ],
    };
    upsert.mutateAsync.mockClear();
    const { user } = render(<ModelAccessEditor organizationId="org-1" />);
    await user.click(screen.getByRole('button', { name: 'Edit rule' }));
    await user.click(screen.getByRole('combobox', { name: 'Scope' }));
    await user.click(screen.getByRole('option', { name: 'User' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(upsert.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(['User', 'Team', 'Role'])(
    'keeps an untargeted %s rule in the dialog without saving',
    async (scope) => {
      setLoaded();
      upsert.mutateAsync.mockClear();
      const { user } = render(<ModelAccessEditor organizationId="org-1" />);
      await user.click(screen.getByRole('button', { name: 'Add rule' }));
      await user.click(screen.getByRole('combobox', { name: 'Scope' }));
      await user.click(screen.getByRole('option', { name: scope }));
      await user.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Select a target for this rule.',
      );
      expect(upsert.mutateAsync).not.toHaveBeenCalled();
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

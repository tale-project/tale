import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AutomationInstallWizard } from './automation-install-wizard';

const {
  installSpy,
  previewSpy,
  previewHolder,
  useRequiredIntegrationsMock,
  agentReadiness,
} = vi.hoisted(() => ({
  installSpy: vi.fn(),
  previewSpy: vi.fn(),
  // Mutable holder for the install preflight the wizard snapshots on open.
  previewHolder: {
    value: { entries: [] as unknown[], overrides: [] as string[] },
  },
  useRequiredIntegrationsMock: vi.fn(),
  // Mutable holder for the imperative getAutomationAgentReadiness result.
  agentReadiness: { value: { agents: [] as unknown[] } },
}));

vi.mock('../../hooks/use-install-state', () => ({
  useAutomationInstallActions: () => ({
    install: installSpy,
    preview: previewSpy,
    uninstall: vi.fn(),
    verify: vi.fn(),
    isPending: false,
  }),
  isInstallOverridesError: () => false,
}));

vi.mock('../../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: useRequiredIntegrationsMock,
}));

// The wizard fetches agent readiness imperatively + persists auth-mode through
// useConvexAction; the agent-secrets step reads agent env through useConvexQuery.
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({
    mutateAsync: vi.fn(async () => agentReadiness.value),
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [] }),
}));

vi.mock('@/app/features/projects/components/project-create-dialog', () => ({
  ProjectCreateDialog: () => null,
}));

vi.mock(
  '@/app/features/settings/integrations/components/integration-manage/connect-integration-panel',
  () => ({
    ConnectIntegrationPanel: ({
      integration,
      onConnected,
    }: {
      integration: { title: string };
      onConnected: () => void;
    }) => (
      <button type="button" onClick={onConnected}>
        {`connect ${integration.title}`}
      </button>
    ),
  }),
);

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

function withOneBlockedIntegration() {
  useRequiredIntegrationsMock.mockReturnValue({
    required: [
      {
        slug: 'github',
        integration: { title: 'GitHub', _id: 'github', name: 'github' },
        connected: false,
        exists: true,
      },
    ],
    blockedSlugs: ['github'],
    isLoading: false,
  });
}

function withNoIntegrations() {
  useRequiredIntegrationsMock.mockReturnValue({
    required: [],
    blockedSlugs: [],
    isLoading: false,
  });
}

function renderWizard(requiredIntegrations: string[] = ['github']) {
  return render(
    <AutomationInstallWizard
      open
      onOpenChange={() => {}}
      organizationId="org_1"
      automationSlug="issue-desk"
      automationName="Issue Desk"
      scope="org"
      requiredIntegrations={requiredIntegrations}
    />,
  );
}

describe('AutomationInstallWizard', () => {
  beforeEach(() => {
    installSpy.mockReset();
    installSpy.mockResolvedValue(undefined);
    previewSpy.mockReset();
    previewHolder.value = { entries: [], overrides: [] };
    previewSpy.mockImplementation(async () => previewHolder.value);
    useRequiredIntegrationsMock.mockReset();
    agentReadiness.value = { agents: [] };
  });

  it('installs once, then connects the required integration before finishing', async () => {
    withOneBlockedIntegration();
    const { user } = renderWizard();

    expect(
      await screen.findByText('Ready to install Issue Desk.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const connectBtn = await screen.findByRole('button', {
      name: 'connect GitHub',
    });
    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith('issue-desk', undefined, undefined);

    expect(screen.getAllByText('GitHub · step 2 of 3').length).toBeGreaterThan(
      0,
    );

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(connectBtn);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Issue Desk is ready')).toBeInTheDocument();
  });

  it('lets the user skip the connect step and still reach done', async () => {
    withOneBlockedIntegration();
    const { user } = renderWizard();

    await screen.findByText('Ready to install Issue Desk.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'connect GitHub' });

    await user.click(
      screen.getByRole('button', { name: "I'll do this later" }),
    );
    expect(screen.getByText('Issue Desk is ready')).toBeInTheDocument();
    expect(screen.getByText(/skipped some steps/i)).toBeInTheDocument();
  });

  it('after install, walks a BYO agent through mode choice then secrets', async () => {
    withNoIntegrations();
    agentReadiness.value = {
      agents: [
        {
          agentSlug: 'issue-desk/desk-implementer',
          shortName: 'desk-implementer',
          displayName: 'Desk Implementer',
          mode: 'external-byo',
          agentKind: 'claude-code',
          ready: false,
          supportedModelsResolvable: false,
          requiredProviders: [],
          requiredEnv: [
            { key: 'ANTHROPIC_AUTH_TOKEN', secret: true, set: false },
          ],
        },
      ],
    };
    const { user } = renderWizard([]);

    // Install → auth-mode step (4 steps: install, auth-mode, agent-secrets, done).
    await screen.findByText('Ready to install Issue Desk.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      (await screen.findAllByText('Agent mode · step 2 of 4')).length,
    ).toBeGreaterThan(0);

    // Advance into the agent's secrets step — it asks for the declared key.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('ANTHROPIC_AUTH_TOKEN')).toBeInTheDocument();
  });

  it('has no accessibility violations on the install step', async () => {
    withOneBlockedIntegration();
    const { container } = renderWizard();
    await screen.findByText('Ready to install Issue Desk.');
    await checkAccessibility(container);
  });

  describe('override review step', () => {
    const OVERRIDE_PREVIEW = {
      entries: [
        {
          domain: 'integrations',
          path: 'github/definition.json',
          kind: 'integration',
          slug: 'github',
          status: 'override',
        },
        {
          domain: 'automation',
          path: 'agents/desk-implementer.json',
          kind: 'agent',
          slug: 'issue-desk/desk-implementer',
          status: 'override',
        },
        {
          domain: 'automation',
          path: 'automation.json',
          kind: 'manifest',
          status: 'identical',
        },
      ],
      overrides: [
        'integrations:github/definition.json',
        'automation:agents/desk-implementer.json',
      ],
    };

    it('shows no review step when the preflight finds no overrides', async () => {
      withNoIntegrations();
      renderWizard([]);
      await screen.findByText('Ready to install Issue Desk.');
      expect(screen.queryByText('Review changes')).not.toBeInTheDocument();
      expect(screen.getByText(/step 1 of 2/)).toBeInTheDocument();
    });

    it('inserts a checkbox-gated review step before install and passes the confirmed overrides', async () => {
      withNoIntegrations();
      previewHolder.value = OVERRIDE_PREVIEW;
      const { user } = renderWizard([]);

      // Review step first — only the override entries are listed, grouped by
      // kind (agents show their slug, others their path).
      expect(
        await screen.findByText('Installing overwrites existing files'),
      ).toBeInTheDocument();
      expect(screen.getByText(/step 1 of 3/)).toBeInTheDocument();
      expect(
        screen.getByText('issue-desk/desk-implementer'),
      ).toBeInTheDocument();
      expect(screen.getByText('github/definition.json')).toBeInTheDocument();
      expect(screen.queryByText('automation.json')).not.toBeInTheDocument();

      // Next is gated on the labelled confirmation checkbox.
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
      await user.click(
        screen.getByRole('checkbox', {
          name: "Replace these files with the automation's versions",
        }),
      );
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

      // Advance to the install step and install: the confirmed override keys
      // ride along.
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(
        screen.getByText('Ready to install Issue Desk.'),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      expect(installSpy).toHaveBeenCalledWith(
        'issue-desk',
        undefined,
        OVERRIDE_PREVIEW.overrides,
      );
    });

    it('has no accessibility violations on the review step', async () => {
      withNoIntegrations();
      previewHolder.value = OVERRIDE_PREVIEW;
      const { container } = renderWizard([]);
      await screen.findByText('Installing overwrites existing files');
      await checkAccessibility(container);
    });
  });
});

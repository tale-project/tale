import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AppInstallWizard } from './app-install-wizard';

const { installSpy, useRequiredIntegrationsMock, agentReadiness } = vi.hoisted(
  () => ({
    installSpy: vi.fn(),
    useRequiredIntegrationsMock: vi.fn(),
    // Mutable holder for the imperative getAppAgentReadiness result.
    agentReadiness: { value: { agents: [] as unknown[] } },
  }),
);

vi.mock('../../hooks/use-install-state', () => ({
  useAppInstallActions: () => ({
    install: installSpy,
    uninstall: vi.fn(),
    verify: vi.fn(),
    isPending: false,
  }),
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
    <AppInstallWizard
      open
      onOpenChange={() => {}}
      organizationId="org_1"
      appSlug="issue-desk"
      appName="Issue Desk"
      scope="org"
      requiredIntegrations={requiredIntegrations}
    />,
  );
}

describe('AppInstallWizard', () => {
  beforeEach(() => {
    installSpy.mockReset();
    installSpy.mockResolvedValue(undefined);
    useRequiredIntegrationsMock.mockReset();
    agentReadiness.value = { agents: [] };
  });

  it('installs once, then connects the required integration before finishing', async () => {
    withOneBlockedIntegration();
    const { user } = renderWizard();

    expect(
      screen.getByText('Ready to install Issue Desk.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const connectBtn = await screen.findByRole('button', {
      name: 'connect GitHub',
    });
    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith('issue-desk', undefined);

    expect(screen.getByText('GitHub · step 2 of 3')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(connectBtn);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Issue Desk is ready')).toBeInTheDocument();
  });

  it('lets the user skip the connect step and still reach done', async () => {
    withOneBlockedIntegration();
    const { user } = renderWizard();

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
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByText('Agent mode · step 2 of 4'),
    ).toBeInTheDocument();

    // Advance into the agent's secrets step — it asks for the declared key.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('ANTHROPIC_AUTH_TOKEN')).toBeInTheDocument();
  });

  it('has no accessibility violations on the install step', async () => {
    withOneBlockedIntegration();
    const { container } = renderWizard();
    await checkAccessibility(container);
  });
});

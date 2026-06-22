import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AppInstallWizard } from './app-install-wizard';

const { installSpy, useRequiredIntegrationsMock } = vi.hoisted(() => ({
  installSpy: vi.fn(),
  useRequiredIntegrationsMock: vi.fn(),
}));

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

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [] }),
}));

vi.mock('@/app/features/projects/components/project-create-dialog', () => ({
  ProjectCreateDialog: () => null,
}));

// Stub the connect panel so we don't drag in the full credential form / Convex
// surface — the wizard only needs the panel to signal `onConnected`.
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

function renderWizard() {
  return render(
    <AppInstallWizard
      open
      onOpenChange={() => {}}
      organizationId="org_1"
      appSlug="issue-desk"
      appName="Issue Desk"
      scope="org"
      requiredIntegrations={['github']}
    />,
  );
}

describe('AppInstallWizard', () => {
  beforeEach(() => {
    installSpy.mockReset();
    installSpy.mockResolvedValue(undefined);
    useRequiredIntegrationsMock.mockReset();
  });

  it('installs once, then connects the required integration before finishing', async () => {
    withOneBlockedIntegration();
    const { user } = renderWizard();

    // Install step first.
    expect(
      screen.getByText('Ready to install Issue Desk.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Advances to the connect step; install ran exactly once (org-scoped → no project).
    const connectBtn = await screen.findByRole('button', {
      name: 'connect GitHub',
    });
    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith('issue-desk', undefined);

    // Progress announces the integration step.
    expect(screen.getByText('GitHub · step 2 of 3')).toBeInTheDocument();

    // Next is gated until the integration connects.
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

  it('has no accessibility violations on the install step', async () => {
    withOneBlockedIntegration();
    const { container } = renderWizard();
    await checkAccessibility(container);
  });
});

import { getFunctionName } from 'convex/server';
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
  scheduleReadiness,
  navigateSpy,
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
  // Mutable holder for the imperative getAutomationScheduleReadiness result.
  scheduleReadiness: {
    value: { required: [] as string[], schedules: [] as unknown[] },
  },
  navigateSpy: vi.fn(),
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

// The wizard fetches agent AND schedule readiness imperatively (two distinct
// actions through the same hook) + persists auth-mode through useConvexAction;
// the agent-secrets step reads agent env through useConvexQuery. Convex's
// generated `api` is a proxy that returns a fresh reference on every access,
// so dispatch by `getFunctionName()`, not `===` (see
// `document_action_link_file.test.ts` for the same pattern).
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: (func: Parameters<typeof getFunctionName>[0]) => ({
    mutateAsync: vi.fn(async () =>
      getFunctionName(func).includes('getAutomationScheduleReadiness')
        ? scheduleReadiness.value
        : agentReadiness.value,
    ),
    isPending: false,
  }),
}));
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: [], isLoading: false }),
}));
// AgentSecretsStep lists token sources via useActionQuery (useAction under the
// hood). Without this mock the tree throws "Could not find Convex client".
vi.mock('@/app/hooks/use-action-query', () => ({
  useActionQuery: () => ({ data: [] }),
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
  useNavigate: () => navigateSpy,
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

function renderWizard(
  requiredIntegrations: string[] = ['github'],
  options: {
    scope?: 'org' | 'project';
    projectId?: string;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  return render(
    <AutomationInstallWizard
      open
      onOpenChange={options.onOpenChange ?? (() => {})}
      organizationId="org_1"
      automationSlug="issue-desk"
      automationName="Issue Desk"
      scope={options.scope ?? 'org'}
      projectId={options.projectId}
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
    scheduleReadiness.value = { required: [], schedules: [] };
    navigateSpy.mockReset();
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

  it('skipping a required integration makes Done flag the unfinished setup, not "ready"', async () => {
    withOneBlockedIntegration();
    const { user } = renderWizard();

    await screen.findByText('Ready to install Issue Desk.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'connect GitHub' });

    await user.click(
      screen.getByRole('button', { name: "I'll do this later" }),
    );
    // Skipping a REQUIRED integration must NOT claim the automation is ready —
    // Done surfaces the outstanding setup instead (the item-10 honesty fix).
    expect(
      screen.getByText('Finish setting up Issue Desk'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/required integration isn't connected/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Issue Desk is ready')).not.toBeInTheDocument();
  });

  it('keeps Done from claiming ready when a required schedule variable is still blank (#2605)', async () => {
    withNoIntegrations();
    scheduleReadiness.value = {
      required: ['owner', 'repo'],
      schedules: [
        {
          scheduleId: 'sched_1',
          cronExpression: '0 * * * *',
          missingFields: ['owner'],
        },
      ],
    };
    const { user } = renderWizard([]);

    await screen.findByText('Ready to install Issue Desk.');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // A blank required schedule variable blocks the "ready" claim just like an
    // unconnected required integration does, and names the gap + a Triggers
    // deep link — never a silent green Done screen.
    expect(
      await screen.findByText('Finish setting up Issue Desk'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Required schedule variables aren't set yet: owner. Set them on the automation's Triggers tab before it can run.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Triggers' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Issue Desk is ready')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Everything it needs is connected.'),
    ).not.toBeInTheDocument();
  });

  it('Finish closes the wizard without navigating away — installing must not redirect', async () => {
    withNoIntegrations();
    const onOpenChange = vi.fn();
    const { user } = renderWizard([], {
      scope: 'project',
      projectId: 'proj_1',
      onOpenChange,
    });

    await screen.findByText('Ready to install Issue Desk.');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Issue Desk is ready');

    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateSpy).not.toHaveBeenCalled();
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

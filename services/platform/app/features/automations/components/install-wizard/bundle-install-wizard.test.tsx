import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  BundleInstallWizard,
  type BundleInstallWizardProps,
} from './bundle-install-wizard';

const {
  installSpy,
  previewBundleSpy,
  previewHolder,
  useRequiredIntegrationsMock,
  agentReadinessByAutomation,
  scheduleReadinessByAutomation,
  navigateSpy,
} = vi.hoisted(() => ({
  installSpy: vi.fn(),
  previewBundleSpy: vi.fn(),
  // Mutable holder for the per-member preview the wizard snapshots on open.
  previewHolder: { value: [] as unknown[] },
  useRequiredIntegrationsMock: vi.fn(),
  // Mutable holder for the imperative getAutomationAgentReadiness result, keyed by
  // the member automationSlug the wizard calls it with.
  agentReadinessByAutomation: {
    value: {} as Record<string, { agents: unknown[] }>,
  },
  // Same, for the imperative getAutomationScheduleReadiness result.
  scheduleReadinessByAutomation: {
    value: {} as Record<string, { required: string[]; schedules: unknown[] }>,
  },
  navigateSpy: vi.fn(),
}));

vi.mock('../../hooks/use-install-state', () => ({
  useBundleInstallActions: () => ({
    previewBundle: previewBundleSpy,
    install: installSpy,
    isPending: false,
  }),
  isInstallOverridesError: () => false,
}));

vi.mock('../../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: useRequiredIntegrationsMock,
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: (func: Parameters<typeof getFunctionName>[0]) => ({
    mutateAsync: vi.fn(async (args: { automationSlug?: string }) => {
      // `setAgentAuthMode`, `getAutomationAgentReadiness`, and
      // `getAutomationScheduleReadiness` all share this mock — dispatch by
      // `getFunctionName()` (Convex's generated `api` is a proxy that returns a
      // fresh reference on every access, so `===` can't tell them apart), then
      // return the per-automationSlug fixture when asked, else a harmless
      // resolved value shaped for whichever action this is.
      const isScheduleReadiness = getFunctionName(func).includes(
        'getAutomationScheduleReadiness',
      );
      const table = isScheduleReadiness
        ? scheduleReadinessByAutomation.value
        : agentReadinessByAutomation.value;
      if (args?.automationSlug && table[args.automationSlug]) {
        return table[args.automationSlug];
      }
      return isScheduleReadiness
        ? { required: [], schedules: [] }
        : { agents: [] };
    }),
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

function withNoIntegrations() {
  useRequiredIntegrationsMock.mockReturnValue({
    required: [],
    blockedSlugs: [],
    isLoading: false,
  });
}

function memberPreview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    automationSlug: 'gmail/sync-emails',
    automationName: 'Sync Gmail emails',
    requiredIntegrations: [] as string[],
    entries: [] as unknown[],
    overrides: [] as string[],
    ...overrides,
  };
}

function renderWizard(
  overrides: Partial<
    Pick<BundleInstallWizardProps, 'scope' | 'projectId' | 'onOpenChange'>
  > = {},
) {
  return render(
    <BundleInstallWizard
      open
      onOpenChange={() => {}}
      organizationId="org_1"
      bundleSlug="email-bundle"
      bundleName="Email"
      scope="org"
      {...overrides}
    />,
  );
}

describe('BundleInstallWizard', () => {
  beforeEach(() => {
    installSpy.mockReset();
    installSpy.mockResolvedValue({ ok: true, members: [] });
    previewBundleSpy.mockReset();
    navigateSpy.mockReset();
    scheduleReadinessByAutomation.value = {};
    previewHolder.value = [
      memberPreview({
        automationSlug: 'gmail/sync-emails',
        automationName: 'Sync Gmail emails',
      }),
      memberPreview({
        automationSlug: 'outlook/sync-emails',
        automationName: 'Sync Outlook emails',
      }),
    ];
    previewBundleSpy.mockImplementation(async () => previewHolder.value);
    useRequiredIntegrationsMock.mockReset();
    withNoIntegrations();
    agentReadinessByAutomation.value = {};
  });

  it('shows the member count and installs the bundle once, with no per-member overrides', async () => {
    const { user } = renderWizard();

    expect(
      await screen.findByText('Ready to install Email (2 automations).'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith('email-bundle', undefined, {});
    expect(await screen.findByText('Email is ready')).toBeInTheDocument();
  });

  it("feeds useRequiredIntegrations the deduped union of every member's requires.integrations", async () => {
    previewHolder.value = [
      memberPreview({
        automationSlug: 'gmail/sync-emails',
        requiredIntegrations: ['gmail', 'shared-smtp'],
      }),
      memberPreview({
        automationSlug: 'outlook/sync-emails',
        requiredIntegrations: ['outlook', 'shared-smtp'],
      }),
    ];
    renderWizard();

    await screen.findByText('Ready to install Email (2 automations).');
    expect(useRequiredIntegrationsMock).toHaveBeenLastCalledWith('org_1', [
      'gmail',
      'shared-smtp',
      'outlook',
    ]);
  });

  it('groups the override review by member and gates Next on confirming EACH one separately', async () => {
    previewHolder.value = [
      memberPreview({
        automationSlug: 'gmail/sync-emails',
        automationName: 'Sync Gmail emails',
        entries: [
          {
            domain: 'integrations',
            path: 'gmail/definition.json',
            kind: 'integration',
            slug: 'gmail',
            status: 'override',
          },
        ],
        overrides: ['integrations:gmail/definition.json'],
      }),
      memberPreview({
        automationSlug: 'outlook/sync-emails',
        automationName: 'Sync Outlook emails',
        entries: [
          {
            domain: 'integrations',
            path: 'outlook/definition.json',
            kind: 'integration',
            slug: 'outlook',
            status: 'override',
          },
        ],
        overrides: ['integrations:outlook/definition.json'],
      }),
    ];
    const { user } = renderWizard();

    expect(
      await screen.findByText('Installing overwrites existing files'),
    ).toBeInTheDocument();
    expect(screen.getByText('Sync Gmail emails')).toBeInTheDocument();
    expect(screen.getByText('Sync Outlook emails')).toBeInTheDocument();
    expect(screen.getByText('gmail/definition.json')).toBeInTheDocument();
    expect(screen.getByText('outlook/definition.json')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox', {
      name: "Replace these files with the automation's versions",
    });
    expect(checkboxes).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    // Confirming only the first member's section keeps Next disabled.
    await user.click(checkboxes[0]);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    // Confirming both enables Next; installing sends namespaced overrides.
    await user.click(checkboxes[1]);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Ready to install Email (2 automations).');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(installSpy).toHaveBeenCalledWith('email-bundle', undefined, {
      'gmail/sync-emails': ['integrations:gmail/definition.json'],
      'outlook/sync-emails': ['integrations:outlook/definition.json'],
    });
  });

  it('shows a review section only for members that have overrides', async () => {
    previewHolder.value = [
      // gmail/sync-emails: a real override → gets a review section.
      memberPreview({
        automationSlug: 'gmail/sync-emails',
        automationName: 'Sync Gmail emails',
        entries: [
          {
            domain: 'integrations',
            path: 'gmail/definition.json',
            kind: 'integration',
            slug: 'gmail',
            status: 'override',
          },
        ],
        overrides: ['integrations:gmail/definition.json'],
      }),
      // outlook/sync-emails: nothing to overwrite → never appears in the review step.
      memberPreview({
        automationSlug: 'outlook/sync-emails',
        automationName: 'Sync Outlook emails',
        entries: [],
        overrides: [],
      }),
    ];
    renderWizard();

    await screen.findByText('Installing overwrites existing files');
    expect(screen.getByText('Sync Gmail emails')).toBeInTheDocument();
    expect(screen.getByText('gmail/definition.json')).toBeInTheDocument();
    // outlook/sync-emails never gets a section — it has no overrides.
    expect(screen.queryByText('Sync Outlook emails')).not.toBeInTheDocument();
    // A single member's checkbox.
    expect(
      screen.getAllByRole('checkbox', {
        name: "Replace these files with the automation's versions",
      }),
    ).toHaveLength(1);
  });

  it("concatenates each member's agent readiness after install (globally-unique <member>/<name> slugs)", async () => {
    agentReadinessByAutomation.value = {
      'gmail/sync-emails': {
        agents: [
          {
            agentSlug: 'gmail/sync-emails/replier',
            shortName: 'replier',
            displayName: 'Gmail Replier',
            mode: 'external-byo',
            agentKind: 'claude-code',
            ready: false,
            supportedModelsResolvable: false,
            requiredProviders: [],
            requiredEnv: [{ key: 'GMAIL_TOKEN', secret: true, set: false }],
          },
        ],
      },
      'outlook/sync-emails': {
        agents: [
          {
            agentSlug: 'outlook/sync-emails/replier',
            shortName: 'replier',
            displayName: 'Outlook Replier',
            mode: 'external-byo',
            agentKind: 'claude-code',
            ready: false,
            supportedModelsResolvable: false,
            requiredProviders: [],
            requiredEnv: [{ key: 'OUTLOOK_TOKEN', secret: true, set: false }],
          },
        ],
      },
    };
    const { user } = renderWizard();

    await screen.findByText('Ready to install Email (2 automations).');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Auth-mode step lists BOTH members' external agents (the Select's
    // trigger repeats the label as its value display, hence *AllBy*).
    expect(await screen.findAllByText('Gmail Replier')).not.toHaveLength(0);
    expect(screen.getAllByText('Outlook Replier').length).toBeGreaterThan(0);
  });

  it('has no accessibility violations on the install step', async () => {
    const { container } = renderWizard();
    await screen.findByText('Ready to install Email (2 automations).');
    await checkAccessibility(container);
  });

  it('names the members that still need schedule variables set, instead of claiming ready (#2611)', async () => {
    scheduleReadinessByAutomation.value = {
      'gmail/sync-emails': {
        required: ['owner', 'repo'],
        schedules: [
          {
            scheduleId: 'sched_1',
            cronExpression: '0 * * * *',
            missingFields: ['owner', 'repo'],
          },
        ],
      },
    };
    const { user } = renderWizard();

    await screen.findByText('Ready to install Email (2 automations).');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      await screen.findByText('Finish setting up Email'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'These members still need schedule variables set before they can run: Sync Gmail emails (owner, repo)',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open Triggers' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Email is ready')).not.toBeInTheDocument();
  });

  it('Finish closes the wizard without navigating away — installing must not redirect', async () => {
    const onOpenChange = vi.fn();
    const { user } = renderWizard({
      scope: 'project',
      projectId: 'proj_1',
      onOpenChange,
    });

    await screen.findByText('Ready to install Email (2 automations).');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Email is ready');

    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { BundleInstallWizard } from './bundle-install-wizard';

const {
  installSpy,
  previewBundleSpy,
  previewHolder,
  useRequiredIntegrationsMock,
  agentReadinessByAutomation,
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
  useConvexAction: (_fn: unknown) => ({
    mutateAsync: vi.fn(async (args: { automationSlug?: string }) => {
      // `setAgentAuthMode` and `getAutomationAgentReadiness` share this mock —
      // return the per-automationSlug agent readiness fixture when asked, else a
      // harmless resolved value.
      if (
        args?.automationSlug &&
        agentReadinessByAutomation.value[args.automationSlug]
      ) {
        return agentReadinessByAutomation.value[args.automationSlug];
      }
      return { agents: [] };
    }),
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

function withNoIntegrations() {
  useRequiredIntegrationsMock.mockReturnValue({
    required: [],
    blockedSlugs: [],
    isLoading: false,
  });
}

function memberPreview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    automationSlug: 'reply-gmail-emails',
    automationName: 'Reply to Gmail emails',
    requiredIntegrations: [] as string[],
    entries: [] as unknown[],
    overrides: [] as string[],
    ...overrides,
  };
}

function renderWizard() {
  return render(
    <BundleInstallWizard
      open
      onOpenChange={() => {}}
      organizationId="org_1"
      bundleSlug="email-bundle"
      bundleName="Email"
      scope="org"
    />,
  );
}

describe('BundleInstallWizard', () => {
  beforeEach(() => {
    installSpy.mockReset();
    installSpy.mockResolvedValue({ ok: true, members: [] });
    previewBundleSpy.mockReset();
    previewHolder.value = [
      memberPreview({
        automationSlug: 'reply-gmail-emails',
        automationName: 'Reply to Gmail emails',
      }),
      memberPreview({
        automationSlug: 'reply-outlook-emails',
        automationName: 'Reply to Outlook emails',
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
        automationSlug: 'reply-gmail-emails',
        requiredIntegrations: ['gmail', 'shared-smtp'],
      }),
      memberPreview({
        automationSlug: 'reply-outlook-emails',
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
        automationSlug: 'reply-gmail-emails',
        automationName: 'Reply to Gmail emails',
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
        automationSlug: 'reply-outlook-emails',
        automationName: 'Reply to Outlook emails',
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
    expect(screen.getByText('Reply to Gmail emails')).toBeInTheDocument();
    expect(screen.getByText('Reply to Outlook emails')).toBeInTheDocument();
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
      'reply-gmail-emails': ['integrations:gmail/definition.json'],
      'reply-outlook-emails': ['integrations:outlook/definition.json'],
    });
  });

  it('shows a review section only for members that have overrides', async () => {
    previewHolder.value = [
      // reply-gmail-emails: a real override → gets a review section.
      memberPreview({
        automationSlug: 'reply-gmail-emails',
        automationName: 'Reply to Gmail emails',
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
      // reply-outlook-emails: nothing to overwrite → never appears in the review step.
      memberPreview({
        automationSlug: 'reply-outlook-emails',
        automationName: 'Reply to Outlook emails',
        entries: [],
        overrides: [],
      }),
    ];
    renderWizard();

    await screen.findByText('Installing overwrites existing files');
    expect(screen.getByText('Reply to Gmail emails')).toBeInTheDocument();
    expect(screen.getByText('gmail/definition.json')).toBeInTheDocument();
    // reply-outlook-emails never gets a section — it has no overrides.
    expect(
      screen.queryByText('Reply to Outlook emails'),
    ).not.toBeInTheDocument();
    // A single member's checkbox.
    expect(
      screen.getAllByRole('checkbox', {
        name: "Replace these files with the automation's versions",
      }),
    ).toHaveLength(1);
  });

  it("concatenates each member's agent readiness after install (globally-unique <member>/<name> slugs)", async () => {
    agentReadinessByAutomation.value = {
      'reply-gmail-emails': {
        agents: [
          {
            agentSlug: 'reply-gmail-emails/replier',
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
      'reply-outlook-emails': {
        agents: [
          {
            agentSlug: 'reply-outlook-emails/replier',
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
});

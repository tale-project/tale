import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { AutomationSummary } from '../hooks/use-automations';
import { AutomationPanel } from './automation-panel';

// A bundle's member name/description read needs a Convex client the test
// harness doesn't provide (mirrors `use-required-integrations` below).
// Controllable per test for the `kind: 'bundle'` describe block.
let mockBundleMembers: unknown[] = [];
vi.mock('../hooks/use-automations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-automations')>()),
  useBundleMemberSummaries: () => ({
    members: mockBundleMembers,
    isLoading: false,
  }),
}));

// The panel's required-integration rows render a router `Link`; no router
// mounts in this suite.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to: _to,
    params: _params,
    search: _search,
    ...props
  }: Record<string, unknown>) =>
    // href gives the anchor its implicit "link" role for getByRole queries.
    createElement(
      'a',
      { href: '#', ...(props as Record<string, unknown>) },
      children as never,
    ),
}));

// Controllable per test: the required-integrations connect state the panel
// shows BEFORE install (the same three states `AutomationConfiguration` shows
// after). `requiredSlugsSpy` records the slugs the panel asked for — the
// bundle aggregation test asserts the deduped member union arrives here.
let mockRequired: unknown[] = [];
let requiredSlugsSpy: readonly string[] = [];
vi.mock('../hooks/use-required-integrations', () => ({
  useRequiredIntegrations: (_orgId: string, slugs: readonly string[]) => {
    requiredSlugsSpy = slugs;
    return {
      required: mockRequired,
      blockedSlugs: [],
      isLoading: false,
    };
  },
}));

// The org-level install rows + lifecycle actions need a Convex client; the
// derive helper stays REAL (pure) so the installed-bundle footer test
// exercises the actual member → bundle status derivation.
let mockInstallStates = new Map<
  string,
  {
    automationSlug: string;
    status: 'active' | 'broken';
    installedAt: number;
    blockedIntegrations: string[];
  }
>();
const uninstallBundleMock = vi.fn(() => Promise.resolve());
vi.mock('../hooks/use-install-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-install-state')>()),
  useAutomationInstallStates: () => ({
    bySlug: mockInstallStates,
    isLoading: false,
  }),
  useAutomationInstallActions: () => ({
    uninstallBundle: uninstallBundleMock,
    isPending: false,
  }),
}));

// Probe the wizard as a lightweight open/closed marker so the test asserts
// the footer Install button opens it, without pulling in the wizard's
// Convex/integration machinery.
vi.mock('./install-wizard/automation-install-wizard', () => ({
  AutomationInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div>wizard step probe</div> : null,
}));

// Same probe for the bundle wizard (`kind: 'bundle'` panel behaviour).
vi.mock('./install-wizard/bundle-install-wizard', () => ({
  BundleInstallWizard: ({ open }: { open: boolean }) =>
    open ? <div>bundle wizard step probe</div> : null,
}));

function automationSummary(
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    slug: 'gmail/sync-emails',
    name: 'Sync Gmail emails',
    description: 'Read, triage, and reply to your Gmail conversations.',
    scope: 'org',
    kind: 'automation',
    workflows: [],
    agents: [],
    skills: [],
    functions: [],
    requiredIntegrations: [],
    views: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockRequired = [];
  requiredSlugsSpy = [];
  mockBundleMembers = [];
  mockInstallStates = new Map();
  uninstallBundleMock.mockClear();
});

describe('AutomationPanel', () => {
  it('renders the automation name, scope badge, and description', () => {
    render(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary()}
        isCustom={false}
      />,
    );

    expect(screen.getByText('Sync Gmail emails')).toBeInTheDocument();
    expect(screen.getByText('Organization automation')).toBeInTheDocument();
    expect(
      screen.getByText('Read, triage, and reply to your Gmail conversations.'),
    ).toBeInTheDocument();
  });

  it('shows the Custom badge only for a private (uploaded) bundle', () => {
    const { rerender } = render(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary()}
        isCustom={false}
      />,
    );
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();

    rerender(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary()}
        isCustom
      />,
    );
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('lists builtin views, workflows, agents, and skills under "What will be installed"', () => {
    render(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary({
          builtinViews: [{ id: 'inbox' }],
          workflows: ['gmail-reply'],
          agents: ['gmail-triage'],
          skills: ['browse-web'],
        })}
        isCustom={false}
      />,
    );

    expect(screen.getByText('What will be installed')).toBeInTheDocument();
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Gmail Reply')).toBeInTheDocument();
    expect(screen.getByText('Gmail Triage')).toBeInTheDocument();
    expect(screen.getByText('Browse Web')).toBeInTheDocument();
  });

  it('shows required integrations with their live connect state', () => {
    mockRequired = [
      {
        slug: 'gmail',
        integration: { title: 'Gmail' },
        connected: true,
        exists: true,
      },
    ];

    render(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary({ requiredIntegrations: ['gmail'] })}
        isCustom={false}
      />,
    );

    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows the manifest folder as a chip', () => {
    render(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary({ folder: 'github/issues' })}
        isCustom={false}
      />,
    );

    expect(screen.getByText('Folder')).toBeInTheDocument();
    // `folderLabel` (shared with the catalog's section headers) capitalizes
    // the raw manifest value when no `folders.<key>` translation exists.
    expect(screen.getByText('Github/issues')).toBeInTheDocument();
  });

  it('opens the install wizard from the footer Install button', async () => {
    const { user } = render(
      <AutomationPanel
        open
        onOpenChange={vi.fn()}
        organizationId="org_1"
        automation={automationSummary()}
        isCustom={false}
      />,
    );

    expect(screen.queryByText('wizard step probe')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(screen.getByText('wizard step probe')).toBeInTheDocument();
  });

  it('calls onOpenChange(false) from the close button', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <AutomationPanel
        open
        onOpenChange={onOpenChange}
        organizationId="org_1"
        automation={automationSummary()}
        isCustom={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationPanel
          open
          onOpenChange={vi.fn()}
          organizationId="org_1"
          automation={automationSummary({
            builtinViews: [{ id: 'inbox' }],
            requiredIntegrations: ['gmail'],
          })}
          isCustom={false}
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('kind: bundle', () => {
    function bundleAutomation(
      overrides: Partial<AutomationSummary> = {},
    ): AutomationSummary {
      return automationSummary({
        slug: 'email-bundle',
        name: 'Email',
        description: 'Install every email provider automation at once.',
        kind: 'bundle',
        members: ['gmail/sync-emails', 'outlook/sync-emails'],
        ...overrides,
      });
    }

    const gmailMember = {
      slug: 'gmail/sync-emails',
      name: 'Sync Gmail emails',
      description: 'Read, triage, and reply to Gmail.',
      requiredIntegrations: ['gmail'],
    };
    const outlookMember = {
      slug: 'outlook/sync-emails',
      name: 'Sync Outlook emails',
      description: 'Read, triage, and reply to Outlook.',
      requiredIntegrations: ['outlook', 'gmail'],
    };

    it("lists each member's name + brief under 'Automations' instead of a single automation's contents", () => {
      mockBundleMembers = [gmailMember, outlookMember];

      render(
        <AutomationPanel
          open
          onOpenChange={vi.fn()}
          organizationId="org_1"
          automation={bundleAutomation()}
          isCustom={false}
        />,
      );

      expect(screen.getByText('What will be installed')).toBeInTheDocument();
      expect(screen.getByText('Automations')).toBeInTheDocument();
      expect(screen.getByText('Sync Gmail emails')).toBeInTheDocument();
      expect(
        screen.getByText('Read, triage, and reply to Gmail.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Sync Outlook emails')).toBeInTheDocument();
    });

    it("resolves the Integrations section from the members' deduped requirement union", () => {
      mockBundleMembers = [gmailMember, outlookMember];

      render(
        <AutomationPanel
          open
          onOpenChange={vi.fn()}
          organizationId="org_1"
          automation={bundleAutomation()}
          isCustom={false}
        />,
      );

      // The bundle manifest itself declares no `requires.integrations` — the
      // panel must ask for the members' union, deduped, in member order.
      expect(requiredSlugsSpy).toEqual(['gmail', 'outlook']);
    });

    it('shows "What\'s installed" + Reinstall/Uninstall once every member has an install row', async () => {
      mockBundleMembers = [gmailMember, outlookMember];
      mockInstallStates = new Map(
        ['gmail/sync-emails', 'outlook/sync-emails'].map((slug) => [
          slug,
          {
            automationSlug: slug,
            status: 'active' as const,
            installedAt: 1,
            blockedIntegrations: [],
          },
        ]),
      );

      const { user } = render(
        <AutomationPanel
          open
          onOpenChange={vi.fn()}
          organizationId="org_1"
          automation={bundleAutomation()}
          isCustom={false}
        />,
      );

      expect(screen.getByText("What's installed")).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Install' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Reinstall' }),
      ).toBeInTheDocument();

      // Uninstall goes through the confirm dialog before calling the action.
      await user.click(screen.getByRole('button', { name: 'Uninstall' }));
      await user.click(
        screen.getByRole('button', { name: 'Uninstall bundle' }),
      );
      expect(uninstallBundleMock).toHaveBeenCalledWith('email-bundle');
    });

    it('opens the bundle wizard (not the single-automation wizard) from the footer Install button', async () => {
      const { user } = render(
        <AutomationPanel
          open
          onOpenChange={vi.fn()}
          organizationId="org_1"
          automation={bundleAutomation()}
          isCustom={false}
        />,
      );

      expect(
        screen.queryByText('bundle wizard step probe'),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Install' }));
      expect(screen.getByText('bundle wizard step probe')).toBeInTheDocument();
      expect(screen.queryByText('wizard step probe')).not.toBeInTheDocument();
    });
  });
});
